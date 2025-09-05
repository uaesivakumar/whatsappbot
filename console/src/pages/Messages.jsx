import { useState } from "react";
import { messages, summary } from "../api";
import Table from "../components/Table";

export default function Messages() {
  const [waId, setWaId] = useState("");
  const [rows, setRows] = useState([]);
  const [sum, setSum] = useState(null);

  async function load() {
    if (!waId.trim()) return;
    const m = await messages(waId.trim(), 100);
    setRows(m.messages || []);
    try { setSum((await summary(waId.trim())) || null); } catch { setSum(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input className="flex-1 rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="WhatsApp waId" value={waId} onChange={(e)=>setWaId(e.target.value)} />
        <button onClick={load} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4">Load</button>
      </div>

      {sum?.summary && (
        <div className="rounded-2xl border border-neutral-800 p-4 bg-neutral-900/60">
          <div className="text-sm text-neutral-400 mb-1">Long-term summary</div>
          <pre className="whitespace-pre-wrap text-neutral-200 text-sm">{sum.summary}</pre>
        </div>
      )}

      <Table cols={[{ key: "ts", label: "Time", render: (r)=> new Date(Number(r.ts)).toLocaleString() }, { key: "role", label: "Role" }, { key: "text", label: "Text" }]} rows={rows} />
    </div>
  );
}
