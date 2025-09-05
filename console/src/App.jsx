import React from "react";
import TokenGate from "./components/TokenGate";
import Dashboard from "./pages/Dashboard";
import Messages from "./pages/Messages";
import Profiles from "./pages/Profiles";
import KB from "./pages/KB";
const tabs = [
  { key:"dashboard", label:"Dashboard", view: Dashboard },
  { key:"messages", label:"Messages", view: Messages },
  { key:"profiles", label:"Profiles", view: Profiles },
  { key:"knowledge", label:"Knowledge", view: KB },
];
function useRoute(){
  const [route,setRoute]=React.useState(window.location.hash.replace("#/","")||"dashboard");
  React.useEffect(()=>{
    const onHash=()=>setRoute(window.location.hash.replace("#/","")||"dashboard");
    window.addEventListener("hashchange",onHash);
    return ()=>window.removeEventListener("hashchange",onHash);
  },[]);
  return [route,(k)=>{window.location.hash=`#/${k}`; setRoute(k);}];
}
export default function App(){
  const [route,nav]=useRoute();
  const Active = (tabs.find(t=>t.key===route)||tabs[0]).view;
  return (
    <TokenGate>
      <div className="min-h-full">
        <header className="sticky top-0 z-10 backdrop-blur bg-black/30 border-b border-gray-800">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="text-lg font-semibold">WhatsApp Bot — Admin Console</div>
            <nav className="flex gap-1">
              {tabs.map(t=>(
                <button key={t.key} onClick={()=>nav(t.key)} className={`px-3 py-2 rounded-xl text-sm ${route===t.key?"bg-white text-black":"bg-gray-800 text-gray-300"}`}>{t.label}</button>
              ))}
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">
          <Active />
        </main>
      </div>
    </TokenGate>
  );
}
