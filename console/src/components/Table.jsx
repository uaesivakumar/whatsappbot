import React from "react";
export default function Table({ columns, rows, empty = "No data" }) {
  return (
    <div className="card overflow-hidden">
      <table className="table">
        <thead>
          <tr>{columns.map(c => <th key={c.key || c.label}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((r,i)=>(
            <tr key={i}>
              {columns.map(c => <td key={c.key || c.label}>{typeof c.render==="function" ? c.render(r) : r[c.key]}</td>)}
            </tr>
          )) : (
            <tr><td className="text-gray-500 p-6" colSpan={columns.length}>{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
