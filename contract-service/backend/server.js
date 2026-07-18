// server.js - PG only, MongoDB removed
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import contractRoutes from "./routes/contracts.js";
import templateRoutes from "./routes/templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3006;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve generated PDFs
const contractsDir = path.join(__dirname, "contracts");
if (!fs.existsSync(contractsDir)) fs.mkdirSync(contractsDir, { recursive: true });
app.use("/contracts", express.static(contractsDir));

// API routes
app.use("/api/contracts", contractRoutes);
app.use("/api/templates", templateRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "contract-service", time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Contract Service running on http://0.0.0.0:${PORT}`);
});
