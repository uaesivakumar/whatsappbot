import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pkg from "pg";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import fs from "fs";
import { promises as fsp } from "fs";

dotenv.config();
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;
app.set("trust proxy", 1);

// ========== DB ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "",
  ssl: { rejectUnauthorized: false },
});

app.use(express.json({ limit: "2mb" }));

// ========== Sessions (admin) ==========
const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "change_this_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: "strict",
      maxAge: 1000 * 60 * 60 * 8,
    },
    name: "sid",
  })
);

// ========== Health ==========
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

// ========== Auth ==========
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "invalid credentials" });
});
app.post("/admin/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/admin/me", (req, res) => res.json({ authed: Boolean(req.session && req.session.isAdmin) }));
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: "unauthorized" });
}

// ========== Schema & Migration ==========
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
  // fix embedding type if needed
  const typeRes = await pool.query(`
    SELECT a.attname, a.atttypid::regtype::text AS type_text
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname='kb_chunks' AND n.nspname='public'
      AND a.attname='embedding' AND a.attnum>0 AND NOT a.attisdropped
    LIMIT 1;
  `);
  if (!typeRes.rows.length || typeRes.rows[0].type_text !== "vector") {
    await pool.query(`ALTER TABLE public.kb_chunks DROP COLUMN IF EXISTS embedding;`);
    await pool.query(`ALTER TABLE public.kb_chunks ADD COLUMN embedding VECTOR(1536);`);
  }
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

  // Customers
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone TEXT UNIQUE,
      name TEXT,
      company TEXT,
      salary NUMERIC,
      notes TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Messages (logs)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      text TEXT NOT NULL,
      answer TEXT,
      intent TEXT,
      intent_score REAL,
      retrieval JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS messages_created_at_idx ON public.messages (created_at DESC);`);
}
ensureSchema().catch((e) => console.error("ensureSchema error:", e));

// ========== Helpers / Embeddings / Intents ==========
async function embedText(text) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  if (!resp.ok) throw new Error(`OpenAI error: ${await resp.text()}`);
  const data = await resp.json();
  const v = data?.data?.[0]?.embedding;
  if (!Array.isArray(v)) throw new Error("No embedding returned");
  return v.map(Number);
}
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0));
const cosineSim = (a, b) => dot(a, b) / (norm(a) * norm(b) || 1);

// Simple intent catalog (expand as needed)
const INTENTS = [
  {
    id: "greeting",
    name: "Greeting",
    desc: "Greeting or small talk.",
    examples: ["hi", "hello", "good morning", "are you there?"],
  },
  {
    id: "balance_requirement",
    name: "Balance Requirement",
    desc: "Questions about minimum balance / zero-balance policy.",
    examples: [
      "is salary account zero balance",
      "minimum monthly average balance",
      "do i need to keep 5000 aed",
    ],
  },
  {
    id: "salary_transfer",
    name: "Salary Transfer",
    desc: "Salary transfer, minimum salary, benefits.",
    examples: ["minimum salary for account", "salary transfer benefits", "can i transfer salary"],
  },
  {
    id: "fees",
    name: "Fees & Charges",
    desc: "Fees, charges, penalties.",
    examples: ["what are the account fees", "is there any penalty", "atm withdrawal charges"],
  },
  { id: "other", name: "Other", desc: "Anything else.", examples: ["miscellaneous"] },
];

let INTENT_VECTORS = []; // {id,name,vec:[]}
async function buildIntentVectors() {
  const out = [];
  for (const it of INTENTS) {
    const chunks = [it.desc, ...(it.examples || [])];
    let acc = null;
    for (const txt of chunks) {
      const v = await embedText(txt);
      if (!acc) acc = v.slice();
      else for (let i = 0; i < acc.length; i++) acc[i] += v[i];
    }
    // average
    for (let i = 0; i < acc.length; i++) acc[i] /= chunks.length;
    out.push({ id: it.id, name: it.name, vec: acc });
  }
  INTENT_VECTORS = out;
}
buildIntentVectors().catch((e) => console.error("intent vectors error:", e));

function classifyIntentFromVec(qVec) {
  if (!INTENT_VECTORS.length) return { intent: "other", name: "Other", score: 0.0 };
  let best = null;
  for (const it of INTENT_VECTORS) {
    const sim = cosineSim(qVec, it.vec); // -1..1
    if (!best || sim > best.sim) best = { ...it, sim };
  }
  const pct = Math.max(0, Math.min(1, (best.sim + 1) / 2)); // map -1..1 -> 0..1
  // threshold: if low confidence, mark as other
  if (pct < 0.55 && best.id !== "other") return { intent: "other", name: "Other", score: pct };
  return { intent: best.id, name: best.name, score: pct };
}

// ========== KB Admin (unchanged basics) ==========
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
      FROM public.kb_chunks
      ${where}
      ORDER BY updated_at DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
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
    const q = `
      INSERT INTO public.kb_chunks (content, meta, content_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (content_hash) DO UPDATE SET updated_at = now()
      RETURNING *
    `;
    const r = await pool.query(q, [content, meta, hash]);
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
    const q = `
      UPDATE public.kb_chunks
      SET content=$1, meta=$2, content_hash=$3, updated_at=now(), embedding=NULL
      WHERE id=$4
      RETURNING *
    `;
    const r = await pool.query(q, [content, meta, hash, id]);
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

// Embeddings helpers for KB
app.post("/admin/kb/embed/:id", requireAdmin, async (req, res) => {
  const id = (req.params.id || "").toString();
  if (!id) return res.status(400).json({ error: "id_required" });
  try {
    const { rows } = await pool.query(`SELECT id, content FROM public.kb_chunks WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    const emb = await embedText(rows[0].content);
    const embLiteral = `[${emb.join(",")}]`;
    const r = await pool.query(
      `UPDATE public.kb_chunks SET embedding=$2::vector(1536), updated_at=now() WHERE id=$1 RETURNING id`,
      [id, embLiteral]
    );
    res.json({ ok: true, id: r.rows[0].id });
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
    const updated = [];
    for (const row of rows) {
      try {
        const emb = await embedText(row.content);
        const embLiteral = `[${emb.join(",")}]`;
        await pool.query(
          `UPDATE public.kb_chunks SET embedding=$2::vector(1536), updated_at=now() WHERE id=$1`,
          [row.id, embLiteral]
        );
        updated.push(row.id);
      } catch {}
    }
    res.json({ ok: true, updated_count: updated.length, updated });
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
    const sql = `
      SELECT id, content, meta, updated_at,
             (embedding <=> $1::vector(1536)) AS distance
      FROM public.kb_chunks
      WHERE embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT ${k}
    `;
    const { rows } = await pool.query(sql, [qLiteral]);
    res.json({ results: rows });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ========== Customers ==========
app.get("/admin/customers", requireAdmin, async (req, res) => {
  const q = (req.query.search || "").toString().trim();
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || "50", 10)));
  const offset = Math.max(0, parseInt(req.query.offset || "0", 10));
  let where = "";
  let params = [];
  if (q) {
    where = `WHERE (phone ILIKE $1 OR name ILIKE $1 OR company ILIKE $1)`;
    params = [`%${q}%`];
  }
  const sql = `
    SELECT id, phone, name, company, salary, notes, meta, created_at, updated_at
    FROM public.customers
    ${where}
    ORDER BY updated_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;
  const { rows } = await pool.query(sql, [...params, limit, offset]);
  res.json({ rows });
});
app.post("/admin/customers", requireAdmin, async (req, res) => {
  const { phone, name, company, salary, notes, meta } = req.body || {};
  if (!phone) return res.status(400).json({ error: "phone_required" });
  const r = await pool.query(
    `INSERT INTO public.customers (phone,name,company,salary,notes,meta)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (phone) DO UPDATE
     SET name=EXCLUDED.name, company=EXCLUDED.company, salary=EXCLUDED.salary, notes=EXCLUDED.notes, meta=EXCLUDED.meta, updated_at=now()
     RETURNING *`,
    [phone, name || null, company || null, salary || null, notes || null, meta || {}]
  );
  res.json(r.rows[0]);
});
app.put("/admin/customers/:id", requireAdmin, async (req, res) => {
  const id = (req.params.id || "").toString();
  const { phone, name, company, salary, notes, meta } = req.body || {};
  if (!id) return res.status(400).json({ error: "id_required" });
  const r = await pool.query(
    `UPDATE public.customers
     SET phone=$1, name=$2, company=$3, salary=$4, notes=$5, meta=$6, updated_at=now()
     WHERE id=$7
     RETURNING *`,
    [phone || null, name || null, company || null, salary || null, notes || null, meta || {}, id]
  );
  if (!r.rows.length) return res.status(404).json({ error: "not_found" });
  res.json(r.rows[0]);
});

// ========== RAG: public query (bot & preview) ==========
function allowBotOrAdmin(req, res, next) {
  const hdr = (req.headers.authorization || "").toString();
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (req.session?.isAdmin) return next();
  if (process.env.BOT_TOKEN && token === process.env.BOT_TOKEN) return next();
  return res.status(401).json({ error: "unauthorized" });
}

async function openaiChat(messages) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.2,
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI chat error: ${await resp.text()}`);
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || "";
}

app.post("/rag/query", allowBotOrAdmin, async (req, res) => {
  try {
    const text = (req.body?.text || "").toString();
    const k = Math.max(1, Math.min(5, parseInt(req.body?.k || "3", 10)));
    const generate = req.body?.generate !== false; // default true
    const customer = req.body?.customer || {}; // { phone, name? }

    if (!text.trim()) return res.status(400).json({ error: "text_required" });

    // resolve/create customer
    let customerId = null;
    let customerRow = null;
    if (customer.phone) {
      const r = await pool.query(`SELECT * FROM public.customers WHERE phone=$1`, [customer.phone]);
      if (r.rows.length) customerRow = r.rows[0];
      else {
        const ins = await pool.query(
          `INSERT INTO public.customers (phone, name) VALUES ($1,$2) RETURNING *`,
          [customer.phone, customer.name || null]
        );
        customerRow = ins.rows[0];
      }
      customerId = customerRow.id;
    }

    // embed query + classify intent
    const qEmb = await embedText(text);
    const intentData = classifyIntentFromVec(qEmb);
    const intentPct = Math.round(intentData.score * 100);

    // vector retrieval
    const qLiteral = `[${qEmb.join(",")}]`;
    const rs = await pool.query(
      `SELECT id, content, meta, (embedding <=> $1::vector(1536)) AS distance
       FROM public.kb_chunks
       WHERE embedding IS NOT NULL
       ORDER BY distance ASC
       LIMIT ${k}`,
      [qLiteral]
    );
    const contexts = rs.rows;

    // optional LLM answer "like Siva"
    let answer = null;
    if (generate) {
      const contextText = contexts.map((c, i) => `#${i + 1} (d=${Number(c.distance).toFixed(3)}):\n${c.content}`).join("\n\n");
      const sys = `You are Siva, a friendly, concise Emirates NBD virtual assistant. 
Answer ONLY using the provided CONTEXTS. If the answer is not in the contexts, say you don't have that information and offer to connect the user to a human. 
Keep answers short, clear, and correct.`;
      const user = `User question: "${text}"\n\nCONTEXTS:\n${contextText}`;
      answer = await openaiChat([
        { role: "system", content: sys },
        { role: "user", content: user },
      ]);
    }

    // log message
    const retrieval = {
      contexts: contexts.map((c) => ({ id: c.id, distance: c.distance })),
      intent: intentData.name,
      intent_score: intentPct,
    };
    const ins = await pool.query(
      `INSERT INTO public.messages (customer_id, text, answer, intent, intent_score, retrieval)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, created_at`,
      [customerId, text, answer, intentData.name, intentPct, retrieval]
    );
    const messageId = ins.rows[0].id;

    res.json({
      message_id: messageId,
      intent: intentData.name,
      intent_confidence_pct: intentPct,
      contexts,
      answer,
      customer: customerRow ? { id: customerRow.id, phone: customerRow.phone, name: customerRow.name } : null,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ========== Messages (logs) ==========
app.get("/admin/messages", requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || "50", 10)));
  const offset = Math.max(0, parseInt(req.query.offset || "0", 10));
  const rows = (
    await pool.query(
      `SELECT m.id, m.created_at, c.phone, c.name, m.intent, m.intent_score, LEFT(m.text, 160) AS text_preview
       FROM public.messages m
       LEFT JOIN public.customers c ON c.id = m.customer_id
       ORDER BY m.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    )
  ).rows;
  res.json({ rows });
});

app.get("/admin/messages/:id", requireAdmin, async (req, res) => {
  const id = (req.params.id || "").toString();
  const r = await pool.query(
    `SELECT m.*, c.phone, c.name
     FROM public.messages m
     LEFT JOIN public.customers c ON c.id = m.customer_id
     WHERE m.id = $1`,
    [id]
  );
  if (!r.rows.length) return res.status(404).json({ error: "not_found" });
  res.json(r.rows[0]);
});

// ========== Static ==========
app.use(express.static(path.join(__dirname, "public")));
const consoleDir = path.join(__dirname, "console", "public");
app.use("/console", express.static(consoleDir));
app.get("/console", (_req, res) => res.sendFile(path.join(consoleDir, "index.html")));

// Debug helpers
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
