// server.js
// WhatsApp Cloud API MVP — Express webhook + intents + OpenAI fallback + optional Supabase REST logging

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

// ===== Env =====
const VERIFY_TOKEN       = process.env.META_VERIFY_TOKEN;      // you choose this (e.g., "siva-verify-2025")
const ACCESS_TOKEN       = process.env.META_ACCESS_TOKEN;      // from Meta "Getting Started" (use long-lived later)
const PHONE_NUMBER_ID    = process.env.META_PHONE_NUMBER_ID;   // numeric ID from Meta
const OPENAI_API_KEY     = process.env.OPENAI_API_KEY;         // your OpenAI key
const API_VERSION        = process.env.GRAPH_API_VERSION || "v20.0"; // optional override
const PORT               = process.env.PORT || 10000;

// Optional Supabase REST logging (no extra packages needed)
const SUPABASE_URL       = process.env.SUPABASE_URL;           // e.g., https://xxxx.supabase.co
const SUPABASE_ANON_KEY  = process.env.SUPABASE_ANON_KEY;      // anon/public key
const ADMIN_MSISDN       = (process.env.ADMIN_MSISDN || "").replace(/[^\d]/g, ""); // digits only

// ===== Health =====
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/healthz", (req, res) => res.status(200).json({ ok: true }));

// ===== Webhook verification (GET) =====
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// ===== Webhook receiver (POST) =====
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const metadata = value?.metadata; // contains phone_number_id, display_phone_number
    const toBusinessId = metadata?.phone_number_id; // should match PHONE_NUMBER_ID
    const toDisplay = metadata?.display_phone_number; // e.g., "+1 555 163 5547"

    if (message) {
      const from = String(message.from || ""); // sender msisdn (digits as string)
      const msgType = message.type;
      let text = "";
      if (msgType === "text") text = message.text?.body?.trim() ?? "";
      else if (msgType === "interactive") {
        // handle button/list replies if needed
        text = message?.interactive?.button_reply?.title
            || message?.interactive?.list_reply?.title
            || "";
      }

      // Log inbound
      await logMsg({
        wa_from: from,
        wa_to: toDisplay || toBusinessId || PHONE_NUMBER_ID || null,
        direction: "in",
        body: text || `[${msgType}]`,
        intent: null,
        meta: { raw_type: msgType }
      });

      // Admin commands (from your number)
      const fromDigits = from.replace(/[^\d]/g, "");
      if (ADMIN_MSISDN && (fromDigits.endsWith(ADMIN_MSISDN) || fromDigits === ADMIN_MSISDN) && /^admin:/i.test(text)) {
        const adminReply = await handleAdminCommand(text);
        await sendWhatsAppText(from, adminReply);
        await logMsg({ wa_from: toDisplay || toBusinessId, wa_to: from, direction: "out", body: adminReply, intent: "admin", meta: null });
        res.sendStatus(200);
        return;
      }

      // Route + reply
      const candidate = intentReply(text);
      const replyText = candidate ?? (await openAIAnswer(text)) ?? "Got it.";
      await sendWhatsAppText(from, replyText);

      // Log outbound
      const intentName = candidate
        ? (/Cheque book/i.test(candidate) ? "cheque"
          : /Branch hours/i.test(candidate) ? "hours"
          : /Card block/i.test(candidate) ? "card" : "rule")
        : "gpt";

      await logMsg({
        wa_from: toDisplay || toBusinessId,
        wa_to: from,
        direction: "out",
        body: replyText,
        intent: intentName,
        meta: null
      });
    }

    // Always ack quickly to prevent retries
    res.sendStatus(200);
  } catch (e) {
    console.error("POST /webhook error:", e?.message || e);
    res.sendStatus(200);
  }
});

// ===== Intents =====
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

  // Greeting / small talk
  if (/^(hi|hello|hey)\b/.test(t)) {
    return "Hi! I’m Siva 🤖\nI can help with banking FAQs (cheque book, branch hours, card block) or general queries.";
  }

  return null; // fall through to GPT
}

// ===== OpenAI fallback =====
async function openAIAnswer(userText) {
  try {
    if (!OPENAI_API_KEY) return null;
    const prompt = `You are Siva's WhatsApp assistant for banking-style FAQs.
- Be concise (<= 4 sentences).
- If unsure, ask a brief follow-up.
User: ${userText}`;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4
      })
    });
    const data = await r.json();
    return (data?.choices?.[0]?.message?.content || "").trim().slice(0, 900);
  } catch (e) {
    console.error("openAIAnswer error:", e?.message || e);
    return null;
  }
}

// ===== WhatsApp send =====
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

    if (!r.ok) {
      const err = await r.text();
      console.error("WA send error:", r.status, err);
    }
  } catch (e) {
    console.error("sendWhatsAppText error:", e?.message || e);
  }
}

// ===== Optional: Supabase REST logging =====
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
      console.error("logMsg error:", r.status, t);
    }
  } catch (e) {
    console.error("logMsg exception:", e?.message || e);
  }
}

// ===== Optional: simple admin commands =====
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
  // Uses Supabase REST; returns zeros if SB not configured
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
    // supabase returns count in header: content-range: 0-0/COUNT
    const range = r.headers.get("content-range") || "";
    const match = range.match(/\/(\d+)$/);
    return match ? Number(match[1]) : 0;
  }

  const total = await countFor(`ts=gte.${encodeURIComponent(since)}&select=id`);
  const cheque = await countFor(`ts=gte.${encodeURIComponent(since)}&intent=eq.cheque&select=id`);
  const hours  = await countFor(`ts=gte.${encodeURIComponent(since)}&intent=eq.hours&select=id`);
  const card   = await countFor(`ts=gte.${encodeURIComponent(since)}&intent=eq.card&select=id`);
  const gpt    = await countFor(`ts=gte.${encodeURIComponent(since)}&intent=eq.gpt&select=id`);
  return { total, cheque, hours, card, gpt };
}

// ===== Start =====
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
