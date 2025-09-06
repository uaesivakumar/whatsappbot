import crypto from "crypto";

export function normalizeContent(s = "") {
  return s.replace(/\s+/g, " ").trim();
}

export function md5Hex(s) {
  return crypto.createHash("md5").update(s).digest("hex");
}
