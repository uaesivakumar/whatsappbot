const NUM = String.raw`(?:AED\s*)?([0-9]{1,3}(?:[,\s][0-9]{3})+|[0-9]+(?:\.[0-9]+)?)`;
const toNumber = (s) => {
  if (!s) return null;
  const cleaned = s.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  return Number(cleaned);
};

export function extractProfileFields(text) {
  const t = (text || "").toLowerCase();
  const updates = {};

  let m =
    t.match(/\b(salary|income|pay|i make|i earn|monthly salary|monthly pay)[^0-9a-z]*([0-9]{1,3}(?:[,.\s][0-9]{3})+|[0-9]+(?:\.[0-9]+)?)(k)?/i) ||
    t.match(new RegExp(`\\b(salary|income|pay)[^0-9a-z]*${NUM}(k)?`, "i"));
  if (m) {
    let n = toNumber(m[2]);
    if (!n && m[2]) n = toNumber(m[2].replace(/[,\s]/g, ""));
    if (n && m[3]) n = n * 1000;
    if (n) updates.salary_aed = Math.round(n);
  }

  if (/\bcash\s*back\b|\bcashback\b/.test(t)) updates.prefers = "cashback";
  else if (/\btravel\b/.test(t)) updates.prefers = "travel";
  else if (/\bno (annual )?fee\b|\bno[-\s]*fee\b/.test(t)) updates.prefers = "no_fee";

  m =
    t.match(/\b(liabilities?|obligations?|emi|installments?)\b[^0-9a-z]*([0-9]{1,3}(?:[,.\s][0-9]{3})+|[0-9]+(?:\.[0-9]+)?)(k)?/i) ||
    t.match(new RegExp(`\\b(pay|paying|spend|card bills?)\\b[^0-9a-z]*${NUM}(k)?`, "i"));
  if (m) {
    let n = toNumber(m[2]);
    if (!n && m[2]) n = toNumber(m[2].replace(/[,\s]/g, ""));
    if (n && m[3]) n = n * 1000;
    if (n) updates.liabilities_aed = Math.round(n);
  }

  return updates;
}

export async function onUserTextCapture(waId, text, profilesStore) {
  if (!profilesStore?.upsertProfile) return;
  const updates = extractProfileFields(text);
  if (Object.keys(updates).length === 0) return;
  try {
    await profilesStore.upsertProfile(waId, updates);
    return updates;
  } catch (e) {
    console.warn("capture: upsertProfile failed:", e?.message);
  }
}
