import { Router } from "express";
import axios from "axios";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Contract from "../models/Contract.js";
import Template from "../models/Template.js";
import { generateContractPdf, getDefaultTemplate } from "../services/pdfGenerator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();
const SUPPLIER_API = process.env.SUPPLIER_API || "http://supplier-service:3002";

// GET /api/contracts - list all contracts
router.get("/", async (req, res) => {
  try {
    const { supplierId, status } = req.query;
    const query = {};
    if (supplierId) query.supplierId = supplierId;
    if (status) query.status = status;
    const contracts = await Contract.find(query).sort("-createdAt");
    res.json({ contracts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contracts/supplier/:supplierId - get contracts by supplier
router.get("/supplier/:supplierId", async (req, res) => {
  try {
    const contracts = await Contract.find({ supplierId: req.params.supplierId }).sort("-createdAt");
    res.json({ contracts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contracts/create - create and generate PDF
router.post("/create", async (req, res) => {
  try {
    const { supplierId, contractType } = req.body;
    if (!supplierId || !contractType) return res.status(400).json({ error: "缺少 supplierId 或 contractType" });

    // Fetch supplier from supplier-service
    const suppResp = await axios.get(`${SUPPLIER_API}/api/suppliers/${supplierId}`).catch(() => null);
    let supplierName = "";
    let supplierTaxId = "";
    if (suppResp && suppResp.data) {
      const s = suppResp.data.supplier || suppResp.data;
      supplierName = s.name || s.supplierName || "";
      supplierTaxId = (s.company_info && s.company_info.tax_id) || "";
    }

    if (!supplierName) return res.status(400).json({ error: "供应商不存在或缺少名称" });

    // Get or create template
    let template = await Template.findOne({ type: contractType });
    let templateText;
    if (template) {
      templateText = template.content;
    } else {
      templateText = getDefaultTemplate(contractType);
      template = await Template.create({ type: contractType, name: contractType === "supply" ? "供应与代发协议" : "批发供给协议", content: templateText });
    }

    // Generate contract number
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const count = await Contract.countDocuments({ contractType });
    const contractNo = `${contractType === "supply" ? "GY" : "PF"}-${dateStr}-${String(count + 1).padStart(4, "0")}`;

    // Create contract record
    const contract = await Contract.create({
      supplierId,
      supplierName,
      supplierTaxId,
      contractType,
      status: "draft",
      templateContent: templateText,
    });

    // Generate PDF
    const today = new Date().toLocaleDateString("zh-CN");
    const pdfFilename = `contract_${contract._id}.pdf`;
    const pdfPath = path.join(__dirname, "../contracts", pdfFilename);

    await generateContractPdf(templateText, {
      supplierName,
      supplierTaxId,
      date: today,
      contractNo,
      title: templateText.split("\n")[0] || "合同",
    }, pdfPath);

    const pdfUrl = `/contracts/${pdfFilename}`;
    contract.pdfUrl = pdfUrl;
    await contract.save();

    res.json({ success: true, contract, pdfUrl });
  } catch (err) {
    console.error("[Contract] create error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contracts/regenerate - regenerate PDF for existing contract
router.post("/regenerate", async (req, res) => {
  try {
    const { contractId, templateOverride } = req.body;
    const contract = await Contract.findById(contractId);
    if (!contract) return res.status(404).json({ error: "合同不存在" });

    const templateText = templateOverride || contract.templateContent;
    const today = new Date().toLocaleDateString("zh-CN");
    const pdfFilename = `contract_${contract._id}.pdf`;
    const pdfPath = path.join(__dirname, "../contracts", pdfFilename);

    await generateContractPdf(templateText, {
      supplierName: contract.supplierName,
      supplierTaxId: contract.supplierTaxId,
      date: today,
      contractNo: contractNoLookup(contract),
      title: templateText.split("\n")[0] || "合同",
    }, pdfPath);

    contract.pdfUrl = `/contracts/${pdfFilename}`;
    await contract.save();

    res.json({ success: true, contract, pdfUrl: contract.pdfUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function contractNoLookup(c) {
  return c.contractType === "supply" ? "GY-XXXXXXXX" : "PF-XXXXXXXX";
}

// DELETE /api/contracts/:id
router.delete("/:id", async (req, res) => {
  try {
    const c = await Contract.findByIdAndDelete(req.params.id);
    if (c && c.pdfUrl) {
      const pdfPath = path.join(__dirname, "..", c.pdfUrl);
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
