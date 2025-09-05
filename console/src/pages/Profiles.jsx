import { useEffect, useState } from "react";
import { profileGet, profileSave, profileSearch, profilesExportCsv, profilesImportCsv } from "../api";

function Row({ r, onChange }) {
  const [val, setVal] = useState(r);
  useEffect(()=>setVal(r),[r]);
  function upd(k,v){ const n = {...val,[k]:v}; setVal(n); onChange(n); }
  return (
    <tr className="border-t border-slate-800">
      <td className="p-2">{val.wa_id}</td>
      <td className="p-2"><input className="input" value={val.company||""} onChange={e=>upd("company",e.target.value)} /></td>
      <td className="p-2"><input className="input" value={val.salary_aed||""} onChange={e=>upd("salary_aed",e.target.value)} /></td>
      <td className="p-2">
        <select className="input" value={val.prefers||""} onChange={e=>upd("prefers",e.target.value)}>
          <option value=""></option>
          <option value="cashback">cashback</option>
          <option value="travel">travel</option>
          <option value="no_fee">no_fee</option>
        </select>
      </td>
      <td className="p-2"><input className="input" value={val.liabilities_aed||""} onChange={e=>upd("liabilities_aed",e.target.value)} /></td>
      <td className="p-2"><input className="input" value={val.notes||""} onChange={e=>upd("notes",e.target.value)} /></td>
      <td className="p-2 text-slate-400">{val.updated_at? new Date(val.updated_at).toLocaleString(): ""}</td>
    </tr>
  );
}

export default function Profiles() {
  const [waId, setWaId] = useState("");
  const [form, setForm] = useState({ company:"", salary_aed:"", prefers:"", liabilities_aed:"", notes:"" });
  const [list, setList] = useState([]);
  const [q, setQ] = useState({ company:"", prefers:"", min_salary:"" });
  const [imported, setImported] = useState(0);

  async function loadProfile() {
    if(!waId) return;
    const r = await profileGet(waId);
    const p = r.profile || {};
    setForm({
      company: p.company||"",
      salary_aed: p.salary_aed||"",
      prefers: p.prefers||"",
      liabilities_aed: p.liabilities_aed||"",
      notes: p.notes||""
    });
  }

  async function saveProfile() {
    if(!waId) return;
    const payload = { waId, ...form };
    await profileSave(payload);
    await search();
  }

  async function search() {
    const r = await profileSearch(q);
    setList(r.rows||[]);
  }

  async function exportCsv(){
    profilesExportCsv(q);
  }

  async function onImportFile(e){
    const f = e.target.files?.[0];
    if(!f) return;
    const txt = await f.text();
    const r = await profilesImportCsv(txt);
    setImported(r.imported||0);
    await search();
    e.target.value="";
  }

  async function onRowChange(n){
    await profileSave({ waId:n.wa_id, company:n.company, salary_aed:n.salary_aed, prefers:n.prefers, liabilities_aed:n.liabilities_aed, notes:n.notes });
  }

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-3xl font-semibold">Profiles</h1>

      <div className="card grid grid-cols-1 md:grid-cols-6 gap-3">
        <input className="input md:col-span-2" placeholder="waId" value={waId} onChange={e=>setWaId(e.target.value)} />
        <button className="btn" onClick={loadProfile}>Load</button>
        <input className="input" placeholder="Company" value={form.company} onChange={e=>setForm({...form,company:e.target.value})} />
        <input className="input" placeholder="Salary AED" value={form.salary_aed} onChange={e=>setForm({...form,salary_aed:e.target.value})} />
        <select className="input" value={form.prefers} onChange={e=>setForm({...form,prefers:e.target.value})}>
          <option value="">Preference</option>
          <option value="cashback">cashback</option>
          <option value="travel">travel</option>
          <option value="no_fee">no_fee</option>
        </select>
        <input className="input" placeholder="Liabilities AED" value={form.liabilities_aed} onChange={e=>setForm({...form,liabilities_aed:e.target.value})} />
        <textarea className="input md:col-span-6" placeholder="Notes" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} />
        <button className="btn md:col-span-6" onClick={saveProfile}>Save Profile</button>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <input className="input" placeholder="Company" value={q.company} onChange={e=>setQ({...q,company:e.target.value})} />
          <select className="input" value={q.prefers} onChange={e=>setQ({...q,prefers:e.target.value})}>
            <option value="">Preference</option>
            <option value="cashback">cashback</option>
            <option value="travel">travel</option>
            <option value="no_fee">no_fee</option>
          </select>
          <input className="input" placeholder="Min Salary" value={q.min_salary} onChange={e=>setQ({...q,min_salary:e.target.value})} />
          <button className="btn" onClick={search}>Search</button>
          <button className="btn" onClick={exportCsv}>Export</button>
          <label className="btn cursor-pointer">
            Import CSV
            <input type="file" accept=".csv" className="hidden" onChange={onImportFile}/>
          </label>
        </div>
        {imported>0 && <div className="text-green-400 text-sm">Imported {imported}</div>}
        <div className="overflow-auto">
          <table className="w-full text-left">
            <thead><tr><th className="p-2">waId</th><th className="p-2">Company</th><th className="p-2">Salary</th><th className="p-2">Prefers</th><th className="p-2">Liabilities</th><th className="p-2">Notes</th><th className="p-2">Updated</th></tr></thead>
            <tbody>
              {list.length===0 && <tr><td className="p-3 text-slate-400" colSpan="7">No profiles</td></tr>}
              {list.map((r,i)=> <Row key={i} r={r} onChange={onRowChange} />)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
