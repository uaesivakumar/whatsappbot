import React from "react";
export default function TokenGate({ children }) {
  const [val, setVal] = React.useState(localStorage.getItem("ADMIN_TOKEN") || "");
  const [ok, setOk] = React.useState(!!val);
  function save() {
    localStorage.setItem("ADMIN_TOKEN", val.trim());
    setOk(!!val.trim());
    window.location.reload();
  }
  if (ok) return children;
  return (
    <div className="h-full grid place-items-center p-6">
      <div className="card p-6 w-full max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Enter Admin Token</h1>
        <input value={val} onChange={(e)=>setVal(e.target.value)} placeholder="ADMIN_TOKEN" />
        <button className="btn-primary w-full" onClick={save}>Continue</button>
      </div>
    </div>
  );
}
