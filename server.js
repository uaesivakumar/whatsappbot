// server.js — ultra-thin: wires Express, WA webhook, intents, memory, and RAG.

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
const PORT             = process.env.PORT || 10000;

let _fetch = globalThis.fetch;
if (typeof _fetch !== "function") {
  const nf = await import("node-fetch");
  _fetch = nf.default;
}

// Load intents.json
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

// Modular imports
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

// Memory layer
let store = null, summarizer = null;
try {
  store = await import("./src/memory/store.js");
  summarizer = await import("./src/memory/summarizer.js");
  await store.init();
  console.log("✅ Memory layer initialized");
} catch (e) {
  console.warn("ℹ️ Memory layer not initialized:", e?.message);
}

// Short-term in-memory context (for quick window)
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

// Fallback naive detect
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

// Create WA sender
import { createSender } from "./src/wa/send.js";
const { sendText } = createSender({
  accessToken: ACCESS_TOKEN,
  phoneNumberId: PHONE_NUMBER_ID,
  fetchImpl: _fetch
});

// Brain
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

  return "I didn’t fully catch that. Could you share a bit more or phrase it differently?";
}

// Message handler used by webhook
async function onTextMessage({ waId, text }) {
  try {
    if (store?.appendMessage) await store.appendMessage({ waId, role: "user", text });
    rememberShort(waId, "user", text);

    const reply = await generateReply({ waId, text });

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

// Express + webhook
import { registerWebhook } from "./src/wa/webhook.js";
const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (_, res) => res.send("OK"));

registerWebhook({
  app,
  verifyToken: VERIFY_TOKEN,
  onTextMessage
});

app.listen(PORT, () => {
  console.log(`✅ Bot server running on port ${PORT}`);
  if (!VERIFY_TOKEN || !ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.warn("⚠️ Missing one or more env vars: VERIFY_TOKEN / ACCESS_TOKEN / PHONE_NUMBER_ID");
  }
});
