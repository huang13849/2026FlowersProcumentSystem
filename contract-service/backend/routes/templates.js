import { Router } from "express";
import Template from "../models/Template.js";
import { getDefaultTemplate } from "../services/pdfGenerator.js";

const router = Router();

// GET /api/templates - list all
router.get("/", async (req, res) => {
  try {
    const templates = await Template.find().sort("type");
    res.json({ templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/templates/:type - update template
router.put("/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const { content, name } = req.body;
    if (["supply", "wholesale"].indexOf(type) === -1) return res.status(400).json({ error: "无效的合同类型" });

    const update = {};
    if (content !== undefined) update.content = content;
    if (name !== undefined) update.name = name;

    const template = await Template.findOneAndUpdate({ type }, update, { upsert: true, new: true });
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/templates/reset/:type - reset to default
router.post("/reset/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const content = getDefaultTemplate(type);
    const name = type === "supply" ? "供应与代发协议" : "批发供给协议";
    const template = await Template.findOneAndUpdate({ type }, { content, name }, { upsert: true, new: true });
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
