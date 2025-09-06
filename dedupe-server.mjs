import fs from "fs";

let s = fs.readFileSync("server.js","utf8").replace(/^\uFEFF/,"");
s = s.replace(/import\s+[^\n;]*\sfrom\s*['"](express|cors|path|url|dotenv)['"]\s*;?/g,"");
s = s.replace(/import\s*\{[^}]*\}\s*from\s*['"]url['"]\s*;?/g,"");
s = s.replace(/dotenv\.config\(\)\s*;?/g,"");
s = s.replace(/const\s+__filename\s*=\s*fileURLToPath\(import\.meta\.url\)\s*;?/g,"");
s = s.replace(/const\s+__dirname\s*=\s*path\.dirname\(__filename\)\s*;?/g,"");

const names = ["okAdmin","okCron","bad","_sp","OPS_LAST_RUN","OPS_LAST_OK","ADMIN_TOKEN","CRON_SECRET","SUPABASE_URL","SUPABASE_SERVICE_KEY","OPENAI_API_KEY","__filename","__dirname","PORT"];

for (const name of names) {
  let reLine = new RegExp(`(^|\\n)[\\t ]*(?:const|let|var)\\s+${name}\\b[^;]*;`,"g");
  let first = true;
  s = s.replace(reLine, m => (first ? (first=false, m) : ""));
  let reFunc = new RegExp(`(^|\\n)[\\t ]*function\\s+${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n[\\t ]*\\}`,"g");
  first = true;
  s = s.replace(reFunc, m => (first ? (first=false, m) : ""));
}

s = s.replace(/\n{3,}/g,"\n\n").trimStart();

const header = `import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
try { (await import("dotenv")).default.config(); } catch {}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

`;
fs.writeFileSync("server.js", header + s);
