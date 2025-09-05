import { useEffect, useState } from "react";
import { health, kbList, opsRun, opsStatus } from "../api";

export default function Dashboard() {
  const [svc, setSvc] = useState({ ok:false, uptime:0 });
  const [kb, setKb] = useState({ rows:[], count:0 });
  const [ops, setOps] = useState({ enabled:false, interval_ms:0, last_run_ts:0, last_result:null });

  async function load() {
    setSvc(await health());
    setKb(await kbList(10));
    setOps(await opsStatus());
  }
  useEffect(()=>{ load(); },[]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-semibold">Overview</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="text-slate-400">Service</div>
          <div className="text-2xl font-semibold">{svc.ok ? "Healthy" : "Down"}</div>
          <div className="text-slate-500 text-sm">uptime {Math.floor(svc.uptime||0)}s</div>
        </div>
        <div className="card p-5">
          <div className="text-slate-400">KB Chunks</div>
          <div className="text-2xl font-semibold">{kb.count || kb.rows?.length || 0}</div>
        </div>
        <div className="card p-5 space-y-2">
          <div className="text-slate-400">Ops</div>
          <div className="text-sm">enabled {String(ops.enabled)} interval {ops.interval_ms||0}ms</div>
          <div className="text-sm">last {ops.last_run_ts? new Date(ops.last_run_ts).toLocaleString() : "-"}</div>
          <div className="text-sm">result {ops.last_result===null? "-" : String(ops.last_result)}</div>
          <button className="btn mt-2" onClick={async()=>{ await opsRun(); setOps(await opsStatus()); }}>Run Now</button>
        </div>
      </div>
      <div className="card overflow-auto">
        <div className="p-3 text-slate-400">Latest KB items</div>
        <table className="w-full text-left">
          <thead><tr><th className="p-3">ID</th><th className="p-3">Source</th><th className="p-3">Updated</th></tr></thead>
          <tbody>
            {(kb.rows||[]).map((r,i)=>(
              <tr key={i} className="border-t border-slate-800">
                <td className="p-3">{String(r.id).slice(0,10)}</td>
                <td className="p-3"><span className="px-2 py-1 bg-slate-800 rounded">{r.meta?.src}</span></td>
                <td className="p-3">{new Date(r.updated_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
