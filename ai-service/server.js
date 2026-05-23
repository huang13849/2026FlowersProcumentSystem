import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import axios from "axios";
import path from "path";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3003;
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || "http://ollama:11434";
const TEXT_MODEL = process.env.AI_MODEL_TEXT || "qwen2.5:7b";
const VISION_MODEL = process.env.AI_MODEL_VISION || "llava:7b";
const AI_PROVIDER = process.env.AI_PROVIDER || "ollama"; // "ollama" | "openai"
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

app.use(cors());
app.get("/", (req, res) => res.redirect("http://100.96.54.109:8088/ai"));
app.use(express.json({ limit: "50mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// --- AI call helpers ---

async function callOllama(model, prompt, imageBase64 = null) {
  const body = {
    model,
    prompt,
    stream: false,
    options: { temperature: 0.3, top_p: 0.9 },
  };
  if (imageBase64) {
    body.images = [imageBase64];
  }
  const res = await axios.post(`${OLLAMA_URL}/api/generate`, body, { timeout: 120000 });
  return res.data.response.trim();
}

async function callOpenAI(systemPrompt, userPrompt, imageBase64 = null) {
  const messages = [{ role: "system", content: systemPrompt }];
  if (imageBase64) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: userPrompt },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
      ],
    });
  } else {
    messages.push({ role: "user", content: userPrompt });
  }
  const res = await axios.post(
    `${OPENAI_BASE}/chat/completions`,
    { model: process.env.OPENAI_MODEL || "gpt-4o", messages, temperature: 0.3, max_tokens: 2048 },
    { headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" }, timeout: 120000 }
  );
  return res.data.choices[0].message.content.trim();
}

async function aiChat(systemPrompt, userPrompt, imageBase64 = null) {
  if (AI_PROVIDER === "openai" && OPENAI_KEY) {
    return callOpenAI(systemPrompt, userPrompt, imageBase64);
  }
  const model = imageBase64 ? VISION_MODEL : TEXT_MODEL;
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
  return callOllama(model, fullPrompt, imageBase64);
}

// --- Endpoints ---

// Health check
app.get("/api/ai/health", (req, res) => {
  res.json({ status: "ok", provider: AI_PROVIDER, textModel: TEXT_MODEL, visionModel: VISION_MODEL });
});

// 1. AI识别植物 - upload image, identify species
app.post("/api/ai/identify-plant", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "请上传植物图片" });
    const base64 = req.file.buffer.toString("base64");
    const prompt = `请识别这张图片中的植物品种，按以下JSON格式回复（不要其他文字）：
{
  "chinese_name": "中文名",
  "scientific_name": "拉丁学名",
  "category": "分类(花卉/绿植/多肉等)",
  "confidence": 0.95,
  "features": ["特征1", "特征2"],
  "care_tips": "简要养护提示"
}`;
    const result = await aiChat("你是一位专业的植物学家，擅长识别各种植物品种。", prompt, base64);
    // Try to parse JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return res.json(JSON.parse(jsonMatch[0]));
    }
    // Fallback: return raw text
    res.json({ raw: result, note: "AI返回格式异常，请重试" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. AI生成SKU - based on product attributes
app.post("/api/ai/generate-sku", async (req, res) => {
  try {
    const { flowerName, category, sellerName, title, supplier_name } = req.body;
    const prompt = `根据以下商品信息生成一个唯一的SKU编码（字母数字组合，8-16位，有意义且易识别），
以及建议的商品编号格式。只返回JSON格式：
{
  "sku": "SKU编码",
  "productCode": "商品编号",
  "barcode": "建议条码(13位数字)",
  "explanation": "编码规则说明"
}

商品信息：
- 花卉名称: ${flowerName || "未填写"}
- 分类: ${category || "未填写"}
- 商家: ${sellerName || supplier_name || "未填写"}
- 标题: ${title || "未填写"}`;
    const result = await aiChat("你是一位供应链管理专家，擅长商品编码和SKU设计。", prompt);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) return res.json(JSON.parse(jsonMatch[0]));
    res.json({ raw: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. AI生成营销文案
app.post("/api/ai/generate-copy", async (req, res) => {
  try {
    const { title, flowerName, category, sellerName, sellPrice, costPrice, origin, weight, description } = req.body;
    const prompt = `根据以下商品信息生成营销文案，要求：
1. 一个吸引人的商品标题（30字以内）
2. 一段商品描述（100-200字），突出卖点
3. 三个简短卖点（每条10字以内）
4. 推荐标签（5个以内）

只返回JSON格式：
{
  "title": "优化标题",
  "description": "商品描述文案",
  "highlights": ["卖点1", "卖点2", "卖点3"],
  "tags": ["标签1", "标签2", "标签3"],
  "seoKeywords": ["关键词1", "关键词2"]
}

商品信息：
${title ? `- 标题: ${title}` : ""}
${flowerName ? `- 花卉名称: ${flowerName}` : ""}
${category ? `- 分类: ${category}` : ""}
${sellerName ? `- 商家: ${sellerName}` : ""}
${sellPrice ? `- 售价: ¥${sellPrice}` : ""}
${costPrice ? `- 成本价: ¥${costPrice}` : ""}
${origin ? `- 产地: ${origin}` : ""}
${weight ? `- 重量: ${weight}` : ""}
${description ? `- 已有描述: ${description}` : ""}`;
    const result = await aiChat("你是一位专业的电商运营和营销文案写手，擅长花卉绿植类目的商品文案创作。", prompt);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) return res.json(JSON.parse(jsonMatch[0]));
    res.json({ raw: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. AI质检与上架建议
app.post("/api/ai/auto-list-review", async (req, res) => {
  try {
    const product = req.body;
    const prompt = `作为供应链质检员，审核以下商品信息是否完整、合规，给出上架建议。
按JSON格式回复：
{
  "passed": true/false,
  "score": 85,
  "issues": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"],
  "autoListEligible": true/false,
  "reason": "审核结论说明"
}

商品信息：${JSON.stringify(product, null, 2)}`;
    const result = await aiChat("你是一位严格的商品质检审核员，检查商品信息的完整性和合规性。", prompt);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) return res.json(JSON.parse(jsonMatch[0]));
    res.json({ raw: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. AI智能补全商品信息
app.post("/api/ai/complete-product", async (req, res) => {
  try {
    const partial = req.body;
    const prompt = `根据已有的商品信息，智能补全缺失的字段。只返回JSON格式：
{
  "flowerName": "推测的花卉名称",
  "category": "推测的分类",
  "origin": "推测的产地",
  "weight": "推测的重量(克)",
  "description": "生成的商品描述",
  "sellPrice": 建议售价,
  "sellerName": "建议商家",
  "confidence": { "flowerName": 0.9, "category": 0.85, ... }
}

已有信息：${JSON.stringify(partial, null, 2)}`;
    const result = await aiChat("你是一位资深的花卉行业专家，擅长根据部分信息推断完整的商品资料。", prompt);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) return res.json(JSON.parse(jsonMatch[0]));
    res.json({ raw: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Start ---
app.listen(PORT, "0.0.0.0", () => {
  console.log(`AI Service running on port ${PORT}`);
  console.log(`  Provider: ${AI_PROVIDER}`);
  console.log(`  Text Model: ${TEXT_MODEL}`);
  console.log(`  Vision Model: ${VISION_MODEL}`);
});
