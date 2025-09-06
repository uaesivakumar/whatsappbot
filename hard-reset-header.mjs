import fs from "fs";

let s = fs.readFileSync("server.js","utf8").replace(/^\uFEFF/,"");

s = s.replace(/import\s+[^\n;]*\sfrom\s*['"](express|cors|path|url|dotenv)['"]\s*;?/g, "");
s = s.replace(/dotenv\.config\(\)\s*;?/g, "");
s = s.replace(/const\s+__filename\s*=\s*fileURLToPath\(import\.meta\.url\)\s*;?/g, "");
s = s.replace(/const\s+__dirname\s*=\s*path\.dirname\(__filename\)\s*;?/g, "");
s = s.replace(/(?:const|let|var)\s+(ADMIN_TOKEN|CRON_SECRET|SUPABASE_URL|SUPABASE_SERVICE_KEY|OPENAI_API_KEY)\b[\s\S]*?;/g, "");
s = s.replace(/(?:const|let|var)\s+bad\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\};?/g, "");
s = s.replace(/function\s+bad\s*\([^)]*\)\s*\{[\s\S]*?\}\s*/g, "");
s = s.replace(/(?:const|let|var)\s+okAdmin\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\};?/g, "");
s = s.replace(/function\s+okAdmin\s*\([^)]*\)\s*\{[\s\S]*?\}\s*/g, "");
s = s.replace(/(?:const|let|var)\s+okCron\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\};?/g, "");
s = s.replace(/function\s+okCron\s*\([^)]*\)\s*\{[\s\S]*?\}\s*/g, "");
s = s.replace(/\n{3,}/g,"\n\n").trimStart();

const header =
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
const okAdmin = (req) => req.headers["x-admin-secret"] === ADMIN_TOKEN;
const okCron  = (req) => req.headers["x-cron-secret"]  === CRON_SECRET;
const bad     = (res) => res.status(401).json({ ok: false });

`;

fs.writeFileSync("server.js", header + s);
