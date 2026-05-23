import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

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
  const parser = new Parser({
    fields,
    transforms: [(item) => {
      const row = { ...item };
      row.images = (item.images || []).join('; ');
      row.isListed = item.isListed ? '是' : '否';
      row.listedDate = item.listedDate ? new Date(item.listedDate).toISOString() : '';
      return row;
    }],
  });
  return parser.parse(products);
}

export async function exportToExcel(products) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('商品列表');
  ws.columns = [
    { header: '商品ID', key: 'productId', width: 20 },
    { header: '商品标题', key: 'title', width: 40 },
    { header: '分类', key: 'category', width: 15 },
    { header: '商家', key: 'sellerName', width: 20 },
    { header: '花卉名称', key: 'flowerName', width: 15 },
    { header: '库存', key: 'stock', width: 10 },
    { header: '成本价', key: 'costPrice', width: 10 },
    { header: '销售价', key: 'sellPrice', width: 10 },
    { header: '利润', key: 'profit', width: 10 },
    { header: '已上架', key: 'isListed', width: 8 },
    { header: '图片URL', key: 'images', width: 60 },
    { header: '描述', key: 'description', width: 50 },
  ];
  for (const p of products) {
    ws.addRow({
      ...p,
      images: (p.images || []).join('; '),
      isListed: p.isListed ? '是' : '否',
    });
  }
  ws.getRow(1).font = { bold: true };
  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

export function exportToPDF(products) {
  const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
  const buffers = [];
  doc.on('data', b => buffers.push(b));
  doc.fontSize(16).text('商品采购清单', { align: 'center' }).moveDown();
  doc.fontSize(8);
  const headers = ['商品ID', '标题', '分类', '库存', '成本', '售价', '利润'];
  const cols = [80, 180, 60, 40, 50, 50, 50];
  let y = doc.y;
  const pageWidth = 700;
  headers.forEach((h, i) => {
    doc.text(h, 30 + cols.slice(0, i).reduce((a, b) => a + b, 0), y, { width: cols[i] });
  });
  doc.moveDown(0.5);
  y = doc.y;
  for (const p of products) {
    if (y > 500) { doc.addPage(); y = doc.y; }
    const row = [p.productId, p.title, p.category, p.stock, p.costPrice, p.sellPrice, p.profit];
    let x = 30;
    row.forEach((val, i) => {
      doc.text(String(val ?? ''), x, y, { width: cols[i] });
      x += cols[i];
    });
    y += 14;
    doc.moveDown(0.3);
  }
  doc.end();
  return new Promise(resolve => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
  });
}
