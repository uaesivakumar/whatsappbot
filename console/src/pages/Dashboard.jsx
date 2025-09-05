import React from "react";
import { health, kbCount, kbList, kbAdd, reindex } from "../api";
import StatCard from "../components/StatCard";
import Table from "../components/Table";
import { Server, BookOpen, RefreshCw } from "lucide-react";
export default function Dashboard() {
  const [h,setH]=React.useState(null);
  const [count,setCount]=React.useState(0);
  const [items,setItems]=React.useState([]);
  const [txt,setTxt]=React.useState("");
  const loading = React.useRef(false);
  React.useEffect(()=>{(async()=>{
    setH(await health());
    const c=await kbCount(); setCount(c.count||0);
    const l=await kbList(10); setItems(l.rows||[]);
  })()},[]);
  async function doAdd(){
    if(!txt.trim()) return;
    loading.current=true;
    await kbAdd(txt,{src:"console"});
    setTxt("");
    const c=await kbCount(); setCount(c.count||0);
    const l=await kbList(10); setItems(l.rows||[]);
    loading.current=false;
  }
  async function doReindex(){
    loading.current=true;
    await reindex();
    loading.current=false;
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Overview</h1>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <StatCard title="Service" value={h?.ok ? "Healthy" : "Down"} foot={`uptime ${Math.floor(h?.uptime||0)}s`} icon={<Server size={20}/>}/>
        <StatCard title="KB Chunks" value={count} icon={<BookOpen size={20}/>}/>
        <StatCard title="Actions" value={<span className="badge">Admin</span>} icon={<RefreshCw size={20}/>}/>
      </div>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex gap-2">
            <button onClick={doReindex} className="btn">Reindex KB</button>
            <input className="flex-1" placeholder="Add a KB snippet…" value={txt} onChange={(e)=>setTxt(e.target.value)} />
            <button onClick={doAdd} className="btn-primary">Add Snippet</button>
          </div>
          <Table
            columns={[
              { label:"ID", render:(r)=> <span className="text-xs text-gray-400">{r.id?.slice(0,8)}</span> },
              { label:"Source", render:(r)=> <span className="badge">{r.meta?.src||"—"}</span> },
              { label:"Updated", render:(r)=> new Date(r.updated_at).toLocaleString() },
            ]}
            rows={items}
            empty="No KB items"
          />
        </div>
        <div className="space-y-4">
          <div className="card p-4">
            <div className="text-sm text-gray-400 mb-2">Quick Tips</div>
            <ul className="space-y-2 text-sm text-gray-300">
              <li>Use the Knowledge tab to manage larger content.</li>
              <li>Profiles tab stores user preferences for replies.</li>
              <li>Messages tab lets you audit WhatsApp logs.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
