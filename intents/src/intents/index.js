// Central intent router. Each domain handler returns a reply string.
import { detectIntent } from "./classifier.js";
import * as loans from "./loans.js";
import * as cards from "./cards.js";
import * as accounts from "./accounts.js";
import * as general from "./general.js";
import * as home_loan from "./home_loan.js";

export { detectIntent }; // used by server.js

export async function routeIntent(intentName, text, ctx = {}) {
  const map = {
    loans: loans.handle,
    cards: cards.handle,
    accounts: accounts.handle,
    general: general.handle,
    home_loan: home_loan.handle,
  };

  const fn = map[intentName];
  if (typeof fn === "function") {
    return await fn(text, ctx);
  }
  // default fallback to general if unknown but intent was "confident"
  if (typeof general.handle === "function") {
    return await general.handle(text, ctx);
  }
  return null;
}
export default { detectIntent, routeIntent };
