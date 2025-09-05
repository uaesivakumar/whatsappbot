// server.js
// WhatsApp Cloud API MVP — Express webhook + intents + OpenAI fallback
// Logging included. Optional Supabase REST logging (no extra packages).

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

// =====================
// ENV & constants
// =====================
const VERIFY_TOKEN      = process.env.META_VERIFY_TOKEN;       // you choose (e.g., "siva-verify-2025")
const ACCESS_TOKEN      = process.env.META_ACCESS_TOKEN;       // from Meta (use long-lived in prod)
const PHONE_NUMBER_ID   = process.env.META_PHONE_NUMBER_ID;    // numeric ID from Meta
const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;          // your OpenAI key
const API_VERSION       = process.env.GRAPH_API_VERSION || "v20.0";
const PORT              = process.env.PORT || 10000;

// Optional Supabase REST logging (no extra deps)
const SUPABASE_URL      = process.env.SUPABASE_URL;            // e.g., https://xxxx.supabase.co
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_MSISDN      = (process.env.ADMIN_MSISDN || "").replace(/[^\d]/g, ""); // digits only

// =====================
// Tiny logger
// =====================
const log = (...args) => console.log(new Date().toISOString(), ...args);

// =====================
// Health
// =====================
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

// =====================
// Webhook verification (GET)
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
// Webhook receiver (POST)
// =====================
app.post("/webhook", async (req, res) => {
  log("Webhook POST hit");

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // WhatsApp may send different notifications (messages, statuses, etc.)
    const message = value?.messages?.[0];
    const metadata = value?.metadata;
    const toBusinessId = metadata?.phone_number_id;
    const toDisplay = metadata?.display_phone_number;

    if (!message) {
      // Not a user message — ack and exit (delivery status, etc.)
      res.sendStatus(200);
      return;
    }

    const from = String(message.from || ""); // sender's msisdn (digits)
    const msgType = message.type;

    // Extract text gracefully
    let text = "";
    if (msgType === "text") {
      text = (message.text?.body || "").trim();
    } else if (msgType === "interactive") {
      text =
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        "";
    } else {
      text = `[${msgType}]`;
    }

    log(`[IN] from=${from} type=${msgType} text=${JSON.stringify(text)}`);

    // ---- Optional DB log (inbound)
    await logMsg({
      wa_from: from,
      wa_to: toDisplay || toBusinessId || PHONE_NUMBER_ID || null,
      direction: "in",
      body: text,
      intent: null,
      meta: { raw_type: msgType }
    });

    // ---- Admin commands (from your number)
    const fromDigits = from.replace(/[^\d]/g, "");
    if (
      ADMIN_MSISDN &&
      (fromDigits === ADMIN_MSISDN || fromDigits.endsWith(ADMIN_MSISDN)) &&
      /^admin:/i.test(text)
    ) {
      const adminReply = await handleAdminCommand(text);
      await sendWhatsAppText(from, adminReply);
      log(`[OUT] admin -> ${from} len=${adminReply.length}`);
      await logMsg({
        wa_from: toDisplay || toBusinessId,
        wa_to: from,
        direction: "out",
        body: adminReply,
        intent: "admin",
        meta: null
      });
      res.sendStatus(200);
      return;
    }

    // ---- Route: intents first, then GPT fallback
    const ruleReply = intentReply(text);
    const replyText = ruleReply ?? (await openAIAnswer(text)) ?? "Got it.";

    await sendWhatsAppText(from, replyText);
    log(`[OUT] -> ${from} len=${replyText.length}`);

    // ---- Optional DB log (outbound)
    const intentName = ruleReply
      ? (/Cheque book/i.test(ruleReply)
          ? "cheque"
          : /Branch hours/i.test(ruleReply)
          ? "hours"
          : /Card block/i.test(ruleReply)
          ? "card"
          : "rule")
      : "gpt";

    await logMsg({
      wa_from: toDisplay || toBusinessId,
      wa_to: from,
      direction: "out",
      body: replyText,
      intent: intentName,
      meta: null
    });

    // Always ack quickly
    res.sendStatus(200);
  } catch (e) {
    log("Webhook POST error:", e?.message || e);
    res.sendStatus(200); // ack to avoid retries
  }
});

// =====================
// Intents (rule replies)
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
    return "Hi! I’m Siva 🤖\nI can help with banking FAQs (cheque book, branch hours, card block) or general questions.";
  }

  return null; // fall back to GPT
}

// =====================
// OpenAI fallback
// =====================
async function openAIAnswer(userText) {
  try {
    if (!OPENAI_API_KEY) return null;

    const prompt = `You are Siva's WhatsApp assistant for banking-style FAQs.
- Be concise (<= 4 sentences).
- If unsure, ask a brief follow-up.
User: ${userText}`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4
      })
    });

    const data = await r.json();
    return (data?.choices?.[0]?.message?.content || "").trim().slice(0, 900);
  } catch (e) {
    log("openAIAnswer error:", e?.message || e);
    return null;
  }
}

// =====================
// WhatsApp send (text)
// =====================
async function sendWhatsAppText(to, text) {
  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: String(text || "").slice(0, 4000) }
    };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`
      },
      body: JSON.stringify(payload)
    });

    const body = await r.text();
    if (!r.ok) {
      log("WA send error:", r.status, body);
    } else {
      log("WA send ok:", r.status);
    }
  } catch (e) {
    log("sendWhatsAppText exception:", e?.message || e);
  }
}

// =====================
// Optional: Supabase REST logging
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
    if (!r.ok) {
      const t = await r.text();
      log("logMsg error:", r.status, t);
    }
  } catch (e) {
    log("logMsg exception:", e?.message || e);
  }
}

// =====================
// Admin commands
// =====================
async function handleAdminCommand(text) {
  const t = (text || "").toLowerCase();

  if (/^admin:\s*ping/.test(t)) return "pong ✅";

  if (/^admin:\s*stats/.test(t)) {
    const stats = await fetchStats24h();
    return `24h stats:
Total: ${stats.total}
By intent: cheque=${stats.cheque}, hours=${stats.hours}, card=${stats.card}, gpt=${stats.gpt}`;
  }

  return "Admin cmds: admin:ping | admin:stats";
}

async function fetchStats24h() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { total: 0, cheque: 0, hours: 0, card: 0, gpt: 0 };
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const base = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/messages`;
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Prefer: "count=exact"
  };

  async function countFor(qs) {
    const r = await fetch(`${base}?${qs}`, { headers });
    const range = r.headers.get("content-range") || "";
    const m = range.match(/\/(\d+)$/);
    return m ? Number(m[1]) : 0;
    // (Supabase returns count in the Content-Range header)
  }

  const enc = encodeURIComponent;
  const total = await countFor(`ts=gte.${enc(since)}&select=id`);
  const cheque = await countFor(`ts=gte.${enc(since)}&intent=eq.cheque&select=id`);
  const hours  = await countFor(`ts=gte.${enc(since)}&intent=eq.hours&select=id`);
  const card   = await countFor(`ts=gte.${enc(since)}&intent=eq.card&select=id`);
  const gpt    = await countFor(`ts=gte.${enc(since)}&intent=eq.gpt&select=id`);
  return { total, cheque, hours, card, gpt };
}

// =====================
// Start
// =====================
app.listen(PORT, () => log(`Server listening on ${PORT}`));
