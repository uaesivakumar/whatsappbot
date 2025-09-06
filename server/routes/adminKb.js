import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { normalizeContent, md5Hex } from "../utils/text.js";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[adminKb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { headers: { "X-Client-Info": "kb-admin/fallback" } },
});

const router = Router();

router.post("/admin/kb", async (req, res) => {
  try {
    const { content, meta = null } = req.body || {};
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "content_required" });
    }

    const norm = normalizeContent(content);
    const chash = md5Hex(norm);

    // 1) try existing by hash
    {
      const { data: row, error } = await supabase
        .from("kb_chunks")
        .select("id")
        .eq("content_hash", chash)
        .limit(1)
        .maybeSingle();
      if (error) console.error("[/admin/kb] select-1 error:", error);
      if (row?.id) return res.json({ id: row.id });
    }

    // 2) insert and ask for id
    const { data: ins, error: insErr } = await supabase
      .from("kb_chunks")
      .insert([{ content: norm, meta, content_hash: chash }])
      .select("id");

    if (insErr) {
      // 23505 = unique_violation (race/duplicate). Fallback select-by-hash.
      if (insErr.code === "23505") {
        const { data: row2, error: sel2 } = await supabase
          .from("kb_chunks")
          .select("id")
          .eq("content_hash", chash)
          .limit(1)
          .maybeSingle();
        if (sel2) {
          console.error("[/admin/kb] select-2 error:", sel2);
          return res.status(500).json({ error: "select_failed" });
        }
        if (row2?.id) return res.json({ id: row2.id });
        return res.status(500).json({ error: "duplicate_but_missing" });
      }
      console.error("[/admin/kb] insert error:", insErr);
      return res.status(500).json({ error: "insert_failed" });
    }

    const id =
      Array.isArray(ins) && ins.length > 0
        ? ins[0]?.id ?? null
        : ins?.id ?? null;

    if (id) return res.json({ id });

    // 3) last-chance select
    const { data: row3, error: sel3 } = await supabase
      .from("kb_chunks")
      .select("id")
      .eq("content_hash", chash)
      .limit(1)
      .maybeSingle();
    if (sel3) {
      console.error("[/admin/kb] select-3 error:", sel3);
      return res.status(500).json({ error: "select_failed" });
    }
    if (row3?.id) return res.json({ id: row3.id });

    return res.status(500).json({ error: "could_not_resolve_id" });
  } catch (e) {
    console.error("[/admin/kb] fatal:", e);
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

  if (error) {
    console.error("[/admin/kb/list] error:", error);
    return res.status(500).json({ error: "list_failed" });
  }
  res.json({ items: data ?? [], limit, offset });
});

router.get("/admin/kb/count", async (_req, res) => {
  const { count, error } = await supabase
    .from("kb_chunks")
    .select("*", { count: "exact", head: true });

  if (error) {
    console.error("[/admin/kb/count] error:", error);
    return res.status(500).json({ error: "count_failed" });
  }
  res.json({ count: count ?? 0 });
});

export default router;
