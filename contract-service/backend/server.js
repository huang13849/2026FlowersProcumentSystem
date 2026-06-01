import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import contractRoutes from "./routes/contracts.js";
import templateRoutes from "./routes/templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3006;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/contracts";

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

// Serve frontend (simple HTML page)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// Connect to MongoDB and start
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected");
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Contract service running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    // Start anyway for dev
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Contract service running on port ${PORT} (without DB)`);
    });
  });
