import ExcelJS from 'exceljs';
import axios from 'axios';

/**
 * Export products to Excel with embedded images.
 * Downloads each image, adds it to the cell, and sets row height accordingly.
 */
export async function exportToExcel(products, { imageHeight = 80 } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('商品列表');

  // Column definitions — cover all useful fields
  const columns = [
    { header: '主图',       key: 'mainImage',  width: 14 },
    { header: '商品标题',   key: 'title',       width: 36 },
    { header: '分类',       key: 'category',    width: 12 },
    { header: '商家',       key: 'sellerName',  width: 16 },
    { header: '花卉名称',   key: 'flowerName',  width: 14 },
    { header: '规格',       key: 'specSize',    width: 14 },
    { header: '发货地',     key: 'origin',      width: 10 },
    { header: '库存',       key: 'stock',       width: 8 },
    { header: '重量',       key: 'weight',      width: 8 },
    { header: '成本价',     key: 'costPrice',   width: 10 },
    { header: '销售价',     key: 'sellPrice',   width: 10 },
    { header: '利润',       key: 'profit',      width: 10 },
    { header: '利润率',     key: 'profitRate',  width: 10 },
    { header: '乙方税率',       key: 'taxRateB',  width: 8 },
    { header: '甲方税率',       key: 'taxRateA',  width: 8 },
    { header: '备注',       key: 'potColorNotes', width: 16 },
    { header: '上架状态',   key: 'isListed',    width: 10 },
    { header: '商品ID',     key: 'productId',   width: 18 },
    { header: '发货包装图', key: 'package_images', width: 18 },
    { header: '细节特写',   key: 'detail_images', width: 18 },
    { header: '根系盆土',   key: 'root_soil_images', width: 18 },
    { header: '尺寸参考',   key: 'size_ref_images', width: 18 },
    { header: '场景应用',   key: 'scene_images', width: 18 },
    { header: '品种卖点',   key: 'selling_point_images', width: 18 },
    { header: '养护教程',   key: 'care_images', width: 18 },
    { header: '规格对比',   key: 'comparison_images', width: 18 },
    { header: '发货售后',   key: 'shipping_images', width: 18 },
    { header: '售后保障',   key: 'after_sale_images', width: 18 },
  ];

  ws.columns = columns;

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.height = 24;

  const imgH = imageHeight;                // px height for images in Excel
  const imgW = Math.round(imgH * 0.75);    // approximate width (aspect ~4:3)
  const extReg = /\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i;

  // Helper: download image buffer + detect extension
  async function fetchImage(url) {
    if (!url) return null;
    try {
      const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
      let ext = 'png';
      const m = url.match(extReg);
      if (m) ext = m[1].toLowerCase();
      if (ext === 'jpeg') ext = 'jpg';
      return { buffer: Buffer.from(resp.data), extension: ext };
    } catch (e) {
      console.warn('Image download failed:', url, e.message);
      return null;
    }
  }

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const rowIdx = i + 2; // Excel row (1 = header)
    const row = ws.getRow(rowIdx);
    row.height = imgH + 4;

    // Calculate derived fields
    const costP = Number(p.costPrice || 0);
    const sellP = Number(p.sellPrice || 0);
    const pft = sellP - costP;
    const pftRate = costP > 0 ? ((pft / costP) * 100) : 0;

    // Fill text columns
    row.getCell('title').value = p.title || '';
    row.getCell('category').value = p.category || '';
    row.getCell('sellerName').value = p.sellerName || '';
    row.getCell('flowerName').value = p.flowerName || '';
    row.getCell('specSize').value = p.specSize || '';
    row.getCell('origin').value = p.origin || '';
    row.getCell('stock').value = p.stock || 0;
    row.getCell('weight').value = p.weight ?? '';
    row.getCell('costPrice').value = costP || '';
    row.getCell('retailMarkupPrice').value = p.retailMarkupPrice ?? '';
    row.getCell('sellPrice').value = sellP || '';
    row.getCell('profit').value = pft ? pft.toFixed(1) : '';
    row.getCell('profitRate').value = pftRate ? pftRate.toFixed(0) + '%' : '';
    row.getCell('taxRateA').value = p.taxRateA ?? '';
    row.getCell('taxRateB').value = p.taxRateB ?? '';
    row.getCell('potColorNotes').value = p.potColorNotes || '';
    row.getCell('isListed').value = p.isListed ? '已上架' : '未上架';
    row.getCell('productId').value = p.productId || '';

    // ── Main image from panorama_images ──
    const images = p.images || [];
    const mainImg = (p.panorama_images || images)[0];
    if (mainImg) {
      const imgData = await fetchImage(mainImg);
      if (imgData) {
        const imageId = wb.addImage({
          buffer: imgData.buffer,
          extension: imgData.extension,
        });
        ws.addImage(imageId, {
          tl: { col: 0, row: rowIdx - 1 },
          ext: { width: imgW, height: imgH },
        });
      }
    }

    // ── Extra images (2nd onwards) — embed up to 3 small thumbnails ──
    const extraImgs = images.slice(1, 4);
    if (extraImgs.length > 0) {
      const smallH = Math.round(imgH * 0.45);
      const smallW = Math.round(smallH * 0.75);
      let colOffset = 19; // "多图" column index (0-based)

      for (let ei = 0; ei < extraImgs.length; ei++) {
        const imgData = await fetchImage(extraImgs[ei]);
        if (imgData) {
          const imageId = wb.addImage({
            buffer: imgData.buffer,
            extension: imgData.extension,
          });
          // Stack thumbnails vertically within the "多图" column
          const yOffset = ei * (smallH + 2);
          ws.addImage(imageId, {
            tl: { col: colOffset, row: rowIdx - 1 },
            ext: { width: smallW, height: smallH },
            editAs: 'oneCell',
          });
        }
      }
      // Also add URLs as text comment for reference
      row.getCell('extraImages').value = extraImgs.join('\n');
    }

    // Alignment
    row.getCell('stock').alignment = { horizontal: 'right' };
    row.getCell('costPrice').alignment = { horizontal: 'right' };
    row.getCell('sellPrice').alignment = { horizontal: 'right' };
    row.getCell('profit').alignment = { horizontal: 'right' };
    row.getCell('profitRate').alignment = { horizontal: 'right' };
  }

  // Freeze header
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

export function exportToCSV(products) {
  const fields = [
    'productId', 'title', 'category', 'sellerName', 'flowerName',
    'contactPerson', 'specSize', 'deliveryMethod', 'origin',
    'potColorNotes', 'stock', 'weight', 'dropShippingCost',
    'dropShippingMarketPrice', 'costPrice', 'sellPrice',
    'retailMarkupPrice', 'profit', 'platformPriceDiff',
    'couponInfo', 'retailProfit', 'description', 'batchMinQty',
    'batchShipping', 'batchUnitPrice', 'listedStore', 'salesVolume',
    'images', 'isListed', 'listedDate',
  ];
  // Simple CSV generation (json2csv may not be installed)
  const header = fields.join(',');
  const rows = products.map(p => fields.map(f => {
    let v = p[f] ?? '';
    if (f === 'images') v = (p.images || []).join('; ');
    if (f === 'isListed') v = p.isListed ? '是' : '否';
    if (f === 'listedDate' && v) v = new Date(v).toISOString();
    // Escape CSV
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(','));
  return header + '\n' + rows.join('\n');
}
