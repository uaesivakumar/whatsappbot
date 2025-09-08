import axios from "axios";

export async function sendWhatsAppText({ to, body }) {
  const PHONE_ID = process.env.META_PHONE_NUMBER_ID;
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  if (!PHONE_ID || !ACCESS_TOKEN) throw new Error("META_PHONE_NUMBER_ID or META_ACCESS_TOKEN is missing");

  const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body } };

  let attempt = 0, maxAttempts = 3;
  while (true) {
    try {
      const res = await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
        timeout: 15000,
      });
      return { ok: true, data: res.data, attempt: attempt + 1 };
    } catch (err) {
      const s = err?.response?.status;
      attempt += 1;
      if ((s === 429 || (s && s >= 500)) && attempt < maxAttempts) {
        const backoff = 500 * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      return { ok: false, error: { status: s, data: err?.response?.data || err?.message || "send error" }, attempt };
    }
  }
}
