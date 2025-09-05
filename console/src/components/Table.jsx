export default function Table({ cols, rows }) {
  return (
    <div className="overflow-auto rounded-2xl border border-neutral-800">
      <table className="min-w-full text-sm">
        <thead className="bg-neutral-900/60">
          <tr>
            {cols.map((c) => (
              <th key={c.key} className="text-left px-4 py-2 font-semibold text-neutral-300">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="odd:bg-neutral-950 even:bg-neutral-900/30">
              {cols.map((c) => (
                <td key={c.key} className="px-4 py-2 text-neutral-200">{c.render ? c.render(r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
