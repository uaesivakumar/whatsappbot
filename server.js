import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
try { (await import("dotenv")).default.config(); } catch {}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try { (await import("dotenv")).default.config(); } catch {}
try { (await import("dotenv")).default.config(); } catch {}

import fs from "fs"

let _fetch = globalThis.fetch;
if (typeof _fetch !== "function") {
  const nf = await import("node-fetch");
  _fetch = nf.default;
}

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID;
const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.CRON_SECRET || "";
const ADMIN_USER = process.env.ADMIN_USER || "";
const ADMIN_PASS = process.env.ADMIN_PASS || "";

const intentsPath = path.join(__dirname, "intents.json");
let INTENTS = [];
try {
  if (fs.existsSync(intentsPath)) {
    INTENTS = JSON.parse(fs.readFileSync(intentsPath, "utf8"));
    if (!Array.isArray(INTENTS)) INTENTS = [];
  }
} catch {}

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

async function tryImport(p) {
  try {
    if (!fileExists(p)) return null;
    return await import(p);
  } catch {
    return null;
  }
}

const intentsMod = await tryImport(path.join(__dirname, "src/intents/index.js"));
const ragMod = await tryImport(path.join(__dirname, "src/rag/index.js"));
const storeMod = await tryImport(path.join(__dirname, "src/memory/store.js"));
const summarizerMod = await tryImport(path.join(__dirname, "src/memory/summarizer.js"));
const profilesMod = await tryImport(path.join(__dirname, "src/memory/profiles.js"));

const MEMORY = new Map();

function remember(waId, role, text) {
  const arr = MEMORY.get(waId) || [];
  arr.push({ role, text, ts: Date.now() });
  if (arr.length > 20) arr.splice(0, arr.length - 20);
  MEMORY.set(waId, arr);
}

function recentContext(waId) {
  return MEMORY.get(waId) || [];
}

function naiveDetect(text) {
  const t = (text || "").toLowerCase();
  let best = { name: "unknown", confidence: 0 };
  for (const it of INTENTS) {
    const patterns = it.examples || it.utterances || [];
    for (const p of patterns) {
      if (t.includes(String(p).toLowerCase())) {
        best = { name: it.name || it.intent || "unknown", confidence: 0.7 };
        break;
      }
    }
    if (best.name !== "unknown") break;
  }
  return best;
}

async function sendText(to, text) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const body = { messaging_product: "whatsapp", to, type: "text", text: { body: text } };
  const res = await _fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  try {
    const info = await res.text();
    console.log("[OUT]", to, res.status, info?.slice(0, 200));
  } catch {}
  return res.ok;
}

async function generateReply({ waId, text }) {
  let intentRes;
  try {
    if (intentsMod?.detectIntent) intentRes = await intentsMod.detectIntent(text, INTENTS, { context: recentContext(waId) });
    else intentRes = naiveDetect(text);
  } catch {
    intentRes = { name: "unknown", confidence: 0 };
  }
  if (intentRes && intentRes.name !== "unknown" && (intentRes.confidence ?? 0) >= 0.6) {
    try {
      if (intentsMod?.routeIntent) {
        const reply = await intentsMod.routeIntent(intentRes.name, text, { intents: INTENTS, memory: recentContext(waId), waId });
        if (reply) return reply;
      }
      if (intentsMod?.handleIntent) {
        const reply = await intentsMod.handleIntent(intentRes.name, text, { intents: INTENTS, memory: recentContext(waId), waId });
        if (reply) return reply;
      }
    } catch {}
  }
  if (ragMod?.answer) {
    try {
      const reply = await ragMod.answer(text, { memory: recentContext(waId), userId: waId });
      if (reply) return reply;
    } catch {}
  }
  return "I didn’t fully catch that. Could you share a bit more or phrase it differently?";
}

const app = express();
app.use(express.json({ limit: "2mb" }));

function basicAuth(req, res, next) {
  if (!ADMIN_USER) return next();
  const hdr = req.headers.authorization || "";
  const parts = hdr.split(" ");
  const ok = parts[0] === "Basic" && Buffer.from(parts[1] || "", "base64").toString() === `${ADMIN_USER}:${ADMIN_PASS}`;
  if (ok) return next();
  res.set("WWW-Authenticate", 'Basic realm="console"');
  return res.status(401).end("Auth required");
}

app.use("/console", basicAuth, express.static(path.join(__dirname, "console/dist")));
const serveConsole = (req, res) => res.sendFile(path.join(__dirname, "console/dist/index.html"));
app.get("/console", basicAuth, serveConsole);
app.get("/console/*", basicAuth, serveConsole);

app.get("/", (_, res) => res.send("OK"));

app.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.sendStatus(403);
  } catch {
    return res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  try {
    res.sendStatus(200);
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      const changes = entry?.changes || [];
      for (const change of changes) {
        const messages = change?.value?.messages || [];
        for (const msg of messages) {
          if (msg.type !== "text") continue;
          const waId = msg?.from;
          const text = msg?.text?.body || "";
          console.log("[IN]", waId, text?.slice(0, 180));
          remember(waId, "user", text);
          try {
            if (storeMod?.appendMessage) await storeMod.appendMessage({ wa_id: waId, role: "user", text, ts: Date.now() });
          } catch {}
          const reply = await generateReply({ waId, text });
          await sendText(waId, reply);
          remember(waId, "bot", reply);
          try {
            if (storeMod?.appendMessage) await storeMod.appendMessage({ wa_id: waId, role: "bot", text: reply, ts: Date.now() });
          } catch {}
        }
      }
    }
  } catch (e) {
    console.error("webhook error", e);
  }
});

function adminGuard(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(401).json({ error: "admin token not set" });
  const tok = req.headers["x-admin-secret"];
  if (tok && tok === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: "unauthorized" });
}

app.get("/healthz", async (_, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get("/admin/messages", adminGuard, async (req, res) => {
  try {
    const waId = String(req.query.waId || "");
    let rows = [];
    if (storeMod?.listMessages) rows = await storeMod.listMessages(waId, { limit: 500 });
    else rows = recentContext(waId);
    res.json({ waId, count: rows?.length || 0, messages: rows || [] });
  } catch {
    res.status(500).json({ error: "failed" });
  }
});

app.get("/admin/export.csv", adminGuard, async (req, res) => {
  try {
    const waId = String(req.query.waId || "");
    let rows = [];
    if (storeMod?.listMessages) rows = await storeMod.listMessages(waId, { limit: 5000 });
    else rows = recentContext(waId);
    const out = ["role,text,ts", ...(rows || []).map(r => `"${r.role}","${String(r.text || "").replace(/"/g, '""')}","${r.ts}"`)].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.send(out);
  } catch {
    res.status(500).send("error");
  }
});

app.get("/admin/summary", adminGuard, async (req, res) => {
  try {
    const waId = String(req.query.waId || "");
    let summary = "";
    if (storeMod?.getSummary) summary = await storeMod.getSummary(waId);
    if (!summary && summarizerMod?.buildAndSaveSummary) {
      const ok = await summarizerMod.buildAndSaveSummary(waId);
      if (ok?.summary) summary = ok.summary;
    }
    res.json({ waId, summary: summary || "", updated_at: new Date().toISOString() });
  } catch {
    res.status(500).json({ error: "failed" });
  }
});

app.post("/admin/summary", adminGuard, async (req, res) => {
  try {
    const waId = String(req.body.waId || "");
    if (summarizerMod?.buildAndSaveSummary) {
      await summarizerMod.buildAndSaveSummary(waId);
      return res.json({ waId, summarized: true });
    }
    res.json({ waId, summarized: false });
  } catch {
    res.status(500).json({ error: "failed" });
  }
});

app.get("/admin/profile", adminGuard, async (req, res) => {
  try {
    const waId = String(req.query.waId || "");
    let profile = null;
    if (profilesMod?.getProfile) profile = await profilesMod.getProfile(waId);
    res.json({ waId, profile });
  } catch {
    res.status(500).json({ error: "failed" });
  }
});

app.post("/admin/profile", adminGuard, async (req, res) => {
  try {
    const waId = String(req.body.waId || "");
    const data = req.body || {};
    if (profilesMod?.upsertProfile) {
      const profile = await profilesMod.upsertProfile(waId, data);
      return res.json({ waId, profile, saved: true });
    }
    res.json({ waId, saved: false });
  } catch {
    res.status(500).json({ error: "failed" });
  }
});

app.get("/admin/search", adminGuard, async (req, res) => {
  try {
    const q = { company: req.query.company || "", prefers: req.query.prefers || "", min_salary: req.query.min_salary || req.query.minSalary || "" };
    let rows = [];
    if (profilesMod?.searchProfiles) rows = await profilesMod.searchProfiles(q);
    res.json({ count: rows?.length || 0, rows: rows || [] });
  } catch {
    res.status(500).json({ error: "failed" });
  }
});

app.get("/admin/search.csv", adminGuard, async (req, res) => {
  try {
    const q = { company: req.query.company || "", prefers: req.query.prefers || "", min_salary: req.query.min_salary || req.query.minSalary || "" };
    let rows = [];
    if (profilesMod?.searchProfiles) rows = await profilesMod.searchProfiles(q);
    const header = "wa_id,company,salary_aed,prefers,liabilities_aed,notes,updated_at";
    const out = [header, ...(rows || []).map(r => `"${r.wa_id}","${r.company || ""}","${r.salary_aed ?? ""}","${r.prefers || ""}","${r.liabilities_aed ?? ""}","${(r.notes || "").replace(/"/g, '""')}","${r.updated_at || ""}"`)].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.send(out);
  } catch {
    res.status(500).send("error");
  }
});

app.get("/admin/kb/count", adminGuard, async (_, res) => {
  try {
    if (ragMod?.count) {
      const c = await ragMod.count();
      return res.json({ count: c || 0 });
    }
    res.json({ count: 0 });
  } catch {
    res.status(500).json({ error: "failed" });
  }
});

app.get("/admin/kb/list", adminGuard, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    if (ragMod?.list) {
      const rows = await ragMod.list({ limit });
      return res.json({ rows: rows || [] });
    }
    res.json({ rows: [] });
  } catch {
    res.status(500).json({ error: "failed" });
  }
});

app.post("/admin/kb", adminGuard, async (req, res) => {
  try {
    const content = String(req.body?.content || "");
    const meta = req.body?.meta || {};
    if (!content) return res.status(400).json({ error: "content required" });
    if (ragMod?.upsertOne) {
      const r = await ragMod.upsertOne(content, meta);
      return res.json({ id: r?.id });
    }
    res.json({ id: null });
  } catch {
    res.status(500).json({ error: "failed" });
  }
});

app.post("/admin/reindex", adminGuard, async (_, res) => {
  try {
    if (ragMod?.reindex) {
      const r = await ragMod.reindex();
      return res.json({ chunks: r?.chunks || 0 });
    }
    res.json({ chunks: 0 });
  } catch {
    res.status(500).json({ error: "failed" });
  }
});

app.get("/admin/rag", adminGuard, async (req, res) => {
  try {
    const q = String(req.query.q || "");
    if (!q) return res.json({ hits: [], answer: null });
    if (ragMod?.retrieve && ragMod?.answer) {
      const hits = (await ragMod.retrieve(q, { k: 5 })) || [];
      const answer = await ragMod.answer(q, {});
      return res.json({ hits, answer });
    }
    res.json({ hits: [], answer: null });
  } catch {
    res.status(500).json({ error: "failed" });
  }
});

app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});

// admin helpers
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.CRON_SECRET || "";
const okAdmin = (req) => {
  const t = req.headers["x-admin-secret"] || "";
  return ADMIN_TOKEN ? t === ADMIN_TOKEN : true;
};
const bad = (res) => res.status(401).json({ ok: false });

function toISO(x){ if(!x) return null; const d = new Date(x); return isNaN(d) ? null : d.toISOString(); }
function toCSV(rows, headers){
  const esc=(v)=> `"${String(v??"").replace(/"/g,'""')}"`;
  const head = headers.map(esc).join(",");
  const body = rows.map(r => headers.map(h => esc(r[h])).join(",")).join("\n");
  return head + "\n" + body + "\n";
}

// supabase client on demand
let _sp = null;
async function sp(){
  if (_sp) return _sp;
  const { createClient } = await import("@supabase/supabase-js");
  _sp = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
  return _sp;
}

// messages date-range + csv
app.get("/admin/messages", async (req,res)=>{
  if(!okAdmin(req)) return bad(res);
  try{
    const waId = req.query.waId || req.query.waid || "";
    const from = toISO(req.query.from || req.query.from_iso);
    const to = toISO(req.query.to || req.query.to_iso);
    const db = await sp();
    let q = db.from("messages").select("role,text,ts,wa_id").eq("wa_id", waId).order("ts",{ascending:true});
    if(from) q = q.gte("ts", Math.floor(new Date(from).getTime()));
    if(to) q = q.lte("ts", Math.floor(new Date(to).getTime()));
    const { data, error } = await q.limit(2000);
    if(error) return res.status(500).json({error:error.message});
    return res.json({ waId, count: data?.length||0, messages: data||[] });
  }catch(e){ return res.status(500).json({error:String(e)}); }
});

app.get("/admin/messages.csv", async (req,res)=>{
  if(!okAdmin(req)) return bad(res);
  try{
    const waId = req.query.waId || req.query.waid || "";
    const from = toISO(req.query.from || req.query.from_iso);
    const to = toISO(req.query.to || req.query.to_iso);
    const db = await sp();
    let q = db.from("messages").select("role,text,ts,wa_id").eq("wa_id", waId).order("ts",{ascending:true});
    if(from) q = q.gte("ts", Math.floor(new Date(from).getTime()));
    if(to) q = q.lte("ts", Math.floor(new Date(to).getTime()));
    const { data, error } = await q.limit(5000);
    if(error) return res.status(500).send(error.message);
    const rows = (data||[]).map(r=>({role:r.role,text:r.text,ts:r.ts}));
    const csv = toCSV(rows,["role","text","ts"]);
    res.setHeader("Content-Type","text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="messages_${waId}.csv"`);
    return res.send(csv);
  }catch(e){ return res.status(500).send(String(e)); }
});

// profiles inline upsert, csv import/export
app.post("/admin/profiles/import", express.text({type:"*/*"}), async (req,res)=>{
  if(!okAdmin(req)) return bad(res);
  try{
    const text = req.body || "";
    const lines = text.split(/\r?\n/).filter(Boolean);
    if(lines.length===0) return res.json({imported:0});
    const headers = lines[0].split(",").map(s=>s.trim());
    const idx = (x)=> headers.findIndex(h=>h.toLowerCase()===x);
    const i_wa = idx("wa_id"), i_company=idx("company"), i_salary=idx("salary_aed"), i_pref=idx("prefers"), i_liab=idx("liabilities_aed"), i_notes=idx("notes");
    const db = await sp();
    let n=0;
    for(let i=1;i<lines.length;i++){
      const cols = lines[i].split(",");
      const wa = (cols[i_wa]||"").replace(/"/g,"").trim();
      if(!wa) continue;
      const row = {
        wa_id: wa,
        company: (cols[i_company]||"").replace(/"/g,"").trim()||null,
        salary_aed: cols[i_salary]? Number(String(cols[i_salary]).replace(/"/g,"")): null,
        prefers: (cols[i_pref]||"").replace(/"/g,"").trim()||null,
        liabilities_aed: cols[i_liab]? Number(String(cols[i_liab]).replace(/"/g,"")): null,
        notes: (cols[i_notes]||"").replace(/"/g,"").trim()||null,
        updated_at: new Date().toISOString()
      };
      const { error } = await db.from("profiles").upsert(row,{ onConflict:"wa_id" });
      if(!error) n++;
    }
    return res.json({imported:n});
  }catch(e){ return res.status(500).json({error:String(e)}); }
});

app.get("/admin/profiles/export.csv", async (req,res)=>{
  if(!okAdmin(req)) return bad(res);
  try{
    const company = req.query.company || "";
    const prefers = req.query.prefers || "";
    const min_salary = Number(req.query.min_salary||0);
    const db = await sp();
    let q = db.from("profiles").select("*").order("updated_at",{ascending:false}).limit(5000);
    if(company) q = q.eq("company", company);
    if(prefers) q = q.eq("prefers", prefers);
    if(min_salary) q = q.gte("salary_aed", min_salary);
    const { data, error } = await q;
    if(error) return res.status(500).send(error.message);
    const rows = (data||[]).map(r=>({
      wa_id:r.wa_id,
      company:r.company,
      salary_aed:r.salary_aed,
      prefers:r.prefers,
      liabilities_aed:r.liabilities_aed,
      notes:r.notes,
      updated_at:r.updated_at
    }));
    const csv = toCSV(rows,["wa_id","company","salary_aed","prefers","liabilities_aed","notes","updated_at"]);
    res.setHeader("Content-Type","text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="profiles_export.csv"`);
    return res.send(csv);
  }catch(e){ return res.status(500).send(String(e)); }
});

// kb upload and bulk
app.post("/admin/kb/upload", async (req,res)=>{
  if(!okAdmin(req)) return bad(res);
  try{
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [{ content: body.content, meta: { src: body.filename || "upload" } }];
    const rag = await import("./src/rag/index.js");
    let n=0;
    for(const it of items){
      if(!it?.content) continue;
      await rag.upsertOne(it.content, it.meta||{});
      n++;
    }
    return res.json({uploaded:n});
  }catch(e){ return res.status(500).json({error:String(e)}); }
});

// ops status + trigger
let OPS_LAST_RUN = 0;
let OPS_LAST_OK = null;

app.get("/admin/ops/status", (_req,res)=>{
  const enabled = !!process.env.CRON_INTERVAL_MS;
  return res.json({ enabled, interval_ms: Number(process.env.CRON_INTERVAL_MS||0), last_run_ts: OPS_LAST_RUN, last_result: OPS_LAST_OK });
});

app.post("/admin/ops/run", async (req,res)=>{
  if(!okAdmin(req)) return bad(res);
  try{
    const sum = await import("./src/memory/summarizer.js");
    OPS_LAST_RUN = Date.now();
    OPS_LAST_OK = true;
    return res.json({ ok:true, ts: OPS_LAST_RUN });
  }catch(e){
    OPS_LAST_RUN = Date.now();
    OPS_LAST_OK = false;
    return res.status(500).json({ ok:false, error:String(e) });
  }
});

// console static stays protected by basic auth from earlier

// admin helpers
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.CRON_SECRET || "";
const okAdmin = (req) => {
  const t = req.headers["x-admin-secret"] || "";
  return ADMIN_TOKEN ? t === ADMIN_TOKEN : true;
};
const bad = (res) => res.status(401).json({ ok: false });

function toISO(x){ if(!x) return null; const d = new Date(x); return isNaN(d) ? null : d.toISOString(); }
function toCSV(rows, headers){
  const esc=(v)=> `"${String(v??"").replace(/"/g,'""')}"`;
  const head = headers.map(esc).join(",");
  const body = rows.map(r => headers.map(h => esc(r[h])).join(",")).join("\n");
  return head + "\n" + body + "\n";
}

// supabase client on demand
let _sp = null;
async function sp(){
  if (_sp) return _sp;
  const { createClient } = await import("@supabase/supabase-js");
  _sp = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
  return _sp;
}

// messages date-range + csv
app.get("/admin/messages", async (req,res)=>{
  if(!okAdmin(req)) return bad(res);
  try{
    const waId = req.query.waId || req.query.waid || "";
    const from = toISO(req.query.from || req.query.from_iso);
    const to = toISO(req.query.to || req.query.to_iso);
    const db = await sp();
    let q = db.from("messages").select("role,text,ts,wa_id").eq("wa_id", waId).order("ts",{ascending:true});
    if(from) q = q.gte("ts", Math.floor(new Date(from).getTime()));
    if(to) q = q.lte("ts", Math.floor(new Date(to).getTime()));
    const { data, error } = await q.limit(2000);
    if(error) return res.status(500).json({error:error.message});
    return res.json({ waId, count: data?.length||0, messages: data||[] });
  }catch(e){ return res.status(500).json({error:String(e)}); }
});

app.get("/admin/messages.csv", async (req,res)=>{
  if(!okAdmin(req)) return bad(res);
  try{
    const waId = req.query.waId || req.query.waid || "";
    const from = toISO(req.query.from || req.query.from_iso);
    const to = toISO(req.query.to || req.query.to_iso);
    const db = await sp();
    let q = db.from("messages").select("role,text,ts,wa_id").eq("wa_id", waId).order("ts",{ascending:true});
    if(from) q = q.gte("ts", Math.floor(new Date(from).getTime()));
    if(to) q = q.lte("ts", Math.floor(new Date(to).getTime()));
    const { data, error } = await q.limit(5000);
    if(error) return res.status(500).send(error.message);
    const rows = (data||[]).map(r=>({role:r.role,text:r.text,ts:r.ts}));
    const csv = toCSV(rows,["role","text","ts"]);
    res.setHeader("Content-Type","text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="messages_${waId}.csv"`);
    return res.send(csv);
  }catch(e){ return res.status(500).send(String(e)); }
});

// profiles inline upsert, csv import/export
app.post("/admin/profiles/import", express.text({type:"*/*"}), async (req,res)=>{
  if(!okAdmin(req)) return bad(res);
  try{
    const text = req.body || "";
    const lines = text.split(/\r?\n/).filter(Boolean);
    if(lines.length===0) return res.json({imported:0});
    const headers = lines[0].split(",").map(s=>s.trim());
    const idx = (x)=> headers.findIndex(h=>h.toLowerCase()===x);
    const i_wa = idx("wa_id"), i_company=idx("company"), i_salary=idx("salary_aed"), i_pref=idx("prefers"), i_liab=idx("liabilities_aed"), i_notes=idx("notes");
    const db = await sp();
    let n=0;
    for(let i=1;i<lines.length;i++){
      const cols = lines[i].split(",");
      const wa = (cols[i_wa]||"").replace(/"/g,"").trim();
      if(!wa) continue;
      const row = {
        wa_id: wa,
        company: (cols[i_company]||"").replace(/"/g,"").trim()||null,
        salary_aed: cols[i_salary]? Number(String(cols[i_salary]).replace(/"/g,"")): null,
        prefers: (cols[i_pref]||"").replace(/"/g,"").trim()||null,
        liabilities_aed: cols[i_liab]? Number(String(cols[i_liab]).replace(/"/g,"")): null,
        notes: (cols[i_notes]||"").replace(/"/g,"").trim()||null,
        updated_at: new Date().toISOString()
      };
      const { error } = await db.from("profiles").upsert(row,{ onConflict:"wa_id" });
      if(!error) n++;
    }
    return res.json({imported:n});
  }catch(e){ return res.status(500).json({error:String(e)}); }
});

app.get("/admin/profiles/export.csv", async (req,res)=>{
  if(!okAdmin(req)) return bad(res);
  try{
    const company = req.query.company || "";
    const prefers = req.query.prefers || "";
    const min_salary = Number(req.query.min_salary||0);
    const db = await sp();
    let q = db.from("profiles").select("*").order("updated_at",{ascending:false}).limit(5000);
    if(company) q = q.eq("company", company);
    if(prefers) q = q.eq("prefers", prefers);
    if(min_salary) q = q.gte("salary_aed", min_salary);
    const { data, error } = await q;
    if(error) return res.status(500).send(error.message);
    const rows = (data||[]).map(r=>({
      wa_id:r.wa_id,
      company:r.company,
      salary_aed:r.salary_aed,
      prefers:r.prefers,
      liabilities_aed:r.liabilities_aed,
      notes:r.notes,
      updated_at:r.updated_at
    }));
    const csv = toCSV(rows,["wa_id","company","salary_aed","prefers","liabilities_aed","notes","updated_at"]);
    res.setHeader("Content-Type","text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="profiles_export.csv"`);
    return res.send(csv);
  }catch(e){ return res.status(500).send(String(e)); }
});

// kb upload and bulk
app.post("/admin/kb/upload", async (req,res)=>{
  if(!okAdmin(req)) return bad(res);
  try{
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [{ content: body.content, meta: { src: body.filename || "upload" } }];
    const rag = await import("./src/rag/index.js");
    let n=0;
    for(const it of items){
      if(!it?.content) continue;
      await rag.upsertOne(it.content, it.meta||{});
      n++;
    }
    return res.json({uploaded:n});
  }catch(e){ return res.status(500).json({error:String(e)}); }
});

// ops status + trigger
let OPS_LAST_RUN = 0;
let OPS_LAST_OK = null;

app.get("/admin/ops/status", (_req,res)=>{
  const enabled = !!process.env.CRON_INTERVAL_MS;
  return res.json({ enabled, interval_ms: Number(process.env.CRON_INTERVAL_MS||0), last_run_ts: OPS_LAST_RUN, last_result: OPS_LAST_OK });
});

app.post("/admin/ops/run", async (req,res)=>{
  if(!okAdmin(req)) return bad(res);
  try{
    const sum = await import("./src/memory/summarizer.js");
    OPS_LAST_RUN = Date.now();
    OPS_LAST_OK = true;
    return res.json({ ok:true, ts: OPS_LAST_RUN });
  }catch(e){
    OPS_LAST_RUN = Date.now();
    OPS_LAST_OK = false;
    return res.status(500).json({ ok:false, error:String(e) });
  }
});

// console static stays protected by basic auth from earlier

if (process.env.CRON_INTERVAL_MS) {
  const ms = Number(process.env.CRON_INTERVAL_MS);
  setInterval(async () => {
    try {
      OPS_LAST_RUN = Date.now();
      OPS_LAST_OK = true;
    } catch {
      OPS_LAST_OK = false;
    }
  }, isNaN(ms) || ms < 60000 ? 300000 : ms);
}
