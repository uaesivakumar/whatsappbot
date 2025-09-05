// Simple classifier: scans intents.json patterns; upgradeable later.
export async function detectIntent(text, intents = [], { context = [] } = {}) {
  const t = (text || "").toLowerCase();
  let best = { name: "unknown", confidence: 0.0, slots: {} };

  for (const it of intents) {
    const name = it.name || it.intent || "unknown";
    const patterns = it.examples || it.utterances || [];
    for (const p of patterns) {
      if (t.includes(String(p).toLowerCase())) {
        const conf = Math.min(0.9, (it.base_confidence ?? 0.7));
        return { name, confidence: conf, slots: {} };
      }
    }
  }
  return best;
}
export default { detectIntent };
