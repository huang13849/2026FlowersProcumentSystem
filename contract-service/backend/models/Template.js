import mongoose from "mongoose";

const templateSchema = new mongoose.Schema({
  type: { type: String, enum: ["supply", "wholesale"], required: true, unique: true },
  name: { type: String, required: true },
  content: { type: String, required: true },
}, { timestamps: true });

export default mongoose.model("Template", templateSchema);
