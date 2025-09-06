import { fetchRecentMessages, getLatestSummary, upsertSummary } from "./store.js";

const MSG_INTERVAL = Number(process.env.SUMMARY_EVERY_N || 20);
const TIME_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function shouldSummarize(waId) {
  const latest = await getLatestSummary(waId);
  const now = Date.now();
  const tooOld = !latest || (now - new Date(latest.updated_at).getTime()) > TIME_INTERVAL_MS;
  const recent = await fetchRecentMessages({ waId, limit: MSG_INTERVAL });
  const hitCount = recent.length >= MSG_INTERVAL;
  return tooOld || hitCount;
}

function compact(text, max = 160) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function naiveBullet(msg) {
  const who = msg.role === "bot" ? "Siva" : "User";
  return `• ${who}: ${compact(msg.text, 180)}`;
}

async function buildSummaryFromMessages(messages) {
  const last = messages.slice(-40);
  const bullets = last.map(naiveBullet).join("\n");
  return [
    "Conversation Summary:",
    bullets,
    "",
    "Notes: Auto-rolled summary for fast context."
  ].join("\n");
}

export async function buildAndSaveSummary(waId) {
  const all = await fetchRecentMessages({ waId, limit: 500 });
  const summary = await buildSummaryFromMessages(all);
  await upsertSummary(waId, summary);
  return summary;
}

export default { shouldSummarize, buildAndSaveSummary };
