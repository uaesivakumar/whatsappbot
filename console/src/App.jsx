import { useState } from "react";
import TokenGate from "./components/TokenGate";
import Dashboard from "./pages/Dashboard";
import Messages from "./pages/Messages";
import Profiles from "./pages/Profiles";
import KB from "./pages/KB";

const tabs = [
  { id: "dashboard", label: "Dashboard", el: <Dashboard /> },
  { id: "messages", label: "Messages", el: <Messages /> },
  { id: "profiles", label: "Profiles", el: <Profiles /> },
  { id: "kb", label: "Knowledge", el: <KB /> },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  return (
    <TokenGate>
      <div className="min-h-screen bg-neutral-950 text-neutral-100">
        <header className="border-b border-neutral-900 bg-neutral-950/70 backdrop-blur sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="font-bold">WhatsApp Bot — Admin Console</div>
            <nav className="flex gap-1">
              {tabs.map(t => (
                <button key={t.id} onClick={()=>setTab(t.id)} className={`px-3 py-2 rounded-lg text-sm ${tab===t.id ? "bg-neutral-800" : "hover:bg-neutral-900"}`}>
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">
          {tabs.find(t=>t.id===tab)?.el}
        </main>
      </div>
    </TokenGate>
  );
}
