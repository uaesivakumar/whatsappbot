// server.js — WhatsApp Bot MVP (Siva-style with Intents + Memory + RAG)
// Works on Render with environment variables; local knowledge base supported
console.log("✅ Bot server starting with auto-deploy...");

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
dotenv.config();

const app = express();
app.use(express.json());

// =====================
// ENV
// =====================
const VERIFY_TOKEN    = process.env.META_VERIFY_TOKEN;
const ACCESS_TOKEN    = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;
const API_VERSION     = process.env.GRAPH_API_VERSION || "v20.0";
const PORT            = process.env.PORT || 10000;

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_MSISDN      = (process.env.ADMIN_MSISDN || "").replace(/[^\d]/g, "");

// =====================
// Utils & memory
// =====================
const log = (...args) => console.log(new Date().toISOString(), ...args);

const memoryStore = new Map(); // from -> { shortTerm: [{role, content}], profile: {} }
function getMem(from) {
  if (!memoryStore.has(from)) memoryStore.set(from, { shortTerm: [], profile: {} });
  return memoryStore.get(from);
}
function pushMem(from, role, content) {
  const mem = getMem(from);
  mem.shortTerm.push({ role, content, ts: Date.now() });
  if (mem.shortTerm.length > 10) mem.shortTerm.shift();
}
function summarizeShortTerm(from) {
  const mem = getMem(from);
  return mem.shortTerm
    .slice(-6)
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
}

// =====================
// RAG (knowledge folder)
// =====================
const knowledgeDir = path.join(process.cwd(), "knowledge");
let kb = [];

function chunk(text, maxChars = 800) {
  const parts = [];
  for (let i = 0; i < text.length; i += maxChars) {
    parts.push(text.slice(i, i + maxChars));
  }
  return parts;
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}
async function embedTexts(texts) {
  if (!texts.length) return [];
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts })
  });
  const data = await r.json();
  return data.data?.map(d => d.embedding) || [];
}
async function loadKnowledge() {
  kb = [];
  if (!fs.existsSync(knowledgeDir)) fs.mkdirSync(knowledgeDir, { recursive: true });
  const files = fs.readdirSync(knowledgeDir).filter(f => /\.(md|txt)$/i.test(f));
  let chunks = [];
  for (const f of files) {
    const txt = fs.readFileSync(path.join(knowledgeDir, f), "utf8");
    chunks = chunks.concat(chunk(txt, 900).map((t, i) => ({ id: `${f}#${i+1}`, text: t })));
  }
  if (!OPENAI_API_KEY) { kb = chunks.map(c => ({ ...c, embedding: [] })); return; }
  const embs = await embedTexts(chunks.map(c => c.text));
  kb = chunks.map((c, i) => ({ ...c, embedding: embs[i] }));
  log(`Knowledge indexed: ${kb.length} chunks`);
}
await loadKnowledge();
async function retrieve(query, topK = 4) {
  if (!OPENAI_API_KEY || !kb.length || !kb[0].embedding?.length) return [];
  const [qEmb] = await embedTexts([query]);
  return kb
    .map(k => ({ ...k, score: cosine(qEmb, k.embedding) }))
    .sort((a,b) => b.score - a.score)
    .slice(0, topK)
    .filter(s => s.score > 0.2);
}

// =====================
// Health
// =====================
app.get("/", (_req, res) => res.send("OK"));
app.get("/healthz", (_req, res) => res.json({ ok: true, kb: kb.length }));

// =====================
// Webhook
// =====================
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];
    const metadata = entry?.changes?.[0]?.value?.metadata;
    if (!message) return res.sendStatus(200);

    const from = message.from;
    const msgType = message.type;
    const text = msgType === "text" ? message.text?.body?.trim() || "" : "";

    log(`[IN] from=${from} text=${JSON.stringify(text)}`);
    pushMem(from, "user", text);

    // Admin commands
    if (from.endsWith(ADMIN_MSISDN) && /^admin:/i.test(text)) {
      const adminReply = await handleAdminCommand(text);
      await sendWhatsAppText(from, adminReply);
      pushMem(from, "assistant", adminReply);
      return res.sendStatus(200);
    }

    // Intents first
    const ruleReply = intentReply(text);
    let replyText;
    if (ruleReply) {
      replyText = ruleReply;
    } else {
      // Try RAG + GPT
      const hits = await retrieve(text);
      const context = hits.map(h => h.text).join("\n");
      replyText = await sivaAnswer(text, from, context);
    }

    await sendWhatsAppText(from, replyText);
    pushMem(from, "assistant", replyText);
    log(`[OUT] -> ${from} len=${replyText.length}`);
    res.sendStatus(200);
  } catch (e) {
    log("Webhook POST error:", e?.message || e);
    res.sendStatus(200);
  }
});

// =====================
// Intents
// =====================
function intentReply(t = "") {
  const text = t.toLowerCase();
  if (/cheque/.test(text)) return "Cheque book request: Use app → Services → Cheque Book. ETA 3–5 days.";
  if (/branch/.test(text)) return "Branch hours: Sun–Thu, 08:00–15:00.";
  if (/block.*card|lost.*card/.test(text)) return "Card block: In app → Cards → Block or call support.";
  if (/^hi|hello|hey/.test(text)) return "Hi! I’m Siva 🤖 Ask about cheque books, branch hours, or cards.";
  return null;
}

// =====================
// GPT fallback with persona
// =====================
async function sivaAnswer(userText, from, ragContext) {
  const history = summarizeShortTerm(from);
  const system = `You are "Siva", a concise WhatsApp assistant.
Facts:\n${ragContext || "(none)"}\nHistory:\n${history}`;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userText }
        ],
        temperature: 0.3
      })
    });
    const data = await r.json();
    return data?.choices?.[0]?.message?.content?.trim() || "Got it.";
  } catch {
    return "Sorry, I hit an error.";
  }
}

// =====================
// WhatsApp send
// =====================
async function sendWhatsAppText(to, text) {
  const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text.slice(0, 4000) } };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
    body: JSON.stringify(payload)
  });
  log("WA send", r.status);
}

// =====================
// Admin commands
// =====================
async function handleAdminCommand(text) {
  const t = text.toLowerCase();
  if (t.includes("ping")) return "pong ✅";
  if (t.includes("reindex")) { await loadKnowledge(); return `Reindexed: ${kb.length} chunks`; }
  if (t.includes("mem clear")) { memoryStore.clear(); return "Memory cleared."; }
  return "Admin cmds: admin:ping | admin:reindex | admin:mem clear";
}

// =====================
// Start
// =====================
app.listen(PORT, () => log(`Server listening on ${PORT}, KB=${kb.length}`));
