import fs from "fs";
let s = fs.readFileSync("server.js","utf8");
if (!s.includes('"/ops/run-summarizer"')) {
  const route = `
app.post("/ops/run-summarizer", async (req,res) => {
  try {
    if (!CRON_SECRET || req.headers["x-cron-secret"] !== CRON_SECRET) return res.status(401).json({ ok:false });
    OPS_LAST_RUN = Date.now();
    try {
      if (typeof summarizerMod?.buildAndSaveSummary === "function") { OPS_LAST_OK = true; return res.json({ ok:true, ts: OPS_LAST_RUN }); }
      await import("./src/memory/summarizer.js");
      OPS_LAST_OK = true;
      return res.json({ ok:true, ts: OPS_LAST_RUN });
    } catch (e) {
      OPS_LAST_OK = false;
      return res.status(500).json({ ok:false, error: String(e) });
    }
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e) });
  }
});
`;
  s = s.replace(/app\.listen\s*\(/, route + "\napp.listen(");
  fs.writeFileSync("server.js", s);
}
