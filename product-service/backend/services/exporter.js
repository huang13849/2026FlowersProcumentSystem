import ExcelJS from "exceljs";
import axios from "axios";

const IMAGE_FIELD_KEYS = new Set([
  "images", "panorama_images", "package_images", "detail_images", "root_soil_images", "size_ref_images",
  "scene_images", "selling_point_images", "care_images", "comparison_images", "shipping_images", "after_sale_images",
  "product_videos",
]);

const SIMPLE_EXPORT_COLUMNS = [
  { header: "商品标题", key: "title", width: 36 },
  { header: "分类", key: "category", width: 14 },
  { header: "商家", key: "sellerName", width: 18 },
  { header: "花卉名称", key: "flowerName", width: 14 },
  { header: "花期", key: "floweringMonths", width: 16 },
  { header: "场景标签", key: "sceneTags", width: 22 },
  { header: "零批", key: "tradeType", width: 10 },
  { header: "规格", key: "specSize", width: 16 },
  { header: "发货地", key: "origin", width: 12 },
  { header: "库存", key: "stock", width: 10 },
  { header: "重量", key: "weight", width: 10 },
  { header: "结算价", key: "settlementPrice", width: 12 },
  { header: "运费", key: "shippingFee", width: 10 },
  { header: "运费说明", key: "shipping_description", width: 14 },
  { header: "起订量", key: "minOrder", width: 10 },
  { header: "成本价", key: "costPrice", width: 12 },
  { header: "销售价", key: "sellPrice", width: 12 },
  { header: "平台参考(划线价)", key: "ecommerceReferenceUrl", width: 18 },
  { header: "甲方税率", key: "taxRateA", width: 10 },
  { header: "乙方税率", key: "taxRateB", width: 10 },
  { header: "利润", key: "profit", width: 12 },
  { header: "利润率", key: "profitRate", width: 12 },
  { header: "上架状态", key: "isListed", width: 12 },
  { header: "商品ID", key: "productId", width: 20 },
  { header: "包装说明", key: "potColorNotes", width: 18 },
];

const FULL_EXPORT_COLUMNS = [
  ...SIMPLE_EXPORT_COLUMNS,
  { header: "联系人", key: "contactPerson", width: 14 },
  { header: "配送方式", key: "deliveryMethod", width: 14 },
  { header: "代发成本", key: "dropShippingCost", width: 12 },
  { header: "代发市场价", key: "dropShippingMarketPrice", width: 14 },
  { header: "划线价(参考)", key: "retailMarkupPrice", width: 14 },
  { header: "平台价差", key: "platformPriceDiff", width: 12 },
  { header: "优惠券信息", key: "couponInfo", width: 18 },
  { header: "零售利润", key: "retailProfit", width: 12 },
  { header: "描述", key: "description", width: 36 },
  { header: "批发起订量", key: "batchMinQty", width: 12 },
  { header: "批发运费", key: "batchShipping", width: 12 },
  { header: "批发单价", key: "batchUnitPrice", width: 12 },
  { header: "已上架店铺", key: "listedStore", width: 18 },
  { header: "销量", key: "salesVolume", width: 10 },
  { header: "供应商ID", key: "supplier_id", width: 24 },
  { header: "供应商名称", key: "supplier_name", width: 18 },
  { header: "创建人", key: "createdBy", width: 12 },
  { header: "创建时间", key: "createdAt", width: 20 },
  { header: "更新时间", key: "updatedAt", width: 20 },
  // 全列导出保留图片/视频 URL 文本，但不嵌入图片，导出速度快、文件小。
  { header: "图片URL汇总", key: "images", width: 42 },
  { header: "主图URL", key: "panorama_images", width: 42 },
  { header: "发货包装图URL", key: "package_images", width: 42 },
  { header: "细节特写URL", key: "detail_images", width: 42 },
  { header: "根系盆土URL", key: "root_soil_images", width: 42 },
  { header: "尺寸参考URL", key: "size_ref_images", width: 42 },
  { header: "场景应用URL", key: "scene_images", width: 42 },
  { header: "品种卖点URL", key: "selling_point_images", width: 42 },
  { header: "养护教程URL", key: "care_images", width: 42 },
  { header: "规格对比URL", key: "comparison_images", width: 42 },
  { header: "发货售后URL", key: "shipping_images", width: 42 },
  { header: "售后保障URL", key: "after_sale_images", width: 42 },
  { header: "商品视频URL", key: "product_videos", width: 42 },
  { header: "多平台发布状态", key: "publishStatus", width: 36 },
];

function formatExportValue(p, key) {
  const costP = Number(p.settlementPrice || 0) + Number(p.shippingFee || 0);
  const sellP = Number(p.sellPrice || 0);
  const pft = sellP - costP;
  const pftRate = costP > 0 ? ((pft / costP) * 100) : 0;
  if (key === "costPrice") return costP || "";
  if (key === "profit") return Number.isFinite(pft) ? Number(pft.toFixed(1)) : "";
  if (key === "profitRate") return Number.isFinite(pftRate) ? `${pftRate.toFixed(0)}%` : "";
  if (key === "tradeType") return p.tradeType === "wholesale" ? "批发" : (p.tradeType === "mixed" ? "零批混" : "零售");
  if (key === "isListed") return p.isListed ? "已上架" : "未上架";
  if (key === "floweringMonths") return Array.isArray(p.floweringMonths) ? p.floweringMonths.join("、") : "";
  if (key === "sceneTags") return Array.isArray(p.sceneTags) ? p.sceneTags.join("、") : "";
  if (key === "createdAt" || key === "updatedAt" || key === "listedDate") return p[key] ? new Date(p[key]).toISOString().slice(0, 19).replace("T", " ") : "";
  if (IMAGE_FIELD_KEYS.has(key)) return Array.isArray(p[key]) ? p[key].join("\n") : (p[key] || "");
  if (key === "publishStatus") {
    if (!p.publishStatus) return "";
    try {
      const raw = p.publishStatus instanceof Map ? Object.fromEntries(p.publishStatus) : p.publishStatus;
      return JSON.stringify(raw);
    } catch { return String(p.publishStatus); }
  }
  return p[key] ?? "";
}

async function exportNoImageExcel(products, { mode = "simple" } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(mode === "full" ? "全列全量导出" : "简单导出");
  const columns = mode === "full" ? FULL_EXPORT_COLUMNS : SIMPLE_EXPORT_COLUMNS;
  ws.columns = columns;
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: mode === "full" ? "FF3B3B5C" : "FF1F7A3A" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.height = 24;
  for (const p of products) {
    const row = {};
    for (const col of columns) row[col.key] = formatExportValue(p, col.key);
    ws.addRow(row);
  }
  ws.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.height = 22;
    row.alignment = { vertical: "middle", wrapText: mode === "full" };
  });
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
  ws.autoFilter = { from: "A1", to: ws.getRow(1).getCell(columns.length).address };
  return wb.xlsx.writeBuffer();
}

/**
 * Export products to Excel with embedded images.
 * Downloads each image, adds it to the cell, and sets row height accordingly.
 */
export async function exportToExcel(products, { imageHeight = 80, mode = "withImages" } = {}) {
  if (mode === "simple" || mode === "full") {
    return exportNoImageExcel(products, { mode });
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("商品列表");

  // Column definitions — match frontend ProductList layout
  // 5 main img cols → text/num cols → 6 detail img cols
  const columns = [
    // 5 主图列
    { header: "主图",         key: "panorama_images",   width: 18 },
    { header: "发货包装图",   key: "package_images",    width: 18 },
    { header: "细节特写",     key: "detail_images",     width: 18 },
    { header: "根系盆土",     key: "root_soil_images",  width: 18 },
    { header: "尺寸参考",     key: "size_ref_images",   width: 18 },
    // 文字/数字列
    { header: "商品标题",     key: "title",             width: 36 },
    { header: "分类",         key: "category",          width: 12 },
    { header: "商家",         key: "sellerName",        width: 16 },
    { header: "花卉名称",     key: "flowerName",        width: 14 },
    { header: "零批",         key: "tradeType",         width: 10 },
    { header: "规格",         key: "specSize",          width: 14 },
    { header: "发货地",       key: "origin",            width: 10 },
    { header: "库存",         key: "stock",             width: 8 },
    { header: "重量",         key: "weight",            width: 8 },
    { header: "结算价",       key: "settlementPrice",   width: 10 },
    { header: "运费",         key: "shippingFee",       width: 8 },
    { header: "起订量",       key: "minOrder",          width: 8 },
    { header: "成本价",       key: "costPrice",         width: 10 },
    { header: "销售价",       key: "sellPrice",         width: 10 },
    { header: "平台参考(划线价)", key: "ecommerceReferenceUrl", width: 24 },
    { header: "划线价(参考)", key: "retailMarkupPrice",  width: 10 },
    { header: "甲方税率",     key: "taxRateA",          width: 8 },
    { header: "乙方税率",     key: "taxRateB",          width: 8 },
    { header: "利润",         key: "profit",            width: 10 },
    { header: "利润率",       key: "profitRate",        width: 10 },
    // 6 详情图列
    { header: "场景应用",     key: "scene_images",      width: 18 },
    { header: "品种卖点",     key: "selling_point_images", width: 18 },
    { header: "养护教程",     key: "care_images",       width: 18 },
    { header: "规格对比",     key: "comparison_images", width: 18 },
    { header: "发货售后",     key: "shipping_images",   width: 18 },
    { header: "售后保障",     key: "after_sale_images", width: 18 },
    { header: "上架状态",     key: "isListed",          width: 10 },
    { header: "商品ID",       key: "productId",         width: 18 },
    { header: "包装说明",     key: "potColorNotes",     width: 16 },
  ];

  ws.columns = columns;

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A2E" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.height = 24;

  const imgH = imageHeight;
  const extReg = /\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i;

  // Helper: download image buffer + detect extension
  async function fetchImage(url) {
    if (!url) return null;
    try {
      const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 8000 });
      let ext = "png";
      const m = url.match(extReg);
      if (m) ext = m[1].toLowerCase();
      if (ext === "jpeg") ext = "jpg";
      return { buffer: Buffer.from(resp.data), extension: ext };
    } catch (e) {
      console.warn("Image download failed:", url, e.message);
      return null;
    }
  }

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const rowIdx = i + 2; // Excel row (1 = header)
    const row = ws.getRow(rowIdx);
    row.height = imgH + 4;

    // Calculate derived fields
    const costP = Number(p.settlementPrice || 0) + Number(p.shippingFee || 0);
    const sellP = Number(p.sellPrice || 0);
    const pft = sellP - costP;
    const pftRate = costP > 0 ? ((pft / costP) * 100) : 0;

    // Fill text columns
    row.getCell("title").value = p.title || "";
    row.getCell("category").value = p.category || "";
    row.getCell("sellerName").value = p.sellerName || "";
    row.getCell("flowerName").value = p.flowerName || "";
    row.getCell("specSize").value = p.specSize || "";
    row.getCell("origin").value = p.origin || "";
    row.getCell("stock").value = p.stock || 0;
    row.getCell("weight").value = p.weight ?? "";
    row.getCell("tradeType").value = p.tradeType === 'wholesale' ? '批发' : (p.tradeType === 'mixed' ? '零批混' : '零售');
    row.getCell("settlementPrice").value = Number(p.settlementPrice || 0) || "";
    row.getCell("shippingFee").value = Number(p.shippingFee || 0) || "";
    row.getCell("minOrder").value = p.minOrder ?? 1;
    row.getCell("costPrice").value = costP || "";
    row.getCell("sellPrice").value = sellP || "";
    row.getCell("retailMarkupPrice").value = p.retailMarkupPrice || "";
    row.getCell("profit").value = pft ? pft.toFixed(1) : "";
    row.getCell("profitRate").value = pftRate ? pftRate.toFixed(0) + "%" : "";
    row.getCell("taxRateA").value = p.taxRateA ?? "";
    row.getCell("taxRateB").value = p.taxRateB ?? "";
    row.getCell("isListed").value = p.isListed ? "已上架" : "未上架";
    row.getCell("productId").value = p.productId || "";
    {
      const platformReferenceAmount = Number(p.ecommerceReferenceUrl);
      row.getCell("ecommerceReferenceUrl").value = Number.isFinite(platformReferenceAmount) ? platformReferenceAmount : "";
    }
    row.getCell("potColorNotes").value = p.potColorNotes || "";

    // ── Embed thumbnail from each dedicated column ──
    const allImgCols = [
      { key: "panorama_images",    col: 0,  label: "主图" },
      { key: "package_images",     col: 1,  label: "发货包装" },
      { key: "detail_images",      col: 2,  label: "细节特写" },
      { key: "root_soil_images",   col: 3,  label: "根系盆土" },
      { key: "size_ref_images",    col: 4,  label: "尺寸参考" },
      { key: "scene_images",       col: 25, label: "场景应用" },
      { key: "selling_point_images", col: 26, label: "品种卖点" },
      { key: "care_images",         col: 27, label: "养护教程" },
      { key: "comparison_images",   col: 28, label: "规格对比" },
      { key: "shipping_images",     col: 29, label: "发货售后" },
      { key: "after_sale_images",   col: 30, label: "售后保障" },
    ];
    const fallbacks = p.images || [];
    for (const { key, col } of allImgCols) {
      let firstUrl = (p[key] || [])[0];
      // Fallback: if dedicated field empty, try distributing p.images
      if (!firstUrl && fallbacks.length > 0) {
        const idx = allImgCols.findIndex(c => c.key === key);
        if (idx >= 0 && idx < fallbacks.length) firstUrl = fallbacks[idx];
      }
      if (firstUrl) {
        const imgData = await fetchImage(firstUrl);
        if (imgData) {
          const imageId = wb.addImage({
            buffer: imgData.buffer,
            extension: imgData.extension,
          });
          const sizeW = Math.round(imgH * 0.75);
          ws.addImage(imageId, {
            tl: { col, row: rowIdx - 1 },
            ext: { width: sizeW, height: imgH },
            editAs: "oneCell",
          });
        }
      }
    }
    // Alignment
    row.getCell("stock").alignment = { horizontal: "right" };
    row.getCell("settlementPrice").alignment = { horizontal: "right" };
    row.getCell("shippingFee").alignment = { horizontal: "right" };
    row.getCell("costPrice").alignment = { horizontal: "right" };
    row.getCell("retailMarkupPrice").alignment = { horizontal: "right" };
    row.getCell("sellPrice").alignment = { horizontal: "right" };
    row.getCell("ecommerceReferenceUrl").alignment = { horizontal: "right" };
    row.getCell("profit").alignment = { horizontal: "right" };
    row.getCell("profitRate").alignment = { horizontal: "right" };
    row.getCell("taxRateA").alignment = { horizontal: "right" };
    row.getCell("taxRateB").alignment = { horizontal: "right" };
    row.getCell("weight").alignment = { horizontal: "right" };
    row.getCell("tradeType").alignment = { horizontal: "center" };
  }

  // Freeze header
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

export function exportToCSV(products) {
  const fields = [
    "productId", "title", "category", "sellerName", "flowerName",
    "contactPerson", "specSize", "deliveryMethod", "origin",
    "stock", "weight", "dropShippingCost",
    "dropShippingMarketPrice", "tradeType", "settlementPrice", "shippingFee", "minOrder", "costPrice", "sellPrice",
    "retailMarkupPrice", "profit", "platformPriceDiff",
    "couponInfo", "retailProfit", "description", "batchMinQty",
    "batchShipping", "batchUnitPrice", "listedStore", "salesVolume",
    "images", "isListed", "listedDate", "potColorNotes",
  ];
  // Simple CSV generation (json2csv may not be installed)
  const header = fields.join(",");
  const rows = products.map(p => fields.map(f => {
    let v = p[f] ?? "";
    if (f === "images") v = (p.images || []).join("; ");
    if (f === "isListed") v = p.isListed ? "是" : "否";
    if (f === "listedDate" && v) v = new Date(v).toISOString();
    // Escape CSV
    const s = String(v);
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
      return "\"" + s.replace(/\"/g, "\"\"") + "\"";
    }
    return s;
  }).join(","));
  return header + "\n" + rows.join("\n");
}
