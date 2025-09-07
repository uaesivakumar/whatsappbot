import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pkg from "pg";
import session from "express-session";

dotenv.config();
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 10000;

// trust Render proxy so secure cookies work
app.set("trust proxy", 1);

// ---- DB ----
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ---- Middleware ----
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change_this_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,         // HTTPS on Render
      httpOnly: true,
      sameSite: "strict"
    }
  })
);

// ---- Health / Diag ----
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/__diag", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db_ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, db_ok: false, error: e.message });
  }
});

// ---- Auth ----
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "invalid credentials" });
});

app.post("/admin/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: "unauthorized" });
}

// ---- Schema init ----
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      content TEXT NOT NULL,
      meta JSONB,
      embedding JSONB,
      updated_at TIMESTAMPTZ DEFAULT now(),
      content_hash TEXT UNIQUE
    );
  `);
}
ensureSchema().catch((e) => console.error("Schema init failed:", e));

// ---- KB API (protected) ----
app.get("/admin/kb/count", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT COUNT(*) FROM kb_chunks");
    res.json({ count: parseInt(rows[0].count, 10) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/admin/kb/list", requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || "20", 10)));
  try {
    const { rows } = await pool.query(
      "SELECT * FROM kb_chunks ORDER BY updated_at DESC LIMIT $1",
      [limit]
    );
    res.json({ rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/admin/kb", requireAdmin, async (req, res) => {
  const { content, meta } = req.body || {};
  if (!content) return res.status(400).json({ error: "content required" });
  const crypto = await import("crypto");
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  try {
    const result = await pool.query(
      `INSERT INTO kb_chunks (content, meta, content_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (content_hash) DO UPDATE
         SET updated_at = now()
       RETURNING *`,
      [content, meta || {}, hash]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Static: root site ----
app.use(express.static(path.join(__dirname, "public")));

// ---- Static: /console (assets) ----
const consoleDir = path.join(__dirname, "console/public");
app.use("/console", express.static(consoleDir));

// ---- Explicit index for /console (no trailing slash) ----
app.get("/console", (req, res) => {
  res.sendFile(path.join(consoleDir, "index.html"));
});

// ---- 404 (optional) ----
app.use((req, res) => {
  res.status(404).send("Not found");
});

// ---- Start ----
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
