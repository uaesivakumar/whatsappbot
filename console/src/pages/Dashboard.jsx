import { useEffect, useState } from "react";
import { health, kbCount, kbList, kbReindex, kbAdd } from "../api";
import StatCard from "../components/StatCard";
import Table from "../components/Table";

export default function Dashboard() {
  const [hz, setHz] = useState(null);
  const [count, setCount] = useState(0);
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);
  const [snippet, setSnippet] = useState("");

  async function refresh() {
    const c = await kbCount();
    setCount(c.count);
    const l = await kbList(5);
    setRows(l.rows || []);
  }

  useEffect(() => {
    health().then(setHz);
    refresh();
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Service" value={hz?.ok ? "Healthy" : "Unknown"} right={<span className="text-xs text-neutral-400">uptime {hz?.uptime?.toFixed?.(0)}s</span>} />
        <StatCard label="KB Chunks" value={count} />
        <div className="flex items-stretch gap-3">
          <button onClick={async () => { await kbReindex(); refresh(); }} className="flex-1 rounded-2xl border border-neutral-800 bg-neutral-900/60 hover:bg-neutral-900 px-4 py-3 font-medium">Reindex KB</button>
          <button onClick={() => setAdding(true)} className="flex-1 rounded-2xl bg-indigo-600 hover:bg-indigo-500 px-4 py-3 font-medium">Add Snippet</button>
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm text-neutral-400">Latest KB items</div>
        <Table cols={[{ key: "id", label: "ID", render: (r) => <code className="text-xs">{r.id.slice(0, 8)}…</code> }, { key: "meta", label: "Source", render: (r) => r.meta?.src || "—" }, { key: "updated_at", label: "Updated" }]} rows={rows} />
      </div>

      {adding && (
        <div className="rounded-2xl border border-neutral-800 p-4 bg-neutral-900/60 space-y-3">
          <textarea value={snippet} onChange={(e)=>setSnippet(e.target.value)} placeholder="Paste Q/A or doc snippet…" className="w-full h-32 rounded-xl bg-neutral-800 border border-neutral-700 p-3 outline-none focus:ring-2 focus:ring-indigo-500" />
          <div className="flex gap-2 justify-end">
            <button onClick={()=>setAdding(false)} className="rounded-xl border border-neutral-700 px-3 py-2">Cancel</button>
            <button onClick={async ()=>{ if(!snippet.trim()) return; await kbAdd(snippet.trim(), {src:"console"}); setSnippet(""); setAdding(false); refresh(); }} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3 py-2 font-medium">Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
