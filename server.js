// server.js — WhatsApp Bot MVP (Modular Intents + Memory + RAG)
// Works on Render with env vars; auto-detects your new /src/* modules when present.

import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// If your Node version already has global fetch, no need for node-fetch.
// render often uses Node 18+, so global fetch exists; otherwise fallback.
let _fetch = globalThis.fetch;
if (typeof _fetch !== "function") {
  const nf = await import("node-fetch");
  _fetch = nf.default;
}

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== ENV =====
const VERIFY_TOKEN     = process.env.META_VERIFY_TOKEN   || process.env.VERIFY_TOKEN;
const ACCESS_TOKEN     = process.env.META_ACCESS_TOKEN   || process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID  = process.env.META_PHONE_NUMBER_ID|| process.env.PHONE_NUMBER_ID;
const PORT             = process.env.PORT || 10000;

// ===== Load Intents =====
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

// ===== Optional Modular Imports (safe fallbacks if not ready) =====
let detectIntent, routeIntent; // from /src/intents
try {
  const intentsRouter = await import(path.join(__dirname, "src/intents/index.js"));
  // Support either named or default exports
  detectIntent = intentsRouter.detectIntent || intentsRouter.default?.detectIntent;
  routeIntent  = intentsRouter.routeIntent  || intentsRouter.default?.routeIntent
              || intentsRouter.handleIntent || intentsRouter.default?.handleIntent;
  if (detectIntent || routeIntent) {
    console.log("✅ Using modular intents from /src/intents/index.js");
  }
} catch {
  console.warn("ℹ️ /src/intents/index.js not found or not exporting detectIntent/routeIntent — using basic fallback.");
}

// (Optional) dedicated classifier (if you split it)
try {
  if (!detectIntent) {
    const cls = await import(path.join(__dirname, "src/intents/classifier.js"));
    detectIntent = cls.detectIntent || cls.default?.detectIntent || detectIntent;
    if (detectIntent) console.log("✅ Using classifier from /src/intents/classifier.js");
  }
} catch { /* ignore */ }

// RAG module
let ragAnswer;
try {
  const rag = await import(path.join(__dirname, "src/rag/index.js"));
  ragAnswer = rag.answer || rag.default?.answer;
  if (ragAnswer) console.log("✅ RAG enabled via /src/rag/index.js");
} catch {
  console.warn("ℹ️ /src/rag/index.js not found; RAG fallback disabled.");
}

// ===== Memory (in-memory short context; can be swapped for Supabase later) =====
const MEMORY = new Map(); // key: waId, value: [{role:'user'|'bot', text, ts}]
const remember = (waId, role, text) => {
  const arr = MEMORY.get(waId) || [];
  arr.push({ role, text, ts: Date.now() });
  // keep last 20 messages (~10 turns)
  if (arr.length > 20) arr.splice(0, arr.length - 20);
  MEMORY.set(waId, arr);
};
const recentContext = (waId) => MEMORY.get(waId) || [];

// ===== Fallback: naive regex intent if no classifier yet =====
const naiveDetect = (text) => {
  const t = (text || "").toLowerCase();
  let best = { name: "unknown", confidence: 0.0 };
  for (const it of INTENTS) {
    const name = it.name || it.intent || "unknown";
    const patterns = (it.examples || it.utterances || []);
    for (const p of patterns) {
      if (t.includes(String(p).toLowerCase())) {
        best = { name, confidence: 0.7 };
        break;
      }
    }
    if (best.name !== "unknown") break;
  }
  return best;
};

// ===== WhatsApp send (local; can move to /src/wa/send.js later) =====
async function sendText(to, text) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  };
  const res = await _fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const ok = res.ok;
  let info = "";
  try { info = await res.text(); } catch {}
  console.log("[OUT]", to, "len=" + (text?.length || 0), "status=" + res.status, info?.slice(0, 180));
  return ok;
}

// ===== Brain =====
async function generateReply({ waId, text }) {
  // 1) Intent detect
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

  // 2) If confident, route to intent handler if available
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

  // 3) RAG fallback
  if (typeof ragAnswer === "function") {
    try {
      const reply = await ragAnswer(text, {
        memory: recentContext(waId),
        userId: waId,
        // supply any kb/vector store params here when ready
      });
      if (reply) return reply;
    } catch (err) {
      console.error("RAG error:", err);
    }
  }

  // 4) Last resort
  return "I didn’t fully catch that. Could you share a bit more or phrase it differently?";
}

// ===== Express App =====
const app = express();
app.use(express.json({ limit: "2mb" }));

// Health
app.get("/", (_, res) => res.send("OK"));

// Verify webhook (Meta)
app.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  } catch {
    return res.sendStatus(403);
  }
});

// Receive messages
app.post("/webhook", async (req, res) => {
  try {
    // Ack quickly to Meta
    res.sendStatus(200);

    const body = req.body;
    const entries = body?.entry || [];
    for (const entry of entries) {
      const changes = entry?.changes || [];
      for (const change of changes) {
        const messages = change?.value?.messages || [];
        for (const msg of messages) {
          if (!msg || msg.type !== "text") continue;

          const waId = msg?.from;
          const text = msg?.text?.body || "";
          console.log("[IN]", "from=" + waId, "type=" + msg.type, "text=" + JSON.stringify(text));

          // memory & reply
          remember(waId, "user", text);
          const reply = await generateReply({ waId, text });
          await sendText(waId, reply);
          remember(waId, "bot", reply);
        }
      }
    }
  } catch (err) {
    console.error("Webhook POST error:", err);
    // Already ACKed; just log failures
  }
});

app.listen(PORT, () => {
  console.log(`✅ Bot server running on port ${PORT}`);
  if (!VERIFY_TOKEN || !ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.warn("⚠️ Missing one or more env vars: VERIFY_TOKEN / ACCESS_TOKEN / PHONE_NUMBER_ID");
  }
});
