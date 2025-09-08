import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "pg";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import fs from "fs";
import { promises as fsp } from "fs";
import multer from "multer";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { htmlToText } from "html-to-text";
import axios from "axios";

const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;
app.set("trust proxy", 1);

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true })); // for Twilio-style form posts

// ---------- DB ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "",
  ssl: { rejectUnauthorized: false },
});

// ---------- Sessions (admin only) ----------
const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({ pool, tableName: "session", createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "change_this_secret",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, httpOnly: true, sameSite: "strict", maxAge: 1000 * 60 * 60 * 8 },
    name: "sid",
  })
);

// ---------- Health ----------
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/__diag", async (_req, res) => {
  try {
    const c = await pool.connect();
    try {
      await c.query("select 1");
      const { host, port } = c.connectionParameters;
      res.json({ ok: true, db_ok: true, db_host: host, db_port: Number(port) });
    } finally {
      c.release();
    }
  } catch (e) {
    res.status(500).json({ ok: false, db_ok: false, error: String(e) });
  }
});

// ---------- Auth ----------
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "invalid credentials" });
});
app.post("/admin/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/admin/me", (req, res) => res.json({ authed: Boolean(req.session?.isAdmin) }));
function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  res.status(401).json({ error: "unauthorized" });
}

// ---------- Schema & Migration ----------
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

  // KB
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      content TEXT NOT NULL,
      meta JSONB,
      embedding VECTOR(1536),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      content_hash TEXT NOT NULL UNIQUE
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS kb_chunks_updated_at_idx ON public.kb_chunks (updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS kb_chunks_meta_gin_idx ON public.kb_chunks USING GIN (meta);`);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='i' AND c.relname='kb_chunks_embedding_idx' AND n.nspname='public'
      ) THEN
        EXECUTE 'CREATE INDEX kb_chunks_embedding_idx ON public.kb_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);';
      END IF;
    END $$;
  `);

  // Customers & messages
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone TEXT UNIQUE,
      name TEXT,
      company TEXT,
      salary NUMERIC,
      address TEXT,
      notes TEXT,
      meta JSONB,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      text TEXT NOT NULL,
      answer TEXT,
      intent TEXT,
      intent_score REAL,
      retrieval JSONB,
      delivery_status TEXT,
      delivery_meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS messages_created_at_idx ON public.messages (created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_delivery_status ON public.messages (delivery_status);`);

  // Bot settings
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_settings (
      id TEXT PRIMARY KEY,
      config JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const def = {
    persona_name: "Siva",
    include_identity_each_reply: true,
    identity_line: "— Siva (Emirates NBD virtual assistant)",
    allow_handoff: false,
    system_prompt_override: null,
    use_profile_personalization: true
  };
  await pool.query(
    `INSERT INTO bot_settings (id, config)
     VALUES ('default', $1::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(def)]
  );
}
ensureSchema().catch((e) => console.error("ensureSchema error:", e));

// ---------- OpenAI helpers ----------
async function embedText(text) {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  if (!resp.ok) throw new Error(`OpenAI error: ${await resp.text()}`);
  const data = await resp.json();
  return data?.data?.[0]?.embedding?.map(Number);
}
async function openaiChat(messages) {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, temperature: 0.2 }),
  });
  if (!resp.ok) throw new Error(`OpenAI chat error: ${await resp.text()}`);
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || "";
}

// ---------- Intent ----------
const INTENTS = [
  { id: "greeting", name: "Greeting", examples: ["hi", "hello", "good morning"], desc: "Greeting" },
  { id: "balance_requirement", name: "Balance Requirement", examples: ["zero balance account", "minimum balance 5000", "maintain average"], desc: "Minimum balance / zero balance" },
  { id: "salary_transfer", name: "Salary Transfer", examples: ["minimum salary", "salary transfer benefits"], desc: "Salary transfer" },
  { id: "fees", name: "Fees & Charges", examples: ["fees", "charges", "penalty"], desc: "Fees" },
  { id: "other", name: "Other", examples: ["misc"], desc: "Other" },
];
let INTENT_VECTORS = [];
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0));
const cosineSim = (a, b) => dot(a, b) / (norm(a) * norm(b) || 1);
async function buildIntentVectors() {
  const out = [];
  for (const it of INTENTS) {
    const parts = [it.desc, ...(it.examples || [])];
    let acc = null;
    for (const p of parts) {
      const v = await embedText(p);
      if (!acc) acc = v.slice();
      else for (let i = 0; i < acc.length; i++) acc[i] += v[i];
    }
    for (let i = 0; i < acc.length; i++) acc[i] /= parts.length;
    out.push({ id: it.id, name: it.name, vec: acc });
  }
  INTENT_VECTORS = out;
}
buildIntentVectors().catch((e) => console.error("intent vectors error:", e));
function classifyIntentFromVec(qVec) {
  if (!INTENT_VECTORS.length) return { intent: "other", name: "Other", score: 0.0 };
  let best = null;
  for (const it of INTENTS) {
    const sim = cosineSim(qVec, it.vec);
    if (!best || sim > best.sim) best = { ...it, sim };
  }
  const pct = Math.max(0, Math.min(1, (best.sim + 1) / 2));
  if (pct < 0.55 && best.id !== "other") return { intent: "other", name: "Other", score: pct };
  return { intent: best.id, name: best.name, score: pct };
}

// ---------- Settings helpers ----------
async function getSettings() {
  const r = await pool.query(`SELECT config FROM bot_settings WHERE id='default'`);
  if (r.rows.length) return r.rows[0].config;
  return {
    persona_name: "Siva",
    include_identity_each_reply: true,
    identity_line: "— Siva (Emirates NBD virtual assistant)",
    allow_handoff: false,
    system_prompt_override: null,
    use_profile_personalization: true
  };
}

// ---------- KB Admin ----------
const normalizeSearch = (s) => (s || "").toString().trim();
const searchSqlAndParams = (search, startIndex = 1) => {
  const s = normalizeSearch(search);
  if (!s) return { where: "", params: [] };
  return { where: `WHERE (content ILIKE $${startIndex} OR meta::text ILIKE $${startIndex})`, params: [`%${s}%`] };
};

app.get("/admin/kb/count", requireAdmin, async (req, res) => {
  try {
    const { where, params } = searchSqlAndParams(req.query.search, 1);
    const { rows } = await pool.query(`SELECT COUNT(*) FROM public.kb_chunks ${where}`, params);
    res.json({ count: parseInt(rows[0].count, 10) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
app.get("/admin/kb/list", requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || "20", 10)));
  const offset = Math.max(0, parseInt(req.query.offset || "0", 10));
  try {
    const { where, params } = searchSqlAndParams(req.query.search, 1);
    const q = `
      SELECT id, content, meta, updated_at, content_hash, (embedding IS NOT NULL) AS has_embedding
      FROM public.kb_chunks ${where}
      ORDER BY updated_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const { rows } = await pool.query(q, [...params, limit, offset]);
    res.json({ rows });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
app.post("/admin/kb", requireAdmin, async (req, res) => {
  const content = (req.body?.content ?? "").toString();
  const meta = req.body?.meta ?? {};
  if (!content.trim()) return res.status(400).json({ error: "content_required" });
  const { createHash } = await import("crypto");
  const hash = createHash("sha256").update(content, "utf8").digest("hex");
  try {
    const r = await pool.query(
      `INSERT INTO public.kb_chunks (content, meta, content_hash)
       VALUES ($1,$2,$3)
       ON CONFLICT (content_hash) DO UPDATE SET updated_at=now()
       RETURNING *`,
      [content, meta, hash]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
app.put("/admin/kb/:id", requireAdmin, async (req, res) => {
  const id = (req.params.id || "").toString();
  const content = (req.body?.content ?? "").toString();
  const meta = req.body?.meta ?? {};
  if (!id) return res.status(400).json({ error: "id_required" });
  if (!content.trim()) return res.status(400).json({ error: "content_required" });
  const { createHash } = await import("crypto");
  const hash = createHash("sha256").update(content, "utf8").digest("hex");
  try {
    const r = await pool.query(
      `UPDATE public.kb_chunks
       SET content=$1, meta=$2, content_hash=$3, updated_at=now(), embedding=NULL
       WHERE id=$4 RETURNING *`,
      [content, meta, hash, id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "not_found" });
    res.json(r.rows[0]);
  } catch (e) {
    if (String(e.code) === "23505") return res.status(409).json({ error: "duplicate_content" });
    res.status(500).json({ error: String(e) });
  }
});
app.delete("/admin/kb/:id", requireAdmin, async (req, res) => {
  const id = (req.params.id || "").toString();
  if (!id) return res.status(400).json({ error: "id_required" });
  try {
    const r = await pool.query(`DELETE FROM public.kb_chunks WHERE id=$1 RETURNING id`, [id]);
    if (!r.rows.length) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
app.post("/admin/kb/embed/:id", requireAdmin, async (req, res) => {
  const id = (req.params.id || "").toString();
  if (!id) return res.status(400).json({ error: "id_required" });
  try {
    const { rows } = await pool.query(`SELECT id, content FROM public.kb_chunks WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    const emb = await embedText(rows[0].content);
    const embLiteral = `[${emb.join(",")}]`;
    await pool.query(`UPDATE public.kb_chunks SET embedding=$2::vector(1536), updated_at=now() WHERE id=$1`, [id, embLiteral]);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
app.post("/admin/kb/embed/missing", requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || "10", 10)));
  try {
    const { rows } = await pool.query(
      `SELECT id, content FROM public.kb_chunks WHERE embedding IS NULL ORDER BY updated_at DESC LIMIT $1`,
      [limit]
    );
    let cnt = 0;
    for (const row of rows) {
      try {
        const emb = await embedText(row.content);
        const embLiteral = `[${emb.join(",")}]`;
        await pool.query(`UPDATE public.kb_chunks SET embedding=$2::vector(1536), updated_at=now() WHERE id=$1`, [
          row.id,
          embLiteral,
        ]);
        cnt++;
      } catch {}
    }
    res.json({ ok: true, updated_count: cnt });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
app.post("/admin/kb/search", requireAdmin, async (req, res) => {
  const query = (req.body?.query || "").toString();
  const k = Math.max(1, Math.min(50, parseInt(req.body?.k || "6", 10)));
  if (!query.trim()) return res.status(400).json({ error: "query_required" });
  try {
    const qEmb = await embedText(query);
    const qLiteral = `[${qEmb.join(",")}]`;
    const { rows } = await pool.query(
      `SELECT id, content, meta, updated_at, (embedding <=> $1::vector(1536)) AS distance
       FROM public.kb_chunks WHERE embedding IS NOT NULL
       ORDER BY distance ASC LIMIT ${k}`,
      [qLiteral]
    );
    res.json({ results: rows });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// -------- KB ingestion: URL + PDF (admin) --------
app.post("/admin/kb/ingest/url", requireAdmin, async (req, res) => {
  try {
    const url = (req.body?.url || "").toString().trim();
    const meta = req.body?.meta || {};
    if (!url) return res.status(400).json({ error: "url_required" });
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) return res.status(400).json({ error: `fetch_failed: ${r.status}` });
    const html = await r.text();
    const text = htmlToText(html, { wordwrap: 130, selectors: [{ selector: "script", format: "skip" }, { selector: "style", format: "skip" }]});
    const chunks = splitIntoChunks(text, 1200, 200);
    const results = [];
    for (const chunk of chunks) {
      const ins = await insertKbChunk(chunk, { ...meta, src: meta?.src || "url", url });
      results.push(ins);
    }
    res.json({ ok: true, inserted: results.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB
app.post("/admin/kb/upload/pdf", requireAdmin, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file_required" });
    const meta = req.body?.meta ? JSON.parse(req.body.meta) : {};
    const data = await pdfParse(req.file.buffer);
    const text = (data.text || "").trim();
    if (!text) return res.status(400).json({ error: "no_text_in_pdf" });
    const chunks = splitIntoChunks(text, 1200, 200);
    const results = [];
    for (const chunk of chunks) {
      const ins = await insertKbChunk(chunk, { ...meta, src: meta?.src || "pdf", filename: req.file.originalname });
      results.push(ins);
    }
    res.json({ ok: true, inserted: results.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

function splitIntoChunks(text, maxLen = 1200, overlap = 200) {
  const clean = text.replace(/\s+\n/g, "\n").replace(/\n{2,}/g, "\n\n").trim();
  const parts = [];
  let i = 0;
  while (i < clean.length) {
    const slice = clean.slice(i, i + maxLen);
    let end = slice.lastIndexOf("\n");
    if (end < maxLen * 0.5) end = slice.length;
    parts.push(slice.slice(0, end));
    i += end - overlap;
    if (i < 0 || i >= clean.length) break;
  }
  return parts.filter(Boolean);
}
async function insertKbChunk(content, meta) {
  const { createHash } = await import("crypto");
  const hash = createHash("sha256").update(content, "utf8").digest("hex");
  const r = await pool.query(
    `INSERT INTO public.kb_chunks (content, meta, content_hash) VALUES ($1,$2,$3)
     ON CONFLICT (content_hash) DO UPDATE SET updated_at=now()
     RETURNING id`,
    [content, meta || {}, hash]
  );
  return r.rows[0];
}

// ---------- Settings (get/save) ----------
app.get("/admin/settings", requireAdmin, async (_req, res) => {
  try { res.json(await getSettings()); } catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post("/admin/settings", requireAdmin, async (req, res) => {
  try {
    const cfg = req.body || {};
    await pool.query(`INSERT INTO bot_settings (id, config, updated_at)
                      VALUES ('default',$1::jsonb, now())
                      ON CONFLICT (id) DO UPDATE SET config=EXCLUDED.config, updated_at=now()`, [
      JSON.stringify(cfg),
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---------- Customers (manual admin list/save) ----------
app.get("/admin/customers", requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || "100", 10)));
  const rows = (
    await pool.query(
      `SELECT phone, name, company, salary, address, updated_at
       FROM public.customers ORDER BY updated_at DESC LIMIT $1`,
      [limit]
    )
  ).rows;
  res.json({ rows });
});
app.post("/admin/customers", requireAdmin, async (req, res) => {
  const { phone, name, company, salary, address, notes, meta } = req.body || {};
  if (!phone) return res.status(400).json({ error: "phone_required" });
  const r = await pool.query(
    `INSERT INTO public.customers (phone, name, company, salary, address, notes, meta, last_seen, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())
     ON CONFLICT (phone) DO UPDATE
     SET name=COALESCE(EXCLUDED.name, customers.name),
         company=COALESCE(EXCLUDED.company, customers.company),
         salary=COALESCE(EXCLUDED.salary, customers.salary),
         address=COALESCE(EXCLUDED.address, customers.address),
         notes=COALESCE(EXCLUDED.notes, customers.notes),
         meta=COALESCE(EXCLUDED.meta, customers.meta),
         last_seen=now(),
         updated_at=now()
     RETURNING phone, name, company, salary, address, updated_at`,
    [phone, name || null, company || null, salary || null, address || null, notes || null, meta || null]
  );
  res.json(r.rows[0]);
});

// ---------- Redaction (for previews) ----------
const redactText = (s) =>
  (s || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "•••@•••")
    .replace(/\b\d[\d\s\-]{7,}\b/g, (m) => m.replace(/\d/g, "•"));

// ---------- Core RAG (used by /rag/query and webhook) ----------
async function getCustomerByPhone(phone) {
  if (!phone) return null;
  const r = await pool.query(`SELECT * FROM public.customers WHERE phone=$1`, [phone]);
  return r.rows[0] || null;
}

async function extractCustomerFacts(userText, assistantText) {
  const sys = `You extract structured customer profile facts from chat turns.
Return ONLY valid JSON of the form:
{
  "name": {"value": string, "confidence": number},
  "company": {"value": string, "confidence": number},
  "salary": {"value": number, "confidence": number},
  "address": {"value": string, "confidence": number},
  "notes": {"value": string, "confidence": number}
}
Include only keys you are confident about. Confidence is 0..1. Salary is MONTHLY numeric (AED).`;
  const user = `USER:\n${userText || ""}\n\nASSISTANT:\n${assistantText || ""}`;
  const out = await openaiChat([
    { role: "system", content: sys },
    { role: "user", content: user },
  ]);
  try {
    const m = out.match(/\{[\s\S]*\}$/);
    const json = JSON.parse(m ? m[0] : out);
    return json && typeof json === "object" ? json : {};
  } catch {
    return {};
  }
}
const pickNumber = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
};
async function mergeCustomerProfile(phone, factsObj) {
  if (!phone || !factsObj || typeof factsObj !== "object") return null;
  const cur = await getCustomerByPhone(phone);
  const confMeta = { ...(cur?.meta?.profile_confidence || {}) };

  const next = {
    name: cur?.name || null,
    company: cur?.company || null,
    salary: cur?.salary || null,
    address: cur?.address || null,
    notes: cur?.notes || null,
  };

  const setField = (field, value, conf, threshold) => {
    if (value == null || value === "") return;
    const c = Math.max(0, Math.min(1, Number(conf || 0)));
    const oldC = Number(confMeta[field] || 0);
    if (!next[field] || c >= threshold || c > oldC) {
      next[field] = field === "salary" ? pickNumber(value) : value;
      confMeta[field] = c;
    }
  };

  if (factsObj.name) setField("name", factsObj.name.value ?? factsObj.name, factsObj.name.confidence, 0.8);
  if (factsObj.company) setField("company", factsObj.company.value ?? factsObj.company, factsObj.company.confidence, 0.7);
  if (factsObj.salary) setField("salary", factsObj.salary.value ?? factsObj.salary, factsObj.salary.confidence, 0.85);
  if (factsObj.address) setField("address", factsObj.address.value ?? factsObj.address, factsObj.address.confidence, 0.85);
  if (factsObj.notes) setField("notes", factsObj.notes.value ?? factsObj.notes, factsObj.notes.confidence, 0.6);

  const meta = { ...(cur?.meta || {}), profile_confidence: confMeta, last_facts_ts: new Date().toISOString() };

  const r = await pool.query(
    `INSERT INTO public.customers (phone, name, company, salary, address, notes, meta, last_seen, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())
     ON CONFLICT (phone) DO UPDATE
     SET name=$2, company=$3, salary=$4, address=$5, notes=$6, meta=$7, last_seen=now(), updated_at=now()
     RETURNING *`,
    [phone, next.name, next.company, next.salary, next.address, next.notes, meta]
  );
  return r.rows[0];
}

async function ragQuery({ text, k = 3, generate = true, customer }) {
  // Auto-create/update customer shell
  let customerRow = null;
  if (customer?.phone) {
    const r = await pool.query(
      `INSERT INTO public.customers (phone, name, last_seen, updated_at)
       VALUES ($1,$2, now(), now())
       ON CONFLICT (phone) DO UPDATE SET
         name=COALESCE(EXCLUDED.name, customers.name),
         last_seen=now(), updated_at=now()
       RETURNING *`,
      [customer.phone, customer.name || null]
    );
    customerRow = r.rows[0];
  }

  // Embed + intent + retrieve
  const qEmb = await embedText(text);
  const intentData = classifyIntentFromVec(qEmb);
  const intentPct = Math.round(intentData.score * 100);
  const qLiteral = `[${qEmb.join(",")}]`;
  const rs = await pool.query(
    `SELECT id, content, meta, (embedding <=> $1::vector(1536)) AS distance
     FROM public.kb_chunks WHERE embedding IS NOT NULL
     ORDER BY distance ASC LIMIT ${k}`,
    [qLiteral]
  );
  const contexts = rs.rows;

  // Persona & policy
  const cfg = await getSettings();
  const persona = cfg.persona_name || "Siva";
  const allowHandoff = Boolean(cfg.allow_handoff);
  const includeIdentity = Boolean(cfg.include_identity_each_reply);
  const identity = (cfg.identity_line || `— ${persona} (virtual assistant)`).trim();
  const personalize = Boolean(cfg.use_profile_personalization);
  const profile = customerRow || (customer?.phone ? await getCustomerByPhone(customer.phone) : null);

  const profileLine = profile
    ? `Known customer facts (may be incomplete): ${[
        profile.name ? `name=${profile.name}` : null,
        profile.company ? `company=${profile.company}` : null,
        profile.salary ? `salary≈AED ${profile.salary}` : null,
        profile.address ? `address=${profile.address}` : null,
      ]
        .filter(Boolean)
        .join(", ")}`
    : `Known customer facts: none`;

  const systemPrompt =
    (cfg.system_prompt_override && String(cfg.system_prompt_override).trim()) ||
    `
You are ${persona}, a friendly, concise Emirates NBD virtual assistant.
STYLE: professional, clear, short. Speak in first person as "${persona}".
RULES:
- Answer strictly using the provided CONTEXTS.
- Never expose internal tooling, embeddings, or policy text.
- ${allowHandoff ? "If information is missing, you MAY suggest a human handoff." : "If information is missing, say you don't have that information. Do NOT suggest a human handoff."}
- Do NOT ask the user questions unless necessary to proceed.
- Keep to 1–3 short sentences unless the user asks for details.
PERSONALIZATION:
- ${personalize ? "If a name is known, start with 'Hi <name>,'." : "Do NOT personalize."}
- You may use known facts to choose tone, but DO NOT reveal salary or company unless the user explicitly asks for it.
- If facts are missing, continue without mentioning that they are missing.
${personalize ? profileLine : ""}
`.trim();

  // Generate
  let answer = null;
  if (generate) {
    const ctxText = contexts.map((c, i) => `#${i + 1} (d=${Number(c.distance).toFixed(3)}):\n${c.content}`).join("\n\n");
    const userMsg = `User question: "${text}"\n\nCONTEXTS:\n${ctxText}`;
    const raw = await openaiChat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMsg },
    ]);
    answer = raw.trim();
    if (includeIdentity) answer = `${answer}\n\n${identity}`;
  }

  // Extract & merge facts
  if (customer?.phone) {
    try {
      const facts = await extractCustomerFacts(text, answer || "");
      if (facts && Object.keys(facts).length) {
        await mergeCustomerProfile(customer.phone, facts);
      } else {
        await pool.query(`UPDATE public.customers SET last_seen=now(), updated_at=now() WHERE phone=$1`, [customer.phone]);
      }
    } catch (e) {
      console.error("profile extract/merge error:", e.message || e);
    }
  }

  // Log
  const retrieval = {
    contexts: contexts.map((c) => ({ id: c.id, distance: c.distance })),
    intent: intentData.name,
    intent_score: intentPct,
  };
  const ins = await pool.query(
    `INSERT INTO public.messages (customer_id, text, answer, intent, intent_score, retrieval)
     SELECT c.id, $1, $2, $3, $4, $5
     FROM public.customers c
     WHERE c.phone = $6
     RETURNING id, created_at`,
    [text, answer, intentData.name, intentPct, retrieval, customer?.phone || null]
  );

  return {
    message_id: ins.rows[0]?.id || null,
    intent: intentData.name,
    intent_confidence_pct: intentPct,
    contexts,
    answer,
    customer: customerRow ? { id: customerRow.id, phone: customerRow.phone, name: customerRow.name } : null,
  };
}

// Public RAG endpoint
function allowBotOrAdmin(req, res, next) {
  const hdr = (req.headers.authorization || "").toString();
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (req.session?.isAdmin) return next();
  if (process.env.BOT_TOKEN && token === process.env.BOT_TOKEN) return next();
  return res.status(401).json({ error: "unauthorized" });
}
app.post("/rag/query", allowBotOrAdmin, async (req, res) => {
  try {
    const text = (req.body?.text || "").toString();
    if (!text.trim()) return res.status(400).json({ error: "text_required" });
    const k = Math.max(1, Math.min(5, parseInt(req.body?.k || "3", 10)));
    const generate = req.body?.generate !== false;
    const customer = req.body?.customer || {};
    const out = await ragQuery({ text, k, generate, customer });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---------- Messages (with redacted preview) ----------
app.get("/admin/messages", requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || "50", 10)));
  const rows = (
    await pool.query(
      `SELECT m.id, m.created_at, c.phone, c.name, m.intent, m.intent_score, LEFT(m.text,400) AS text_preview, m.delivery_status
       FROM public.messages m
       LEFT JOIN public.customers c ON c.id=m.customer_id
       ORDER BY m.created_at DESC LIMIT $1`,
      [limit]
    )
  ).rows;
  res.json({ rows: rows.map((r) => ({ ...r, text_preview: redactText(r.text_preview) })) });
});
app.get("/admin/messages/:id", requireAdmin, async (req, res) => {
  const id = (req.params.id || "").toString();
  const r = await pool.query(
    `SELECT m.*, c.phone, c.name FROM public.messages m LEFT JOIN public.customers c ON c.id=m.customer_id WHERE m.id=$1`,
    [id]
  );
  if (!r.rows.length) return res.status(404).json({ error: "not_found" });
  res.json(r.rows[0]);
});

// ---------- Meta WhatsApp sender ----------
async function sendWhatsAppText({ to, body }) {
  const PHONE_ID = process.env.META_PHONE_NUMBER_ID;
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  if (!PHONE_ID || !ACCESS_TOKEN) throw new Error("META_PHONE_NUMBER_ID or META_ACCESS_TOKEN is missing");

  const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to, // E.164 without '+', e.g., "9715xxxxxxxx"
    type: "text",
    text: { body },
  };

  let attempt = 0;
  const max = 3;
  while (true) {
    try {
      const resp = await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
        timeout: 15000,
      });
      return { ok: true, data: resp.data, attempt: attempt + 1 };
    } catch (err) {
      const s = err?.response?.status;
      attempt += 1;
      if ((s === 429 || (s && s >= 500)) && attempt < max) {
        const backoff = 500 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      return { ok: false, error: { status: s, data: err?.response?.data || err?.message || "send error" }, attempt };
    }
  }
}

// ---------- Webhook: WhatsApp inbound ----------
app.get("/webhooks/whatsapp", (req, res) => {
  // Meta Cloud verification handshake
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "";
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verifyToken) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  return res.status(400).send("Bad Request");
});

app.post("/webhooks/whatsapp", async (req, res) => {
  try {
    let phone = null;
    let text = null;

    // Twilio (form encoded)
    if (req.body && req.body.From && req.body.Body) {
      phone = String(req.body.From).replace(/^whatsapp:/, "").replace(/^\+/, "");
      text = String(req.body.Body || "");
    }

    // Meta Cloud API (JSON)
    if (!text && req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      const msg = req.body.entry[0].changes[0].value.messages[0];
      phone = String(msg.from || "").replace(/^\+/, "");
      text = msg.text?.body || msg.button?.text || msg.interactive?.list_reply?.title || "";
    }

    if (!text || !phone) return res.status(200).json({ ok: true, ignored: true });

    const out = await ragQuery({ text, k: 3, generate: true, customer: { phone } });

    // Auto-reply via Meta Cloud
    let sendResult = null;
    try {
      sendResult = await sendWhatsAppText({ to: phone, body: out.answer || "I’m here to help." });
    } catch (e) {
      sendResult = { ok: false, error: { status: null, data: String(e?.message || e) }, attempt: 1 };
    }

    // Update delivery status on the same message row created inside ragQuery
    if (out.message_id) {
      if (sendResult.ok) {
        await pool.query(
          `UPDATE public.messages SET delivery_status=$1, delivery_meta=$2 WHERE id=$3`,
          ["sent", sendResult.data, out.message_id]
        );
      } else {
        await pool.query(
          `UPDATE public.messages SET delivery_status=$1, delivery_meta=$2 WHERE id=$3`,
          ["failed", sendResult.error, out.message_id]
        );
      }
    }

    // 200 OK so Meta doesn't retry
    res.json({ ok: true, message_id: out.message_id, delivery: sendResult?.ok ? "sent" : "failed" });
  } catch (e) {
    // Always 200 to avoid repeated retries from providers
    res.status(200).json({ ok: true, error: String(e) });
  }
});

// ---------- Static ----------
app.use(express.static(path.join(__dirname, "public")));
const consoleDir = path.join(__dirname, "console", "public");
app.use("/console", express.static(consoleDir));
app.get("/console", (_req, res) => res.sendFile(path.join(consoleDir, "index.html")));
app.get("/debug/console-path", (_req, res) => {
  const indexPath = path.join(consoleDir, "index.html");
  res.json({ consoleDir, indexFile: indexPath, exists: fs.existsSync(indexPath) });
});
app.get("/debug/list-console-files", async (_req, res) => {
  try {
    const files = await fsp.readdir(consoleDir);
    res.json({ consoleDir, files });
  } catch (e) {
    res.status(500).json({ consoleDir, error: String(e) });
  }
});
app.use((_req, res) => res.status(404).send("Not found"));

app.listen(PORT, async () => {
  try { await ensureSchema(); } catch {}
  console.log(`Server running on port ${PORT}`);
});
