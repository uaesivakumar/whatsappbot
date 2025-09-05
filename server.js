import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN; // Prefer long-lived system user token
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID; // e.g. 123456789012345

// Health
app.get("/", (req, res) => res.status(200).send("OK"));

// Verification endpoint
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Webhook receiver
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (message && message.type === "text") {
      const from = message.from; // e.g., "9715xxxxxxxx"
      const text = message.text.body?.trim() || "";

      const reply = await routeAndReply(text);
      await sendWhatsAppText(from, reply);
    }

    // Always return 200 quickly
    res.sendStatus(200);
  } catch (e) {
    console.error("/webhook error", e);
    res.sendStatus(200);
  }
});

async function routeAndReply(text) {
  const lower = text.toLowerCase();

  // Greetings
  if (["hi", "hello", "hey"].some((g) => lower === g || lower.startsWith(g + " "))) {
    return "Hi! I’m Siva\nHow can I help you today?";
  }

  // Guardrails for personal/sensitive requests
  if (/(my rate|interest rate|eligibility|can i get a loan|card approved)/i.test(lower)) {
    return "I’ll check and update you shortly.";
  }

  // Example FAQ
  if (/cheque ?book|check ?book/i.test(lower)) {
    return "Cheque book request: ENBD X app → Services → Cheque Book. I can guide you step by step.";
  }

  // Default: OpenAI
  const ai = await openAIAnswer(text);
  return ai ?? "Got it. Could you tell me a bit more so I can help?";
}

async function openAIAnswer(userText) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are Siva, a friendly banking assistant. Be concise, human, and helpful. Avoid giving personalized bank decisions; say you'll check and update if the request is account-specific.",
          },
          { role: "user", content: userText },
        ],
        temperature: 0.3,
      }),
    });

    const data = await resp.json();
    return data?.choices?.[0]?.message?.content?.slice(0, 900);
  } catch (e) {
    console.error("openAIAnswer error", e);
    return null;
  }
}

async function sendWhatsAppText(to, text) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const err = await r.text();
    console.error("WhatsApp send error:", r.status, err);
  }
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
