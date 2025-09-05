import React from "react";
import { kbList, kbAdd, kbCount, reindex } from "../api";
import Table from "../components/Table";
export default function KB(){
  const [items,setItems]=React.useState([]);
  const [count,setCount]=React.useState(0);
  const [txt,setTxt]=React.useState("");
  React.useEffect(()=>{(async()=>{
    const c=await kbCount(); setCount(c.count||0);
    const l=await kbList(50); setItems(l.rows||[]);
  })()},[]);
  async function add(){
    if(!txt.trim()) return;
    await kbAdd(txt,{src:"console"});
    setTxt("");
    const c=await kbCount(); setCount(c.count||0);
    const l=await kbList(50); setItems(l.rows||[]);
  }
  async function reidx(){
    await reindex();
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Knowledge</h1>
      <div className="grid md:grid-cols-3 gap-3">
        <div className="card p-4 md:col-span-2 flex gap-2">
          <input className="flex-1" placeholder="Snippet text" value={txt} onChange={(e)=>setTxt(e.target.value)}/>
          <button className="btn-primary" onClick={add}>Add</button>
        </div>
        <button className="btn card p-4" onClick={reidx}>Reindex</button>
      </div>
      <div className="text-sm text-gray-400">Total {count}</div>
      <Table
        columns={[
          {label:"ID", render:(r)=> <span className="text-xs text-gray-400">{r.id?.slice(0,10)}</span>},
          {label:"Source", render:(r)=> <span className="badge">{r.meta?.src||"—"}</span>},
          {label:"Updated", render:(r)=> new Date(r.updated_at).toLocaleString()}
        ]}
        rows={items}
        empty="No snippets"
      />
    </div>
  );
}
