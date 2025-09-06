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

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime_s: Math.round(process.uptime()) });
});

app.use("/", adminKb);

app.use((req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.listen(PORT, () => {
  console.log(`listening on :${PORT}`);
});
