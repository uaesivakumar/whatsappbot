import React from "react";
import { profileGet, profileUpsert, profilesSearch } from "../api";
import Table from "../components/Table";
export default function Profiles(){
  const [waId,setWaId]=React.useState("");
  const [profile,setProfile]=React.useState(null);
  const [form,setForm]=React.useState({company:"",salary_aed:"",prefers:"",liabilities_aed:"",notes:""});
  const [q,setQ]=React.useState({company:"",prefers:"",min_salary:""});
  const [rows,setRows]=React.useState([]);
  async function load(){
    if(!waId.trim()) return;
    const r=await profileGet(waId.trim());
    setProfile(r.profile||null);
    setForm({
      company:r.profile?.company||"",
      salary_aed:r.profile?.salary_aed||"",
      prefers:r.profile?.prefers||"",
      liabilities_aed:r.profile?.liabilities_aed||"",
      notes:r.profile?.notes||""
    });
  }
  async function save(){
    const data={waId:waId.trim(),...form, salary_aed: Number(form.salary_aed)||null, liabilities_aed: Number(form.liabilities_aed)||null};
    await profileUpsert(data);
    await load();
  }
  async function search(){
    const r=await profilesSearch({company:q.company||undefined,prefers:q.prefers||undefined,min_salary:q.min_salary||undefined});
    setRows(r.rows||[]);
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Profiles</h1>
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="card p-4 space-y-3">
            <div className="flex gap-2">
              <input className="flex-1" placeholder="waId" value={waId} onChange={(e)=>setWaId(e.target.value)} />
              <button className="btn" onClick={load}>Load</button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <input placeholder="Company" value={form.company} onChange={(e)=>setForm({...form,company:e.target.value})}/>
              <input placeholder="Salary AED" value={form.salary_aed} onChange={(e)=>setForm({...form,salary_aed:e.target.value})}/>
              <select value={form.prefers} onChange={(e)=>setForm({...form,prefers:e.target.value})}>
                <option value="">Preference</option>
                <option value="cashback">cashback</option>
                <option value="travel">travel</option>
                <option value="no_fee">no_fee</option>
              </select>
              <input placeholder="Liabilities AED" value={form.liabilities_aed} onChange={(e)=>setForm({...form,liabilities_aed:e.target.value})}/>
              <textarea className="sm:col-span-2" rows={3} placeholder="Notes" value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/>
            </div>
            <button className="btn-primary w-full" onClick={save}>Save Profile</button>
            {profile ? <div className="text-sm text-gray-400">Updated {new Date(profile.updated_at).toLocaleString()}</div> : null}
          </div>
        </div>
        <div className="space-y-3">
          <div className="card p-4 grid sm:grid-cols-4 gap-3">
            <input placeholder="Company" value={q.company} onChange={(e)=>setQ({...q,company:e.target.value})}/>
            <select value={q.prefers} onChange={(e)=>setQ({...q,prefers:e.target.value})}>
              <option value="">Preference</option>
              <option value="cashback">cashback</option>
              <option value="travel">travel</option>
              <option value="no_fee">no_fee</option>
            </select>
            <input placeholder="Min Salary" value={q.min_salary} onChange={(e)=>setQ({...q,min_salary:e.target.value})}/>
            <button className="btn" onClick={search}>Search</button>
          </div>
          <Table
            columns={[
              {label:"waId", key:"wa_id"},
              {label:"Company", key:"company"},
              {label:"Salary", key:"salary_aed"},
              {label:"Prefers", key:"prefers"},
              {label:"Updated", render:(r)=> new Date(r.updated_at).toLocaleString()}
            ]}
            rows={rows}
            empty="No profiles"
          />
        </div>
      </div>
    </div>
  );
}
