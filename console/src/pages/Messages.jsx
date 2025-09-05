import { useState } from "react";
import { messagesList, messagesExportCsv } from "../api";

export default function Messages() {
  const [waId, setWaId] = useState("");
  const [fromIso, setFromIso] = useState("");
  const [toIso, setToIso] = useState("");
  const [rows, setRows] = useState([]);

  async function load() {
    if (!waId) return;
    const r = await messagesList(waId, fromIso, toIso);
    setRows(r.messages || []);
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-semibold">Messages</h1>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <input className="input col-span-2" placeholder="WhatsApp waId" value={waId} onChange={e=>setWaId(e.target.value)} />
        <input className="input" type="datetime-local" value={fromIso} onChange={e=>setFromIso(e.target.value)} />
        <input className="input" type="datetime-local" value={toIso} onChange={e=>setToIso(e.target.value)} />
        <div className="flex gap-2">
          <button className="btn w-full" onClick={load}>Load</button>
          <button className="btn w-full" onClick={()=> waId && messagesExportCsv(waId, fromIso, toIso)}>Export</button>
        </div>
      </div>
      <div className="card overflow-auto">
        <table className="w-full text-left">
          <thead><tr><th className="p-3">Role</th><th className="p-3">Text</th><th className="p-3">Time</th></tr></thead>
          <tbody>
            {rows.length===0 && <tr><td className="p-3 text-slate-400" colSpan="3">No messages</td></tr>}
            {rows.map((r,i)=>(
              <tr key={i} className="border-t border-slate-800">
                <td className="p-3 capitalize">{r.role}</td>
                <td className="p-3">{r.text}</td>
                <td className="p-3">{new Date(Number(r.ts)).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
