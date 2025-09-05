// server.js — Express wiring: WA webhook, intents, memory, RAG + health/cron/admin

import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VERIFY_TOKEN     = process.env.META_VERIFY_TOKEN   || process.env.VERIFY_TOKEN;
const ACCESS_TOKEN     = process.env.META_ACCESS_TOKEN   || process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID  = process.env.META_PHONE_NUMBER_ID|| process.env.PHONE_NUMBER_ID;
const CRON_SECRET      = process.env.CRON_SECRET || "";
const ADMIN_TOKEN      = process.env.ADMIN_TOKEN || "";
const PORT             = process.env.PORT || 10000;

let _fetch = globalThis.fetch;
if (typeof _fetch !== "function") {
  const nf = await import("node-fetch");
  _fetch = nf.default;
}

const intentsPath = path.join(__dirname, "intents.json");
let INTENTS = [];
try {
  if (fs.existsSync(intentsPath)) {
    INTENTS = JSON.parse(fs.readFileSync(intentsPath, "utf8"));
    if (!Array.isArray(INTENTS)) throw new Error("intents.json must export an array");
  } else {
    console.warn("intents.json not found at project root; INTENTS will be empty []");
  }
} catch (err) {
  console.error("Failed to load intents.json:", err.message);
  INTENTS = [];
}

let detectIntent, routeIntent;
try {
  const intentsRouter = await import(path.join(__dirname, "src/intents/index.js"));
  detectIntent = intentsRouter.detectIntent || intentsRouter.default?.detectIntent;
  routeIntent  = intentsRouter.routeIntent  || intentsRouter.default?.routeIntent
              || intentsRouter.handleIntent || intentsRouter.default?.handleIntent;
  if (detectIntent || routeIntent) console.log("✅ Using modular intents from /src/intents/index.js");
} catch {
  console.warn("ℹ️ /src/intents/index.js not found or not exporting detectIntent/routeIntent — using fallback.");
}

let ragAnswer;
try {
  const rag = await import(path.join(__dirname, "src/rag/index.js"));
  ragAnswer = rag.answer || rag.default?.answer;
  if (ragAnswer) console.log("✅ RAG enabled via /src/rag/index.js");
} catch {
  console.warn("ℹ️ /src/rag/index.js not found; RAG fallback disabled.");
}

let store = null, summarizer = null;
try {
  store = await import("./src/memory/store.js");
  summarizer = await import("./src/memory/summarizer.js");
  await store.init();
  console.log("✅ Memory layer initialized");
} catch (e) {
  console.warn("ℹ️ Memory layer not initialized:", e?.message);
}

let profiles = null;
try {
  profiles = await import("./src/memory/profiles.js");
  console.log("✅ Profiles store ready");
} catch (e) {
  console.warn("ℹ️ Profiles store not found:", e?.message);
}

const MEMORY = new Map();
function rememberShort(waId, role, text) {
  const arr = MEMORY.get(waId) || [];
  arr.push({ role, text, ts: Date.now() });
  if (arr.length > 20) arr.splice(0, arr.length - 20);
  MEMORY.set(waId, arr);
}
function recentContext(waId) {
  return MEMORY.get(waId) || [];
}

function naiveDetect(text) {
  const t = (text || "").toLowerCase();
  let best = { name: "unknown", confidence: 0.0 };
  for (const it of INTENTS) {
    const name = it.name || it.intent || "unknown";
    const pats = it.examples || it.utterances || [];
    for (const p of pats) {
      if (t.includes(String(p).toLowerCase())) {
        best = { name, confidence: 0.7 };
        break;
      }
    }
    if (best.name !== "unknown") break;
  }
  return best;
}

import { createSender } from "./src/wa/send.js";
const { sendText } = createSender({
  accessToken: ACCESS_TOKEN,
  phoneNumberId: PHONE_NUMBER_ID,
  fetchImpl: _fetch
});

const FALLBACK = "I didn’t fully catch that. Could you share a bit more or phrase it differently?";

async function generateReply({ waId, text }) {
  let intentRes;
  try {
    if (typeof detectIntent === "function") {
      intentRes = await detectIntent(text, INTENTS, { context: recentContext(waId) });
    } else {
      intentRes = naiveDetect(text);
    }
  } catch (err) {
    console.error("detectIntent error:", err);
    intentRes = { name: "unknown", confidence: 0.0 };
  }

  if (intentRes && intentRes.name !== "unknown" && (intentRes.confidence ?? 0) >= 0.6) {
    try {
      if (typeof routeIntent === "function") {
        const reply = await routeIntent(intentRes.name, text, {
          intents: INTENTS,
          memory: recentContext(waId),
          waId
        });
        if (reply) return reply;
      }
    } catch (err) {
      console.error("routeIntent error:", err);
    }
  }

  if (typeof ragAnswer === "function") {
    try {
      const reply = await ragAnswer(text, {
        memory: recentContext(waId),
        userId: waId
      });
      if (reply) return reply;
    } catch (err) {
      console.error("RAG error:", err);
    }
  }

  return FALLBACK;
}

import { registerWebhook } from "./src/wa/webhook.js";
import { toCsv } from "./src/admin/export.js";
import { profilesToCsv } from "./src/admin/export_profiles.js";
import * as Profiles from "./src/memory/profiles.js";
import { onUserTextCapture } from "./src/memory/capture.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (_, res) => res.send("OK"));
app.get("/healthz", (_, res) => res.status(200).json({ ok: true, uptime: process.uptime() }));

app.post("/cron/summarize", async (req, res) => {
  try {
    const secret = req.headers["x-cron-secret"];
    if (!CRON_SECRET || secret !== CRON_SECRET) return res.sendStatus(403);
    const waId = req.query.waId || req.body?.waId;
    if (!waId) return res.status(400).json({ error: "waId required" });
    if (!summarizer?.buildAndSaveSummary) return res.status(500).json({ error: "summarizer not ready" });
    const summary = await summarizer.buildAndSaveSummary(waId);
    return res.status(200).json({ waId, summarized: !!summary });
  } catch (e) {
    console.error("cron summarize error:", e);
    return res.sendStatus(500);
  }
});

function isAdmin(req) {
  const secret = req.headers["x-admin-secret"];
  return (ADMIN_TOKEN && secret === ADMIN_TOKEN) || (!ADMIN_TOKEN && CRON_SECRET && secret === CRON_SECRET);
}

app.get("/admin/summary", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.sendStatus(403);
    const waId = req.query.waId;
    if (!waId) return res.status(400).json({ error: "waId required" });
    if (!store?.getLatestSummary) return res.status(500).json({ error: "summary store not ready" });
    const latest = await store.getLatestSummary(waId);
    if (!latest) return res.status(404).json({ waId, summary: null, updated_at: null });
    return res.status(200).json({ waId, summary: latest.summary, updated_at: latest.updated_at });
  } catch (e) {
    console.error("admin summary error:", e);
    return res.sendStatus(500);
  }
});

app.get("/admin/messages", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.sendStatus(403);
    const waId = req.query.waId;
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 500);
    if (!waId) return res.status(400).json({ error: "waId required" });
    if (!store?.fetchRecentMessages) return res.status(500).json({ error: "message store not ready" });
    const rows = await store.fetchRecentMessages({ waId, limit });
    return res.status(200).json({ waId, count: rows.length, messages: rows });
  } catch (e) {
    console.error("admin messages error:", e);
    return res.sendStatus(500);
  }
});

app.get("/admin/export.csv", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.sendStatus(403);
    const waId = req.query.waId;
    const limit = Math.min(parseInt(req.query.limit || "1000", 10), 5000);
    if (!waId) return res.status(400).json({ error: "waId required" });
    if (!store?.fetchRecentMessages) return res.status(500).json({ error: "message store not ready" });
    const rows = await store.fetchRecentMessages({ waId, limit });
    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="chat_${waId}.csv"`);
    return res.status(200).send(csv);
  } catch (e) {
    console.error("admin export error:", e);
    return res.sendStatus(500);
  }
});

app.get("/admin/profile", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.sendStatus(403);
    if (!profiles?.getProfile) return res.status(500).json({ error: "profiles store not ready" });
    const waId = req.query.waId;
    if (!waId) return res.status(400).json({ error: "waId required" });
    const p = await profiles.getProfile(waId);
    return res.status(200).json({ waId, profile: p });
  } catch (e) {
    console.error("admin getProfile error:", e);
    return res.sendStatus(500);
  }
});

app.post("/admin/profile", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.sendStatus(403);
    if (!profiles?.upsertProfile) return res.status(500).json({ error: "profiles store not ready" });
    const waId = req.body?.waId || req.query.waId;
    const { company, salary_aed, prefers, notes } = req.body || {};
    if (!waId) return res.status(400).json({ error: "waId required" });
    await profiles.upsertProfile(waId, { company, salary_aed, prefers, notes });
    const p = await profiles.getProfile(waId);
    return res.status(200).json({ waId, profile: p, saved: true });
  } catch (e) {
    console.error("admin upsertProfile error:", e);
    return res.sendStatus(500);
  }
});

async function onTextMessage({ waId, text }) {
  try {
    if (store?.appendMessage) await store.appendMessage({ waId, role: "user", text });
    rememberShort(waId, "user", text);

    let captured = null;
    try {
      captured = await (await import("./src/memory/capture.js")).onUserTextCapture(waId, text, profiles);
    } catch (e) {
      console.warn("capture error:", e?.message);
    }

    let reply = await generateReply({ waId, text });

    if (captured && Object.keys(captured).length > 0) {
      const parts = [];
      if (captured.salary_aed) parts.push(`noted your salary as AED ${Number(captured.salary_aed).toLocaleString()}`);
      if (captured.prefers) {
        const prefMap = { cashback: "cashback", travel: "travel", no_fee: "no annual fee" };
        parts.push(`noted your preference: ${prefMap[captured.prefers] || captured.prefers}`);
      }
      if (captured.liabilities_aed) parts.push(`noted your liabilities as AED ${Number(captured.liabilities_aed).toLocaleString()}`);
      const ack = parts.length ? `Got it — ${parts.join("; ")}.` : null;

      if (ack) {
        if (reply === FALLBACK) reply = ack;
        else reply = `${reply}\n\n(${ack})`;
      }
    }

    await sendText(waId, reply);
    if (store?.appendMessage) await store.appendMessage({ waId, role: "bot", text: reply });
    rememberShort(waId, "bot", reply);

    if (summarizer?.shouldSummarize && summarizer?.buildAndSaveSummary) {
      summarizer.shouldSummarize(waId)
        .then(yes => yes ? summarizer.buildAndSaveSummary(waId) : null)
        .catch(err => console.warn("summary error:", err?.message));
    }
  } catch (e) {
    console.error("onTextMessage fatal error:", e);
  }
}

// Admin: export all profiles CSV
app.get("/admin/search", async (req, res) => {
  try {
    const secret = req.headers["x-admin-secret"];
    const ok = (ADMIN_TOKEN && secret === ADMIN_TOKEN) || (!ADMIN_TOKEN && CRON_SECRET && secret === CRON_SECRET);
    if (!ok) return res.sendStatus(403);
    const company = req.query.company || null;
    const prefers = req.query.prefers || null;
    const min_salary = req.query.min_salary ? Number(req.query.min_salary) : null;
    const max_salary = req.query.max_salary ? Number(req.query.max_salary) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 1000;
    const rows = await Profiles.searchProfiles({ company, prefers, min_salary, max_salary, limit });
    return res.status(200).json({ count: rows.length, rows });
  } catch (e) {
    console.error("admin search error:", e);
    return res.sendStatus(500);
  }
});

app.get("/admin/search.csv", async (req, res) => {
  try {
    const secret = req.headers["x-admin-secret"];
    const ok = (ADMIN_TOKEN && secret === ADMIN_TOKEN) || (!ADMIN_TOKEN && CRON_SECRET && secret === CRON_SECRET);
    if (!ok) return res.sendStatus(403);
    const company = req.query.company || null;
    const prefers = req.query.prefers || null;
    const min_salary = req.query.min_salary ? Number(req.query.min_salary) : null;
    const max_salary = req.query.max_salary ? Number(req.query.max_salary) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 1000;
    const rows = await Profiles.searchProfiles({ company, prefers, min_salary, max_salary, limit });
    const csv = profilesToCsv(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"profiles_search.csv\"");
    return res.status(200).send(csv);
  } catch (e) {
    console.error("admin search.csv error:", e);
    return res.sendStatus(500);
  }
});

registerWebhook({ app, verifyToken: VERIFY_TOKEN, onTextMessage });

app.listen(PORT, () => {
  console.log(`✅ Bot server running on port ${PORT}`);
  if (!VERIFY_TOKEN || !ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.warn("⚠️ Missing one or more env vars: VERIFY_TOKEN / ACCESS_TOKEN / PHONE_NUMBER_ID");
  }
});
