import { sendWhatsAppText } from "../lib/metaSend.js";

export function registerWebhookRoutes({ app, pool, ragQuery, sendStatusAlways200 = true }) {
  // Meta verification
  app.get("/webhooks/whatsapp", (req, res) => {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN || "";
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verifyToken) {
      return res.status(200).send(req.query["hub.challenge"]);
    }
    return res.status(400).send("Bad Request");
  });

  // Inbound -> RAG -> send -> log delivery
  app.post("/webhooks/whatsapp", async (req, res) => {
    try {
      let phone = null;
      let text = null;

      // Twilio form-encoded
      if (req.body && req.body.From && req.body.Body) {
        phone = String(req.body.From).replace(/^whatsapp:/, "").replace(/^\+/, "");
        text = String(req.body.Body || "");
      }

      // Meta JSON
      if (!text && req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
        const msg = req.body.entry[0].changes[0].value.messages[0];
        phone = String(msg.from || "").replace(/^\+/, "");
        text = msg.text?.body || msg.button?.text || msg.interactive?.list_reply?.title || "";
      }

      if (!text || !phone) return res.status(200).json({ ok: true, ignored: true });

      const out = await ragQuery({ text, k: 3, generate: true, customer: { phone } });

      let sendResult;
      try {
        sendResult = await sendWhatsAppText({ to: phone, body: out.answer || "I’m here to help." });
      } catch (e) {
        sendResult = { ok: false, error: { status: null, data: String(e?.message || e) }, attempt: 1 };
      }

      if (out.message_id) {
        if (sendResult.ok) {
          await pool.query(
            `UPDATE public.messages SET delivery_status=$1, delivery_meta=$2 WHERE id=$3`,
            ["sent", sendResult.data, out.message_id]
          );
        } else {
          await pool.query(
            `UPDATE public.messages SET delivery_status=$1, delivery_meta=$2 WHERE id=$3`,
            ["failed", sendResult.error, out.message_id]
          );
        }
      }

      return res.status(200).json({ ok: true, message_id: out.message_id, delivery: sendResult?.ok ? "sent" : "failed" });
    } catch (e) {
      if (sendStatusAlways200) return res.status(200).json({ ok: true, error: String(e) });
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });
}
