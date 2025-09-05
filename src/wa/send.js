export function createSender({ accessToken, phoneNumberId, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl is required");
  const base = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  async function sendText(to, text) {
    const body = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    };
    const res = await fetchImpl(base, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
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

  return { sendText };
}
export default { createSender };
