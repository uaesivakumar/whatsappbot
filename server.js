import express from "express";
import crypto from "crypto";
import pkg from "pg";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const { Pool } = pkg;
pkg.defaults.ssl = { rejectUnauthorized: false };

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.ADMIN_PASS || "";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL missing");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const ok = (res, data = {}) => res.json({ ok: true, ...data });
const err = (res, message, code = 500) => res.status(code).json({ ok: false, error: message || "" });

app.get("/", (_req, res) => res.type("text/plain").send("OK"));

app.get("/health", (_req, res) => {
  ok(res, {
    service: "kb-backend",
    node: process.version,
    uptime_sec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get("/__diag", async (_req, res) => {
  try {
    await pool.query("select 1");
    ok(res, { db_ok: true });
  } catch (e) {
    err(res, e.message);
  }
});

const adminAuth = (req, res, next) => {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!ADMIN_TOKEN || tok !== ADMIN_TOKEN) return err(res, "unauthorized", 401);
  next();
};

const hash = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

app.get("/admin/kb/count", adminAuth, async (_req, res) => {
  try {
    const r = await pool.query("select count(*)::int as n from kb");
    ok(res, { count: r.rows[0]?.n ?? 0 });
  } catch (e) {
    err(res, e.message);
  }
});

app.get("/admin/kb/list", adminAuth, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "10", 10)));
    const r = await pool.query(
      "select id, content_hash, meta, created_at, updated_at from kb order by id desc limit $1",
      [limit]
    );
    ok(res, { rows: r.rows });
  } catch (e) {
    err(res, e.message);
  }
});

app.post("/admin/kb", adminAuth, async (req, res) => {
  try {
    const content = String(req.body?.content || "");
    const meta = req.body?.meta || {};
    if (!content) return err(res, "content required", 400);
    const content_hash = hash(content);
    const r = await pool.query(
      `insert into kb (content, meta, content_hash)
       values ($1, $2, $3)
       on conflict (content_hash) do update
         set updated_at = now()
       returning id, content_hash`,
      [content, meta, content_hash]
    );
    ok(res, { id: r.rows[0].id, content_hash });
  } catch (e) {
    err(res, e.message);
  }
});

app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});
