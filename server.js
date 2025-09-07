import express from "express";
import crypto from "crypto";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function init() {
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
}
init().catch((e) => {
  console.error("DB init error", e);
  process.exit(1);
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/__diag", async (req, res) => {
  try {
    const r = await pool.query("select 1 as ok");
    res.json({ ok: true, db_ok: r.rows?.[0]?.ok === 1, env: { has_port: !!process.env.PORT, has_db_url: !!process.env.DATABASE_URL } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!ADMIN_TOKEN || tok !== ADMIN_TOKEN) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.get("/admin/kb/count", auth, async (req, res) => {
  const r = await pool.query("select count(*)::int as c from kb_chunks");
  res.json({ count: r.rows[0].c });
});

app.get("/admin/kb/list", auth, async (req, res) => {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "10", 10)));
  const r = await pool.query("select id, content, meta, updated_at, content_hash from kb_chunks order by updated_at desc limit $1", [limit]);
  res.json({ items: r.rows });
});

app.post("/admin/kb", auth, async (req, res) => {
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
