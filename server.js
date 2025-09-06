// server.js
import express from "express";
import { Pool } from "pg";
import crypto from "node:crypto";
import dns from "node:dns";

dns.setDefaultResultOrder("ipv4first");

const PORT = process.env.PORT ? Number(process.env.PORT) : 10000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function hashContent(s) {
  return crypto.createHash("sha256").update(String(s || "")).digest("hex");
}

async function ensureSchema() {
  await pool.query(`
    create table if not exists kb (
      id text primary key,
      content text not null,
      meta jsonb default '{}'::jsonb,
      content_hash text not null unique,
      created_at timestamptz default now()
    );
    create index if not exists kb_created_at_idx on kb(created_at desc);
  `);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

function adminAuth(req, res, next) {
  const auth = req.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1] !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

app.get("/", (_req, res) => {
  res.type("text/plain").send("OK");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    uptime_sec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    service: "kb-backend",
    node: process.version
  });
});

app.get("/__diag", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({
      ok: true,
      db_ok: true,
      node: process.version,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.json({
      ok: false,
      error: String(e && e.message ? e.message : e)
    });
  }
});

app.get("/admin/kb/count", adminAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query("select count(*)::int as n from kb");
    res.json({ ok: true, count: rows[0].n });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/admin/kb/list", adminAuth, async (req, res) => {
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 50));
  try {
    const { rows } = await pool.query(
      "select id, content, meta, content_hash, created_at from kb order by created_at desc limit $1",
      [limit]
    );
    res.json({ ok: true, items: rows });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/admin/kb", adminAuth, async (req, res) => {
  const content = (req.body && req.body.content) || "";
  const meta = (req.body && req.body.meta) || {};
  if (!content || typeof content !== "string") {
    return res.status(400).json({ error: "invalid content" });
  }
  const h = hashContent(content.trim());
  const id = h;
  try {
    const { rows } = await pool.query(
      `
      insert into kb (id, content, meta, content_hash)
      values ($1, $2, $3::jsonb, $1)
      on conflict (content_hash) do update
      set content = excluded.content,
          meta = excluded.meta
      returning id, content_hash, created_at
      `,
      [id, content, meta]
    );
    res.json({ ok: true, id: rows[0].id, hash: rows[0].content_hash });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

async function main() {
  await ensureSchema();
  app.listen(PORT, () => {
    console.log(`server listening on ${PORT} (${process.cwd()})`);
  });
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
