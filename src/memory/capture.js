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
    t.match(/\b(salary|income|pay|earn|i earn|i make|monthly salary|monthly pay)[^0-9]{0,40}?([0-9]{1,3}(?:[,\s][0-9]{3})+|[0-9]+(?:\.[0-9]+)?)(\s*k)?/i) ||
    t.match(/\baed\s*([0-9]{1,3}(?:[,\s][0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(k)?\b/i);
  if (m) {
    let n = toNumber(m[2] || m[1]);
    if (!n && (m[2] || m[1])) n = toNumber((m[2] || m[1]).replace(/[,\s]/g, ""));
    if (n && (m[3] || "").includes("k")) n = n * 1000;
    if (n) updates.salary_aed = Math.round(n);
  }

  if (/\bcash\s*back\b|\bcashback\b/.test(t)) updates.prefers = "cashback";
  else if (/\btravel\b/.test(t)) updates.prefers = "travel";
  else if (/\bno (annual )?fee\b|\bno[-\s]*fee\b/.test(t)) updates.prefers = "no_fee";

  let ml =
    t.match(/\b(liabilities?|obligations?|emi|installments?|card bills?)\b[^0-9]{0,40}?([0-9]{1,3}(?:[,\s][0-9]{3})+|[0-9]+(?:\.[0-9]+)?)(\s*k)?/i) ||
    t.match(/\bpay(?:ing)?[^0-9]{0,40}?([0-9]{1,3}(?:[,\s][0-9]{3})+|[0-9]+(?:\.[0-9]+)?)(\s*k)?\b/i);
  if (ml) {
    let n = toNumber(ml[2] || ml[1]);
    if (!n && (ml[2] || ml[1])) n = toNumber((ml[2] || ml[1]).replace(/[,\s]/g, ""));
    if (n && (ml[3] || "").includes("k")) n = n * 1000;
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
