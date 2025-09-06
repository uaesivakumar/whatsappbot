import fs from "fs";
let s = fs.readFileSync("server.js","utf8");

// /console/token
if (!s.includes('"/console/token"')) {
  s = s.replace(/app\.listen\(/, `app.get("/console/token",(req,res)=>{res.type("html").send(\`<!doctype html><meta charset=utf-8><title>Admin Token</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh}form{display:flex;gap:8px}</style><script>const u=new URL(location.href);const t=u.searchParams.get("t");if(t){localStorage.setItem("admin",t);location.replace("/console/");}else{document.write('<form onsubmit="localStorage.setItem(\\'admin\\',this.t.value);location.href=\\'/console/\\';return false;"><input name=t type=password placeholder=ADMIN_TOKEN autofocus><button>Save</button></form>');}</script>\`)});\n\napp.listen(`);
}

// /admin/waids
if (!s.includes('"/admin/waids"')) {
  s = s.replace(/app\.listen\(/, `app.get("/admin/waids", adminGuard, async (req,res)=>{try{const limit=Number(req.query.limit||50);const db=await sp();const {data,error}=await db.from("messages").select("wa_id,ts").order("ts",{ascending:false}).limit(5000);if(error)return res.status(500).json({error:error.message});const m=new Map();for(const r of (data||[])){const k=r.wa_id;const t=Number(r.ts||0);const v=m.get(k)||{wa_id:k,last_ts:0,count:0};v.count++;if(t>v.last_ts)v.last_ts=t;m.set(k,v);}const rows=Array.from(m.values()).sort((a,b)=>b.last_ts-a.last_ts).slice(0,limit);return res.json({count:rows.length,rows});}catch(e){return res.status(500).json({error:String(e)})}});\n\napp.listen(`);
}

// /admin/rag with k + min_similarity
s = s.replace(/app\.get\(\"\/admin\/rag\"[\s\S]*?\}\);\n/, `app.get("/admin/rag", adminGuard, async (req, res) => {try{const q=String(req.query.q||"");if(!q)return res.json({hits:[],answer:null});const k=Math.max(1,Math.min(50,Number(req.query.k||5)||5));const minSim=req.query.min_similarity!=null?Number(req.query.min_similarity):undefined;if(ragMod?.retrieve&&ragMod?.answer){const opts={k};if(!Number.isNaN(minSim)) opts.minSimilarity=minSim;const hits=(await ragMod.retrieve(q,opts))||[];const answer=await ragMod.answer(q,{});return res.json({hits,answer});}return res.json({hits:[],answer:null});}catch{res.status(500).json({error:"failed"})}});\n`);

// /ops/run-summarizer with CRON_SECRET
if (!s.includes('"/ops/run-summarizer"')) {
  s = s.replace(/app\.listen\(/, `app.post("/ops/run-summarizer", async (req,res)=>{try{const h=req.headers["x-cron-secret"];if(!process.env.CRON_SECRET||h!==process.env.CRON_SECRET)return res.status(401).json({ok:false});OPS_LAST_RUN=Date.now();try{await import("./src/memory/summarizer.js");OPS_LAST_OK=true;return res.json({ok:true,ts:OPS_LAST_RUN});}catch(e){OPS_LAST_OK=false;return res.status(500).json({ok:false,error:String(e)})}}catch(e){return res.status(500).json({ok:false,error:String(e)})}});\n\napp.listen(`);
}

fs.writeFileSync("server.js", s);
