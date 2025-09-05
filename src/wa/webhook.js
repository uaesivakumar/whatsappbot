export function registerWebhook({ app, verifyToken, onTextMessage }) {
  if (!app) throw new Error("registerWebhook: app is required");

  app.get("/webhook", (req, res) => {
    try {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      if (mode === "subscribe" && token === verifyToken) {
        console.log("✅ Webhook verified");
        return res.status(200).send(challenge);
      }
      return res.sendStatus(403);
    } catch {
      return res.sendStatus(403);
    }
  });

  app.post("/webhook", async (req, res) => {
    try {
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
            try {
              await onTextMessage({ waId, text });
            } catch (e) {
              console.error("onTextMessage error:", e);
            }
          }
        }
      }
    } catch (err) {
      console.error("Webhook POST error:", err);
    }
  });
}
export default { registerWebhook };
