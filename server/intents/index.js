// Lightweight classifier + router that passes profile to handlers

import * as loans from "./loans.js";
import * as cards from "./cards.js";
import * as accounts from "./accounts.js";
import * as general from "./general.js";
import * as home_loan from "./home_loan.js";

let profiles;
try { profiles = await import("../memory/profiles.js"); } catch {}

const map = { loans, cards, accounts, general, home_loan };

export async function detectIntent(text, INTENTS, { context } = {}) {
  const t = (text || "").toLowerCase();
  let best = { name: "general", confidence: 0.5 };
  for (const it of INTENTS || []) {
    const name = it.name || it.intent;
    const pats = it.examples || it.utterances || [];
    if (!name || !pats?.length) continue;
    for (const p of pats) {
      if (t.includes(String(p).toLowerCase())) {
        best = { name, confidence: it.base_confidence ?? 0.8 };
        break;
      }
    }
    if (best.name !== "general" && best.confidence >= 0.7) break;
  }
  return best;
}

export async function routeIntent(name, text, { intents, memory, waId } = {}) {
  const mod = map[name] || map.general;
  let profile = null;
  try {
    profile = profiles?.getProfile ? await profiles.getProfile(waId) : null;
  } catch { /* non-fatal */ }

  if (typeof mod.handle === "function") {
    return await mod.handle(text, { waId, memory, profile });
  }
  return "How can I help you today?";
}

export default { detectIntent, routeIntent };
