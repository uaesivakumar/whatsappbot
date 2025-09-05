import React from "react";
import { messages } from "../api";
import Table from "../components/Table";
export default function MessagesPage(){
  const [waId,setWaId]=React.useState("");
  const [rows,setRows]=React.useState([]);
  async function load(){
    if(!waId.trim()) return;
    const r=await messages(waId.trim(),100);
    const list=(r.messages||[]).map(m=>({role:m.role||m.type,text:m.text||m.body,ts:m.ts}));
    setRows(list.reverse());
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Messages</h1>
      <div className="card p-4 flex gap-2 items-center">
        <input className="flex-1" placeholder="WhatsApp waId e.g. 9715XXXXXXXX" value={waId} onChange={(e)=>setWaId(e.target.value)} />
        <button className="btn-primary" onClick={load}>Load</button>
      </div>
      <Table
        columns={[
          {label:"Role", key:"role"},
          {label:"Text", key:"text"},
          {label:"Time", render:(r)=> new Date(r.ts||0).toLocaleString()}
        ]}
        rows={rows}
        empty="No messages"
      />
    </div>
  );
}
