import fs from "fs";
let s = fs.readFileSync("server.js","utf8");
if (!/pathToFileURL/.test(s)) {
  s = s.replace(/import\s*\{\s*fileURLToPath\s*\}\s*from\s*["']url["'];/, 'import { fileURLToPath, pathToFileURL } from "url";');
}
s = s.replace(/async function tryImport\([^)]*\)\s*\{[\s\S]*?\}\n/, 'async function tryImport(p){ try{ if(!fileExists(p)) return null; const u = pathToFileURL(p).href; return await import(u); } catch { return null; } }\n');
fs.writeFileSync("server.js", s);
