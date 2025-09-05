import { useEffect, useState } from "react";

export default function TokenGate({ children }) {
  const [token, setToken] = useState(localStorage.getItem("ADMIN_TOKEN") || "");
  const [value, setValue] = useState(token);
  useEffect(() => { if (token) localStorage.setItem("ADMIN_TOKEN", token); }, [token]);
  if (!token) {
    return (
      <div className="min-h-screen grid place-items-center bg-neutral-950">
        <div className="w-full max-w-md rounded-2xl border border-neutral-800 p-6 bg-neutral-900/60 shadow-xl">
          <h1 className="text-xl font-semibold mb-2">Admin Console</h1>
          <p className="text-sm text-neutral-400 mb-4">Enter admin token.</p>
          <input className="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" type="password" value={value} onChange={(e) => setValue(e.target.value)} />
          <button onClick={() => setToken(value.trim())} className="mt-4 w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-2 font-medium">Continue</button>
        </div>
      </div>
    );
  }
  return children;
}
