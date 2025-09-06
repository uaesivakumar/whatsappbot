import express from "express";
import crypto from "crypto";
import pg from "pg";
import { fileURLToPath } from "url";
import path from "path";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]));
  return "{" + entries.join(",") + "}";
}

function normalizeMeta(meta) {
  if (meta === null || meta === undefined) return {};
  if (typeof meta === "string") {
    try {
      const parsed = JSON.parse(meta);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return { value: meta };
    }
  }
  if (typeof meta !== "object") return { value: meta };
  return meta;
}

function computeHash(content, metaObj) {
  const normalizedMeta = stableStringify(metaObj);
  const data = `${content}\n---\n${normalizedMeta}`;
  return crypto.createHash("sha256").update(data).digest("hex");
}

function adminAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    uptime_sec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    service: "kb-backend",
    node: process.version,
  });
});

app.get("/__diag", async (req, res) => {
  try {
    const r = await pool.query("select 1 as ok");
    res.json({
      ok: true,
      db_ok: r?.rows?.[0]?.ok === 1,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/admin/kb/count", adminAuth, async (req, res) => {
  try {
    const r = await pool.query(`select count(*)::int as count from kb_chunks`);
    res.json({ count: r.rows[0].count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/admin/kb/list", adminAuth, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  try {
    const r = await pool.query(
      `select id, content, meta, content_hash, updated_at
       from kb_chunks
       order by updated_at desc
       limit $1 offset $2`,
      [limit, offset]
    );
    res.json({ items: r.rows, limit, offset });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/admin/kb", adminAuth, async (req, res) => {
  try {
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    const metaObj = normalizeMeta(req.body?.meta);
    if (!content) return res.status(400).json({ error: "content required" });

    const content_hash = computeHash(content, metaObj);

    const client = await pool.connect();
    try {
      const pre = await client.query(
        `select id from kb_chunks where content_hash = $1`,
        [content_hash]
      );
      if (pre.rowCount > 0) {
        return res.json({ id: pre.rows[0].id, content_hash, deduped: true });
      }

      try {
        const ins = await client.query(
          `insert into kb_chunks (content, meta, content_hash)
           values ($1, $2, $3)
           returning id`,
          [content, metaObj, content_hash]
        );
        return res.json({ id: ins.rows[0].id, content_hash, deduped: false });
      } catch (e) {
        if (e.code === "23505") {
          const again = await client.query(
            `select id from kb_chunks where content_hash = $1`,
            [content_hash]
          );
          if (again.rowCount > 0) {
            return res.json({ id: again.rows[0].id, content_hash, deduped: true });
          }
        }
        throw e;
      }
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.listen(PORT, () => {
  console.log(`server listening on ${PORT} (${__dirname})`);
});
