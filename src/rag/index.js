import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const db = createClient(url, key);

function splitText(t){
  const s = String(t||"").split(/\n{2,}/).map(x=>x.trim()).filter(Boolean);
  const out=[];
  for(const p of s){ if(p.length<=800){ out.push(p); continue; } for(let i=0;i<p.length;i+=800) out.push(p.slice(i,i+800)); }
  return out.length?out:[String(t||"").slice(0,800)];
}

export async function upsertOne(content, meta={}){
  const now = new Date().toISOString();
  const chunks = splitText(content);
  let firstId=null, n=0;
  for(const c of chunks){
    const { data, error } = await db.from("kb_chunks").insert({ content:c, meta, updated_at:now }).select("id").single();
    if(!error && data){ if(!firstId) firstId=data.id; n++; }
  }
  return { id:firstId, chunks:n };
}

export async function reindex(){
  const { count, error } = await db.from("kb_chunks").select("*", { count:"exact", head:true });
  return { chunks: error ? 0 : (count || 0) };
}

export async function count(){
  const { count, error } = await db.from("kb_chunks").select("*", { count:"exact", head:true });
  return error ? 0 : (count || 0);
}

export async function list({ limit=20 }={}){
  const { data, error } = await db.from("kb_chunks").select("id,meta,updated_at").order("updated_at",{ascending:false}).limit(limit);
  return error ? [] : (data || []);
}

export async function retrieve(q,{k=5}={}){
  const { data, error } = await db.from("kb_chunks").select("content,meta,updated_at").ilike("content", `%${q}%`).order("updated_at",{ascending:false}).limit(k);
  const rows = error ? [] : (data || []);
  return rows.map((r,i)=>({ content:r.content, meta:r.meta||{}, similarity: 1 - i*0.1 }));
}

export async function answer(q){
  return "Ok. Searching for: " + String(q||"");
}
