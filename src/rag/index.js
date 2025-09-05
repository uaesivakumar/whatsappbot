import fs from "fs";
import path from "path";

let _fetch = globalThis.fetch;
if (typeof _fetch !== "function") {
  const nf = await import("node-fetch");
  _fetch = nf.default;
}

let supabase = null;
async function db() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  const { createClient } = await import("@supabase/supabase-js");
  supabase = createClient(url, key);
  return supabase;
}

function sha(text) {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(text).digest("hex");
}

async function embed(texts) {
  const r = await _fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "embeddings error");
  return j.data.map(d => d.embedding);
}

function chunk(md) {
  const paras = md.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  const out = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length <= 700) cur = cur ? cur + "\n\n" + p : p;
    else { if (cur) out.push(cur); cur = p; }
  }
  if (cur) out.push(cur);
  return out;
}

export async function reindexKnowledge() {
  const file = path.join(process.cwd(), "knowledge", "faq.md");
  const md = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!md) return { chunks: 0 };
  const pieces = chunk(md);
  const ids = await Promise.all(pieces.map(async (p, i) => (await import("crypto")).createHash("sha256").update(p).digest("hex")));
  const embs = await embed(pieces);
  const rows = pieces.map((content, i) => ({
    id: ids[i], content, embedding: embs[i], meta: { src: "faq.md", idx: i }, updated_at: new Date().toISOString()
  }));
  const client = await db();
  for (const r of rows) {
    const { error } = await client.from("kb_chunks").upsert(r, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
  return { chunks: rows.length };
}

async function retrieve(query, k = 5) {
  const [qEmb] = await embed([query]);
  const client = await db();
  const { data, error } = await client.rpc("match_kb", { query_embedding: qEmb, match_count: k });
  if (error) throw new Error(error.message);
  return data || [];
}

async function llm(prompt, messages) {
  const r = await _fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: prompt }, ...messages],
      temperature: 0.2
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "chat error");
  return j.choices?.[0]?.message?.content?.trim() || "";
}

export async function answer(userText, { memory, userId }) {
  try {
    const hits = await retrieve(userText, 5);
    if (!hits.length) return null;
    const context = hits.map((h, i) => `#${i+1}\n${h.content}`).join("\n\n");
    const prompt = "Answer briefly and helpfully using only the provided context. If unsure, say you’re unsure.";
    const msg = [
      { role: "user", content: `Context:\n${context}\n\nQuestion: ${userText}` }
    ];
    const out = await llm(prompt, msg);
    return out || null;
  } catch (e) {
    console.warn("rag answer error:", e?.message);
    return null;
  }
}

export default { reindexKnowledge, answer };
