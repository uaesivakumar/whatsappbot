import { useState } from "react";
import { searchProfiles } from "../api";
import Table from "../components/Table";

export default function Profiles() {
  const [company, setCompany] = useState("");
  const [prefers, setPrefers] = useState("");
  const [minSalary, setMinSalary] = useState("");
  const [rows, setRows] = useState([]);

  async function run() {
    const params = {};
    if (company) params.company = company;
    if (prefers) params.prefers = prefers;
    if (minSalary) params.min_salary = Number(minSalary);
    const r = await searchProfiles(params);
    setRows(r.rows || []);
  }

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-4 gap-2">
        <input className="rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2" placeholder="Company" value={company} onChange={(e)=>setCompany(e.target.value)} />
        <select className="rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2" value={prefers} onChange={(e)=>setPrefers(e.target.value)}>
          <option value="">Preference</option>
          <option value="cashback">cashback</option>
          <option value="travel">travel</option>
          <option value="no_fee">no annual fee</option>
        </select>
        <input className="rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2" placeholder="Min salary" value={minSalary} onChange={(e)=>setMinSalary(e.target.value)} />
        <button onClick={run} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4">Search</button>
      </div>
      <Table cols={[{ key: "wa_id", label: "waId" }, { key: "company", label: "Company" }, { key: "salary_aed", label: "Salary" }, { key: "prefers", label: "Prefers" }, { key: "updated_at", label: "Updated" }]} rows={rows} />
    </div>
  );
}
