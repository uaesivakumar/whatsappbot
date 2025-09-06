import fs from "fs";

let s = fs.readFileSync("server.js","utf8").replace(/^\uFEFF/,"");

// drop all import lines for these libs anywhere
s = s.replace(/import\s+[^\n;]*\sfrom\s*['"](express|cors|path|url|dotenv)['"]\s*;?/g, "");

// drop stray dotenv/dirname inits
s = s.replace(/dotenv\.config\(\)\s*;?/g,"");
s = s.replace(/const\s+__filename\s*=\s*fileURLToPath\(import\.meta\.url\)\s*;?/g,"");
s = s.replace(/const\s+__dirname\s*=\s*path\.dirname\(__filename\)\s*;?/g,"");

// dedupe specific consts/functions: keep first, remove later
const names = [
  "ADMIN_TOKEN","CRON_SECRET","SUPABASE_URL","SUPABASE_SERVICE_KEY","OPENAI_API_KEY",
  "okAdmin","okCron","bad","PORT","__filename","__dirname"
];

for (const name of names) {
  // function decl
  let reFun = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\}`, "g");
  let seen = false;
  s = s.replace(reFun, m => (seen ? "" : (seen = true, m)));

  // const arrow block
  seen = false;
  let reArrow = new RegExp(`const\\s+${name}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*\\{[\\s\\S]*?\\};?`, "g");
  s = s.replace(reArrow, m => (seen ? "" : (seen = true, m)));

  // simple const/let/var line
  seen = false;
  let reLine = new RegExp(`(?:const|let|var)\\s+${name}\\b[^;]*;?`, "g");
  s = s.replace(reLine, m => (seen ? "" : (seen = true, m)));
}

// collapse extra blank lines
s = s.replace(/\n{3,}/g,"\n\n").trimStart();

// prepend canonical header only if not already present
if (!/import\s+express\s+from\s+["']express["']/.test(s)) {
  const hdr =
`import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
try { (await import("dotenv")).default.config(); } catch {}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
`;
  s = hdr + "\n" + s;
}

fs.writeFileSync("server.js", s);
