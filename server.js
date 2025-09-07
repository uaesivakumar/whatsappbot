import express from "express";
import crypto from "crypto";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

const DB_URL = process.env.DATABASE_URL || "";
let pool = null;
if (DB_URL) {
  try {
    pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  } catch {}
}

async function ensureSchema() {
  if (!pool) return;
  try {
    await pool.query(`
      create extension if not exists pgcrypto;
      create table if not exists kb_chunks (
        id uuid primary key default gen_random_uuid(),
        content text not null,
        meta jsonb,
        embedding jsonb,
        updated_at timestamptz not null default now(),
        content_hash text not null unique
      );
    `);
  } catch (e) {
    console.error("DB init warning:", e.message);
  }
}
ensureSchema();

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/__diag", async (req, res) => {
  const diag = { ok: true, env: { has_port: !!process.env.PORT, has_db_url: !!DB_URL } };
  if (!pool) {
    return res.json({ ...diag, db_ok: false, db_reason: "no_pool", db_url_hint: DB_URL ? new URL(DB_URL).host + ":" + (new URL(DB_URL).port || "") : null });
  }
  try {
    const r = await pool.query("select 1 as ok");
    const u = new URL(DB_URL);
    res.json({ ...diag, db_ok: r.rows?.[0]?.ok === 1, db_host: u.hostname, db_port: u.port });
  } catch (e) {
    try {
      const u = new URL(DB_URL);
      res.status(500).json({ ...diag, db_ok: false, db_host: u.hostname, db_port: u.port, error: e.message });
    } catch {
      res.status(500).json({ ...diag, db_ok: false, error: e.message });
    }
  }
});

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!ADMIN_TOKEN || tok !== ADMIN_TOKEN) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.get("/admin/kb/count", auth, async (req, res) => {
  if (!pool) return res.status(500).json({ error: "db_unavailable" });
  const r = await pool.query("select count(*)::int as c from kb_chunks");
  res.json({ count: r.rows[0].c });
});

app.get("/admin/kb/list", auth, async (req, res) => {
  if (!pool) return res.status(500).json({ error: "db_unavailable" });
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "10", 10)));
  const r = await pool.query("select id, content, meta, updated_at, content_hash from kb_chunks order by updated_at desc limit $1", [limit]);
  res.json({ items: r.rows });
});

app.post("/admin/kb", auth, async (req, res) => {
  if (!pool) return res.status(500).json({ error: "db_unavailable" });
  const content = (req.body?.content || "").trim();
  const meta = req.body?.meta || null;
  if (!content) return res.status(400).json({ error: "content required" });
  const hash = crypto.createHash("sha256").update(content, "utf8").digest("hex");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const ins = await client.query(
      "insert into kb_chunks (content, meta, content_hash) values ($1,$2,$3) on conflict (content_hash) do nothing returning id",
      [content, meta, hash]
    );
    let id = ins.rows[0]?.id;
    if (!id) {
      const sel = await client.query("select id from kb_chunks where content_hash=$1", [hash]);
      id = sel.rows[0]?.id || null;
    }
    await client.query("commit");
    res.json({ id, content_hash: hash });
  } catch (e) {
    await client.query("rollback");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on ${PORT}`);
});
