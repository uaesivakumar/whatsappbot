// server.js — Siva-style MVP with Intents + Context Memory + RAG
// Works on Render, no new npm deps (uses fs/path). Supabase logging still optional.

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
const VERIFY_TOKEN      = process.env.META_VERIFY_TOKEN;
const ACCESS_TOKEN      = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID   = process.env.META_PHONE_NUMBER_ID;
const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
const API_VERSION       = process.env.GRAPH_API_VERSION || "v20.0";
const PORT              = process.env.PORT || 10000;

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_MSISDN      = (process.env.ADMIN_MSISDN || "").replace(/[^\d]/g, "");

// =====================
// Utils & logging
// =====================
const log = (...args) => console.log(new Date().toISOString(), ...args);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// =====================
// In-memory contextual memory (per user)
// shortTerm: last 10 msgs   profile: lightweight facts/preferences
// =====================
const memoryStore = new Map(); // from -> { shortTerm: [{role, content, ts}], profile: {} }

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
  // We’ll just compress to last 6 user/assistant lines to keep prompt small
  const items = mem.shortTerm.slice(-6).map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  return items || "";
}

// =====================
// RAG — load local knowledge, chunk it, embed, cosine search
// Folder: ./knowledge/*.md (you create this below)
// =====================
const knowledgeDir = path.join(process.cwd(), "knowledge");
let kb = []; // [{ id, text, embedding: number[] }]

function chunk(text, maxChars = 800) {
  const parts = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.slice(i, i + maxChars));
    i += maxChars;
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
  if (!fs.existsSync(knowledgeDir)) {
    log("knowledge dir missing — creating", knowledgeDir);
    fs.mkdirSync(knowledgeDir, { recursive: true });
  }
  // read all md/txt
  const files = fs.readdirSync(knowledgeDir).filter(f => /\.(md|txt)$/i.test(f));
  let chunks = [];
  for (const f of files) {
    const full = path.join(knowledgeDir, f);
    const txt = fs.readFileSync(full, "utf8");
    const fileChunks = chunk(txt, 900).map((t, idx) => ({ id: `${f}#${idx+1}`, text: t }));
    chunks = chunks.concat(fileChunks);
  }
  if (!OPENAI_API_KEY) {
    log("No OPENAI_API_KEY; knowledge loaded without embeddings (RAG disabled).");
    kb = chunks.map((c) => ({ ...c, embedding: [] }));
    return;
  }
  // embed in batches to be gentle
  const batchSize = 16;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const embs = await embedTexts(batch.map(b => b.text));
    for (let j = 0; j < batch.length; j++) {
      kb.push({ id: batch[j].id, text: batch[j].text, embedding: embs[j] });
    }
    await sleep(200); // small pause
  }
  log(`Knowledge indexed: ${kb.length} chunks`);
}

async function retrieve(query, topK = 4) {
  if (!OPENAI_API_KEY || !kb.length || !kb[0].embedding?.length) return [];
  const [qEmb] = await embedTexts([query]);
  const scored = kb.map(k => ({ ...k, score: cosine(qEmb, k.embedding) }));
  scored.sort((a,b) => b.score - a.score);
  // filter weak matches
  return scored.slice(0, topK).filter(s => s.score > 0.2);
}

// index once at boot
await loadKnowledge();

// =====================
// Health
// =====================
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true, kb: kb.length }));

// =====================
// Webhook verify
// =====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    log("Webhook verified ✅");
    return res.status(200).send(challenge);
  }
  log("Webhook verify failed ❌");
  return res.sendStatus(403);
});

// =====================
// Webhook receive
// =====================
app.post("/webhook", async (req, res) => {
  log("Webhook POST hit");
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const metadata = value?.metadata;
    const toBusinessId = metadata?.phone_number_id;
    const toDisplay = metadata?.display_phone_number;

    if (!message) return res.sendStatus(200);

    const from = String(message.from || "");
    const msgType = message.type;
    let text = "";
    if (msgType === "text") text = (message.text?.body || "").trim();
    else if (msgType === "interactive") text = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
    else text = `[${msgType}]`;

    log(`[IN] from=${from} type=${msgType} text=${JSON.stringify(text)}`);

    // memory: store user utterance
    pushMem(from, "user", text);

    // optional DB log (inbound)
    await logMsg({
      wa_from: from,
      wa_to: toDisplay || toBusinessId || PHONE_NUMBER_ID || null,
      direction: "in",
      body: text,
      intent: null,
      meta: { raw_type: msgType }
    });

    // admin commands (from you)
    const fromDigits = from.replace(/[^\d]/g, "");
    if (ADMIN_MSISDN && (fromDigits === ADMIN_MSISDN || fromDigits.endsWith(ADMIN_MSISDN)) && /^admin:/i.test(text)) {
      const adminReply = await handleAdminCommand(text);
      await sendWhatsAppText(from, adminReply);
      pushMem(from, "assistant", adminReply);
      log(`[OUT] admin -> ${from} len=${adminReply.length}`);
      await logMsg({
        wa_from: toDisplay || toBusinessId,
        wa_to: from,
        direction: "out",
        body: adminReply,
        intent: "admin",
        meta: null
      });
      return res.sendStatus(200);
    }

    // Route: intents → RAG → GPT
    const ruleReply = intentReply(text);
    let replyText;
    let intentName = null;

    if (ruleReply) {
      replyText = ruleReply;
      intentName = ruleReply.includes("Cheque book") ? "cheque"
                 : ruleReply.includes("Branch hours") ? "hours"
                 : ruleReply.includes("Card block") ? "card"
                 : "rule";
    } else {
      // RAG retrieve
      const hits = await retrieve(text, 4);
      const context = hits.map(h => `- (score ${h.score.toFixed(2)}) ${h.text}`).join("\n");
      replyText = await sivaAnswer(text, from, context);
      intentName = hits.length ? "rag" : "gpt";
    }

    await sendWhatsAppText(from, replyText);
    pushMem(from, "assistant", replyText);
    log(`[OUT] -> ${from} len=${replyText.length}`);

    await logMsg({
      wa_from: toDisplay || toBusinessId,
      wa_to: from,
      direction: "out",
      body: replyText,
      intent: intentName,
      meta: null
    });

    res.sendStatus(200);
  } catch (e) {
    log("Webhook POST error:", e?.message || e);
    res.sendStatus(200);
  }
});

// =====================
// Intents (rules)
// =====================
function intentReply(text = "") {
  const t = (text || "").toLowerCase();

  if (/cheque|check\s*book|chequebook/.test(t)) {
    return `Cheque book request:
1) Open your banking app → Services → Cheque Book
2) Choose account + leaves (25/50)
3) Confirm address or branch pickup
ETA: 3–5 working days.`;
  }

  if (/(branch|working|opening)\s*(hour|time)/.test(t)) {
    return `Branch hours: Sun–Thu, 8:00–15:00.
Need nearest branch? Send your area name.`;
  }

  if (/(lost|stolen|block).*(card)/.test(t)) {
    return `Card block:
• In-app → Cards → Block
• Or call 04-XXX-XXXX (24/7)
A replacement will be issued after verification.`;
  }

  if (/^(hi|hello|hey)\b/.test(t)) {
    return "Hi! I’m Siva 🤖\nI remember our chat to keep replies relevant. Try “cheque book”, “branch hours”, or ask anything.";
  }

  return null;
}

// =====================
// Siva-style answer: Memory + RAG + GPT
// =====================
async function sivaAnswer(userText, from, ragContext) {
  try {
    if (!OPENAI_API_KEY) return "I can help with banking FAQs. (GPT key not set).";
    const shortHistory = summarizeShortTerm(from);
    const persona = `You are "Siva", a concise WhatsApp assistant. 
Tone: helpful, clear, brief (<= 4 sentences). 
If the user is vague, ask 1 clarifying question. 
Use BANK FACTS if relevant. If facts are missing, say what you need. 
Avoid hallucinating numbers.`;

    const system = `${persona}
---- BANK FACTS (top matches) ----
${ragContext || "(none)"} 
---- RECENT CHAT ----
${shortHistory || "(start of conversation)"} 
---- END CONTEXT ----`;

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
    return (data?.choices?.[0]?.message?.content || "Got it.").trim().slice(0, 900);
  } catch (e) {
    log("sivaAnswer error:", e?.message || e);
    return "Sorry, I ran into an error.";
  }
}

// =====================
// WhatsApp send
// =====================
async function sendWhatsAppText(to, text) {
  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
    const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: String(text || "").slice(0, 4000) } };
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify(payload)
    });
    const body = await r.text();
    if (!r.ok) log("WA send error:", r.status, body); else log("WA send ok:", r.status);
  } catch (e) { log("sendWhatsAppText exception:", e?.message || e); }
}

// =====================
// Optional Supabase REST logging
// =====================
async function logMsg(row) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/messages`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(row)
    });
    if (!r.ok) log("logMsg error:", r.status, await r.text());
  } catch (e) { log("logMsg exception:", e?.message || e); }
}

// =====================
// Admin commands
// =====================
async function handleAdminCommand(text) {
  const t = (text || "").toLowerCase().trim();

  if (t.startsWith("admin:ping")) return "pong ✅";

  if (t.startsWith("admin:reindex")) {
    await loadKnowledge();
    return `Reindexed: ${kb.length} chunks`;
  }

  if (t.startsWith("admin:mem clear")) {
    memoryStore.clear();
    return "Memory cleared for all users.";
  }

  return "Admin cmds: admin:ping | admin:reindex | admin:mem clear";
}

// =====================
// Start
// =====================

console.log("This is the merged version we want");
