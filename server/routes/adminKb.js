import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { normalizeContent, md5Hex } from "../utils/text.js";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[adminKb] missing env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { headers: { "X-Client-Info": "kb-admin/fallback" } }
});

const router = Router();

router.post("/admin/kb", async (req, res) => {
  try {
    const { content, meta = null } = req.body || {};
    if (!content || typeof content !== "string") return res.status(400).json({ error: "content_required" });

    const norm = normalizeContent(content);
    const chash = md5Hex(norm);

    const q1 = await supabase.from("kb_chunks").select("id").eq("content_hash", chash).limit(1).maybeSingle();
    if (q1.data?.id) return res.json({ id: q1.data.id });

    const ins = await supabase.from("kb_chunks").insert([{ content: norm, meta, content_hash: chash }]).select("id");
    if (ins.error) {
      if (ins.error.code === "23505") {
        const q2 = await supabase.from("kb_chunks").select("id").eq("content_hash", chash).limit(1).maybeSingle();
        if (q2.error) return res.status(500).json({ error: "select_failed" });
        if (q2.data?.id) return res.json({ id: q2.data.id });
        return res.status(500).json({ error: "duplicate_but_missing" });
      }
      return res.status(500).json({ error: "insert_failed" });
    }

    const id = Array.isArray(ins.data) && ins.data.length > 0 ? ins.data[0]?.id ?? null : ins.data?.id ?? null;
    if (id) return res.json({ id });

    const q3 = await supabase.from("kb_chunks").select("id").eq("content_hash", chash).limit(1).maybeSingle();
    if (q3.error) return res.status(500).json({ error: "select_failed" });
    if (q3.data?.id) return res.json({ id: q3.data.id });

    return res.status(500).json({ error: "could_not_resolve_id" });
  } catch (e) {
    return res.status(500).json({ error: "internal_error" });
  }
});

router.get("/admin/kb/list", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
  const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);
  const { data, error } = await supabase
    .from("kb_chunks")
    .select("id, updated_at, content_hash, meta")
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return res.status(500).json({ error: "list_failed" });
  res.json({ items: data ?? [], limit, offset });
});

router.get("/admin/kb/count", async (_req, res) => {
  const { count, error } = await supabase.from("kb_chunks").select("*", { count: "exact", head: true });
  if (error) return res.status(500).json({ error: "count_failed" });
  res.json({ count: count ?? 0 });
});

export default router;
