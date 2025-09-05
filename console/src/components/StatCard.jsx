import React from "react";
export default function StatCard({ title, value, foot, icon }) {
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className="p-3 rounded-xl bg-gray-800">{icon}</div>
      <div className="flex-1">
        <div className="text-sm text-gray-400">{title}</div>
        <div className="text-2xl font-semibold">{value}</div>
        {foot ? <div className="text-xs text-gray-500 mt-1">{foot}</div> : null}
      </div>
    </div>
  );
}
