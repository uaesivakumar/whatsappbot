export function toCsv(rows) {
  const header = ["role","text","ts"];
  const esc = v => {
    if (v == null) return "";
    const s = String(v).replace(/"/g,'""');
    return `"${s}"`;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([esc(r.role), esc(r.text), esc(r.ts)].join(","));
  }
  return lines.join("\n");
}
