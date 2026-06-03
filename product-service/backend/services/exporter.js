import ExcelJS from "exceljs";
import axios from "axios";

/**
 * Export products to Excel with embedded images.
 * Downloads each image, adds it to the cell, and sets row height accordingly.
 */
export async function exportToExcel(products, { imageHeight = 80 } = {}) {
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
    { header: "规格",         key: "specSize",          width: 14 },
    { header: "备注",         key: "potColorNotes",     width: 16 },
    { header: "发货地",       key: "origin",            width: 10 },
    { header: "库存",         key: "stock",             width: 8 },
    { header: "重量",         key: "weight",            width: 8 },
    { header: "结算价",       key: "settlementPrice",   width: 10 },
    { header: "运费",         key: "shippingFee",       width: 8 },
    { header: "成本价",       key: "costPrice",         width: 10 },
    { header: "销售价",       key: "sellPrice",         width: 10 },
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
    { header: "电商平台参考", key: "ecommerceReferenceUrl", width: 24 },
  ];

  ws.columns = columns;

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A2E" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.height = 24;

  const imgH = imageHeight;
  const imgW = Math.round(imgH * 0.75);
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
    row.getCell("settlementPrice").value = Number(p.settlementPrice || 0) || "";
    row.getCell("shippingFee").value = Number(p.shippingFee || 0) || "";
    row.getCell("costPrice").value = costP || "";
    row.getCell("sellPrice").value = sellP || "";
    row.getCell("retailMarkupPrice").value = p.retailMarkupPrice || "";
    row.getCell("profit").value = pft ? pft.toFixed(1) : "";
    row.getCell("profitRate").value = pftRate ? pftRate.toFixed(0) + "%" : "";
    row.getCell("taxRateA").value = p.taxRateA ?? "";
    row.getCell("taxRateB").value = p.taxRateB ?? "";
    row.getCell("potColorNotes").value = p.potColorNotes || "";
    row.getCell("isListed").value = p.isListed ? "已上架" : "未上架";
    row.getCell("productId").value = p.productId || "";
    row.getCell("ecommerceReferenceUrl").value = p.ecommerceReferenceUrl || "";

    // ── Embed thumbnail from each dedicated column (cols 0-10) ──
    const allImgCols = [
      { key: "panorama_images",    col: 0,  label: "主图" },
      { key: "package_images",     col: 1,  label: "发货包装" },
      { key: "detail_images",      col: 2,  label: "细节特写" },
      { key: "root_soil_images",   col: 3,  label: "根系盆土" },
      { key: "size_ref_images",    col: 4,  label: "尺寸参考" },
      { key: "scene_images",       col: 21, label: "场景应用" },
      { key: "selling_point_images", col: 22, label: "品种卖点" },
      { key: "care_images",         col: 23, label: "养护教程" },
      { key: "comparison_images",   col: 24, label: "规格对比" },
      { key: "shipping_images",     col: 25, label: "发货售后" },
      { key: "after_sale_images",   col: 26, label: "售后保障" },
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
    row.getCell("profit").alignment = { horizontal: "right" };
    row.getCell("profitRate").alignment = { horizontal: "right" };
    row.getCell("taxRateA").alignment = { horizontal: "right" };
    row.getCell("taxRateB").alignment = { horizontal: "right" };
    row.getCell("weight").alignment = { horizontal: "right" };
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
    "potColorNotes", "stock", "weight", "dropShippingCost",
    "dropShippingMarketPrice", "settlementPrice", "shippingFee", "costPrice", "sellPrice",
    "retailMarkupPrice", "profit", "platformPriceDiff",
    "couponInfo", "retailProfit", "description", "batchMinQty",
    "batchShipping", "batchUnitPrice", "listedStore", "salesVolume",
    "images", "isListed", "listedDate",
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
