import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import adminKb from "./server/routes/adminKb.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 10000);

app.use(morgan("tiny"));
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

function supabaseRole() {
  try {
    const k = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const mid = (k.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/");
    const json = mid ? JSON.parse(Buffer.from(mid, "base64").toString("utf8")) : {};
    return json.role || "unknown";
  } catch {
    return "unknown";
  }
}

app.get("/__diag", (_req, res) => {
  const stack = [];
  function walk(layer, parent = "") {
    if (layer.route && layer.route.path) {
      stack.push(parent + layer.route.path);
    } else if (layer.name === "router" && layer.handle.stack) {
      layer.handle.stack.forEach((l) => walk(l, parent));
    } else if (layer.regexp && layer.handle?.stack) {
      const m = layer.regexp.toString().match(/^\/*\^\\\/\(\?\:([^^]+?)\\\/\)\?\(\?\=\\\/\|\$\)\/i$/);
      const base = m && m[1] ? `/${m[1]}`.replace(/\\\//g, "/") : "";
      layer.handle.stack.forEach((l) => walk(l, base));
    }
  }
  app._router.stack.forEach((l) => walk(l));
  res.json({
    ok: true,
    node: process.version,
    port: PORT,
    env: {
      SUPABASE_URL_set: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY_len: (process.env.SUPABASE_SERVICE_ROLE_KEY || "").length,
      SUPABASE_KEY_ROLE: supabaseRole(),
      NODE_ENV: process.env.NODE_ENV || "",
    },
    routes: stack.sort(),
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime_s: Math.round(process.uptime()) });
});

app.use("/", adminKb);

app.use((req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.listen(PORT, () => {
  console.log(`[startup] listening on :${PORT}, supabase key role: ${supabaseRole()}`);
});
