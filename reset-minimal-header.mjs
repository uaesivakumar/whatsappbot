import fs from "fs";

let s = fs.readFileSync("server.js","utf8").replace(/^\uFEFF/,"");
s = s.replace(/import\s+[^\n;]*\sfrom\s*['"](express|cors|path|url|dotenv)['"]\s*;?/g,"");
s = s.replace(/dotenv\.config\(\)\s*;?/g,"");
s = s.replace(/const\s+__filename\s*=\s*fileURLToPath\(import\.meta\.url\)\s*;?/g,"");
s = s.replace(/const\s+__dirname\s*=\s*path\.dirname\(__filename\)\s*;?/g,"");
s = s.replace(/\n{3,}/g,"\n\n").trimStart();

const header =
`import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
try { (await import("dotenv")).default.config(); } catch {}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

`;

fs.writeFileSync("server.js", header + s);
