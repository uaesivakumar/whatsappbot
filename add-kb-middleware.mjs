import fs from "fs";
let s = fs.readFileSync("server.js","utf8");

const already = s.includes('p==="/admin/kb/list"') && s.includes('kb_chunks');
if (already) process.exit(0);

function endOf(re){
  const m = re.exec(s);
  return m ? m.index + m[0].length : -1;
}

let idx = endOf(/app\.use\(\s*express\.json[\s\S]*?\);\s*/);
if (idx < 0) idx = endOf(/const\s+app\s*=\s*express\(\s*\)\s*;\s*/);
if (idx < 0) process.exit(1);

const mw = `
app.use(async (req,res,next)=>{
  try{
    const tok = req.headers["x-admin-secret"];
    const ok = !!process.env.ADMIN_TOKEN && tok === process.env.ADMIN_TOKEN;
    const p = req.path || req.url;
    if(!ok && (p==="/admin/kb"||p==="/admin/kb/count"||p==="/admin/kb/list"||p==="/admin/reindex")) return res.status(401).json({error:"unauthorized"});
    if(req.method==="POST" && p==="/admin/kb"){
      const body = req.body||{};
      const content = String(body.content||"");
      const meta = body.meta||{};
      if(!content) return res.status(400).json({error:"content required"});
      const split=(t)=>{const s=String(t||"").split(/\\n{2,}/).map(x=>x.trim()).filter(Boolean);const out=[];for(const q of s){if(q.length<=800){out.push(q);continue;}for(let i=0;i<q.length;i+=800) out.push(q.slice(i,i+800));}return out.length?out:[String(t||"").slice(0,800)];};
      const db = await sp();
      const now = new Date().toISOString();
      let firstId=null, n=0;
      for(const c of split(content)){
        const { data, error } = await db.from("kb_chunks").insert({ content:c, meta, updated_at:now }).select("id").single();
        if(!error && data){ if(!firstId) firstId = data.id; n++; }
      }
      return res.json({ id:firstId, chunks:n });
    }
    if(req.method==="POST" && p==="/admin/reindex"){
      const db = await sp();
      const { count, error } = await db.from("kb_chunks").select("*",{count:"exact",head:true});
      return res.json({ chunks: error?0:(count||0) });
    }
    if(req.method==="GET" && p==="/admin/kb/count"){
      const db = await sp();
      const { count, error } = await db.from("kb_chunks").select("*",{count:"exact",head:true});
      return res.json({ count: error?0:(count||0) });
    }
    if(req.method==="GET" && p==="/admin/kb/list"){
      const db = await sp();
      const lim = Number(req.query?.limit||20);
      const { data, error } = await db.from("kb_chunks").select("id,meta,updated_at").order("updated_at",{ascending:false}).limit(lim);
      return res.json({ rows: error?[]:(data||[]) });
    }
    return next();
  }catch(e){ return res.status(500).json({error:String(e)}); }
});
`;
const out = s.slice(0, idx) + mw + s.slice(idx);
fs.writeFileSync("server.js", out);
