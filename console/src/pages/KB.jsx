import { useState, useEffect } from "react";
import { kbList, kbAdd, kbReindex } from "../api";
import Table from "../components/Table";

export default function KB() {
  const [rows, setRows] = useState([]);
  const [snippet, setSnippet] = useState("");

  async function load() {
    const r = await kbList(20);
    setRows(r.rows || []);
  }

  useEffect(()=>{ load(); }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-neutral-800 p-4 bg-neutral-900/60 space-y-3">
        <textarea className="w-full h-28 rounded-xl bg-neutral-800 border border-neutral-700 p-3 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Add KB snippet…" value={snippet} onChange={(e)=>setSnippet(e.target.value)} />
        <div className="flex gap-2 justify-end">
          <button onClick={()=>setSnippet("")} className="rounded-xl border border-neutral-700 px-3 py-2">Clear</button>
          <button onClick={async()=>{ if(!snippet.trim()) return; await kbAdd(snippet.trim(), {src:"console"}); setSnippet(""); load(); }} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3 py-2 font-medium">Add</button>
          <button onClick={async()=>{ await kbReindex(); load(); }} className="rounded-xl border border-indigo-600 text-indigo-300 px-3 py-2">Reindex</button>
        </div>
      </div>
      <Table cols={[{ key: "id", label: "ID", render:(r)=><code className="text-xs">{r.id.slice(0,8)}…</code> }, { key: "meta", label: "Source", render:(r)=>r.meta?.src || "—" }, { key: "updated_at", label: "Updated" }]} rows={rows} />
    </div>
  );
}
