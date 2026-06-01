import mongoose from "mongoose";

const contractSchema = new mongoose.Schema({
  supplierId: { type: String, required: true, index: true },
  supplierName: { type: String, required: true },
  supplierTaxId: { type: String, default: "" },
  contractType: { type: String, enum: ["supply", "wholesale"], default: "supply" },
  status: { type: String, enum: ["draft", "signed", "expired"], default: "draft" },
  templateContent: { type: String, default: "" },
  pdfUrl: { type: String, default: "" },
  signedAt: { type: Date },
}, { timestamps: true });

export default mongoose.model("Contract", contractSchema);
