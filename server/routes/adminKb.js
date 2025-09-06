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
  global: { headers: { "X-Client-Info": "kb-admin/diag-3.0" } },
});

const router = Router();

function slog(tag, payload) {
  try { console.log(`[adminKb] ${tag}:`, JSON.stringify(payload)); }
  catch { console.log(`[adminKb] ${tag}: <unserializable>`); }
}

router.post("/admin/kb", async (req, res) => {
  const debug = { hash: null, rpcReturned: false, rpcError: null, selectError: null, selectRowFound: false };
  try {
    const { content, meta = null } = req.body || {};
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "content (string) is required", debug });
    }

    const norm = normalizeContent(content);
    const chash = md5Hex(norm);
    debug.hash = chash;
    slog("incoming", { content_len: String(content).length, hash: chash });

    let id = null;

    try {
      const { data: rpcId, error: rpcErr } = await supabase.rpc("kb_upsert", {
        p_content: norm,
        p_meta: meta,
      });
      debug.rpcReturned = rpcId !== null && rpcId !== undefined;
      if (rpcErr) debug.rpcError = rpcErr.message || String(rpcErr);
      id = rpcId ?? null;
      slog("rpc", { returned: debug.rpcReturned, rpcError: debug.rpcError });
    } catch (e) {
      debug.rpcError = String(e);
      slog("rpc-exception", { err: debug.rpcError });
    }

    if (!id) {
      try {
        const { data: row, error: selErr } = await supabase
          .from("kb_chunks")
          .select("id")
          .eq("content_hash", chash)
          .limit(1)
          .maybeSingle();
        if (selErr) debug.selectError = selErr.message || String(selErr);
        if (row?.id) { id = row.id; debug.selectRowFound = true; }
        slog("select", { found: debug.selectRowFound, selectError: debug.selectError });
      } catch (e) {
        debug.selectError = String(e);
        slog("select-exception", { err: debug.selectError });
      }
    }

    return res.status(200).json({ id, debug });
  } catch (e) {
    slog("fatal", { err: String(e) });
    return res.status(500).json({ error: "internal_error", message: String(e), debug });
  }
});

router.get("/admin/kb/list", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
    const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);
    const { data, error } = await supabase
      .from("kb_chunks")
      .select("id, updated_at, content_hash, meta")
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) return res.status(500).json({ error: "list_failed", message: error.message || String(error) });
    res.json({ items: data ?? [], limit, offset });
  } catch (e) {
    return res.status(500).json({ error: "list_failed", message: String(e) });
  }
});

router.get("/admin/kb/count", async (_req, res) => {
  try {
    const { count, error } = await supabase.from("kb_chunks").select("*", { count: "exact", head: true });
    if (error) return res.status(500).json({ error: "count_failed", message: error.message || String(error) });
    res.json({ count: count ?? 0 });
  } catch (e) {
    return res.status(500).json({ error: "count_failed", message: String(e) });
  }
});

export default router;
