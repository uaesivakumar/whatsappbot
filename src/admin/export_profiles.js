export function profilesToCsv(rows) {
  const header = ["wa_id","company","salary_aed","prefers","liabilities_aed","notes","updated_at"];
  const esc = v => {
    if (v == null) return "";
    const s = String(v).replace(/"/g,'""');
    return `"${s}"`;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      esc(r.wa_id),
      esc(r.company),
      esc(r.salary_aed),
      esc(r.prefers),
      esc(r.liabilities_aed),
      esc(r.notes),
      esc(r.updated_at)
    ].join(","));
  }
  return lines.join("\n");
}
