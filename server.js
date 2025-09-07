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

// Trust Render proxy so secure cookies work
app.set("trust proxy", 1);

// ---------- DB ----------
const DB_URL = process.env.DATABASE_URL || "";
const pool = new Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------- Middleware ----------
app.use(express.json());

// Session store in Postgres (production-safe)
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
      secure: true,        // HTTPS on Render
      httpOnly: true,
      sameSite: "strict",
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
    name: "sid",
  })
);

// ---------- Health & Diag ----------
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

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

// ---------- Auth (username/password) ----------
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS
  ) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "invalid credentials" });
});

app.post("/admin/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/admin/me", (req, res) => {
  res.json({ authed: Boolean(req.session && req.session.isAdmin) });
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "unauthorized" });
}

// ---------- Bootstrap schema ----------
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      content TEXT NOT NULL,
      meta JSONB,
      embedding JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      content_hash TEXT NOT NULL UNIQUE
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS kb_chunks_updated_at_idx ON kb_chunks (updated_at DESC);`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS kb_chunks_meta_gin_idx ON kb_chunks USING GIN (meta);`
  );
}
ensureSchema().catch((e) => console.error("ensureSchema error:", e));

// ---------- Helpers ----------
const normalizeSearch = (s) =>
  (s || "")
    .toString()
    .trim();

const searchSqlAndParams = (search, startIndex = 1) => {
  const s = normalizeSearch(search);
  if (!s) return { where: "", params: [] };
  // ILIKE with %term% on both content and meta::text
  return {
    where: `WHERE (content ILIKE $${startIndex} OR meta::text ILIKE $${startIndex})`,
    params: [`%${s}%`],
  };
};

// ---------- KB API (protected) ----------

// Filtered count: /admin/kb/count?search=foo
app.get("/admin/kb/count", requireAdmin, async (req, res) => {
  try {
    const { where, params } = searchSqlAndParams(req.query.search, 1);
    const q = `SELECT COUNT(*) FROM kb_chunks ${where}`;
    const { rows } = await pool.query(q, params);
    res.json({ count: parseInt(rows[0].count, 10) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// List with pagination & search: /admin/kb/list?limit=20&offset=0&search=foo
app.get("/admin/kb/list", requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || "20", 10)));
  const offset = Math.max(0, parseInt(req.query.offset || "0", 10));
  try {
    const { where, params } = searchSqlAndParams(req.query.search, 1);
    const q = `
      SELECT id, content, meta, updated_at, content_hash
      FROM kb_chunks
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

// Create
app.post("/admin/kb", requireAdmin, async (req, res) => {
  const content = (req.body?.content ?? "").toString();
  const meta = req.body?.meta ?? {};
  if (!content.trim()) return res.status(400).json({ error: "content_required" });

  const { createHash } = await import("crypto");
  const hash = createHash("sha256").update(content, "utf8").digest("hex");

  try {
    const q = `
      INSERT INTO kb_chunks (content, meta, content_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (content_hash) DO UPDATE
        SET updated_at = now()
      RETURNING *
    `;
    const r = await pool.query(q, [content, meta, hash]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Update (edit)
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
      UPDATE kb_chunks
      SET content = $1,
          meta = $2,
          content_hash = $3,
          updated_at = now()
      WHERE id = $4
      RETURNING *
    `;
    const r = await pool.query(q, [content, meta, hash, id]);
    if (!r.rows.length) return res.status(404).json({ error: "not_found" });
    res.json(r.rows[0]);
  } catch (e) {
    // Unique violation on content_hash → treat as upsert/duplicate notice
    if (String(e.code) === "23505") {
      return res.status(409).json({ error: "duplicate_content" });
    }
    res.status(500).json({ error: String(e) });
  }
});

// Delete
app.delete("/admin/kb/:id", requireAdmin, async (req, res) => {
  const id = (req.params.id || "").toString();
  if (!id) return res.status(400).json({ error: "id_required" });
  try {
    const q = `DELETE FROM kb_chunks WHERE id = $1 RETURNING id`;
    const r = await pool.query(q, [id]);
    if (!r.rows.length) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---------- Static files ----------
// Root site (serve ./public at "/")
app.use(express.static(path.join(__dirname, "public")));

// Admin console assets (serve ./console/public at "/console/*")
const consoleDir = path.join(__dirname, "console", "public");
app.use("/console", express.static(consoleDir));

// Explicit index for "/console" (no trailing slash)
app.get("/console", (_req, res) => {
  res.sendFile(path.join(consoleDir, "index.html"));
});

// ---------- Debug helpers ----------
app.get("/debug/console-path", (_req, res) => {
  const indexPath = path.join(consoleDir, "index.html");
  res.json({
    consoleDir,
    indexFile: indexPath,
    exists: fs.existsSync(indexPath),
  });
});

app.get("/debug/list-console-files", async (_req, res) => {
  try {
    const files = await fsp.readdir(consoleDir);
    res.json({ consoleDir, files });
  } catch (e) {
    res.status(500).json({ consoleDir, error: String(e) });
  }
});

// Optional: 404
app.use((_req, res) => {
  res.status(404).send("Not found");
});

// ---------- Start ----------
app.listen(PORT, async () => {
  try {
    await ensureSchema();
  } catch {}
  console.log(`Server running on port ${PORT}`);
});
