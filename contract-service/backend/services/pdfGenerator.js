import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const PARTY_A = {
  name: "北京花乡数字科技有限公司",
  taxId: "91110106MACSRKTH9G",
  address: "",
  contact: "",
};

function parseTemplate(template, data) {
  return template
    .replace(/\{\{partyA_name\}\}/g, PARTY_A.name)
    .replace(/\{\{partyA_taxId\}\}/g, PARTY_A.taxId)
    .replace(/\{\{partyB_name\}\}/g, data.supplierName || "________")
    .replace(/\{\{partyB_taxId\}\}/g, data.supplierTaxId || "________")
    .replace(/\{\{date\}\}/g, data.date || new Date().toLocaleDateString("zh-CN"))
    .replace(/\{\{contractNo\}\}/g, data.contractNo || "________");
}

export async function generateContractPdf(templateText, data, outputPath) {
  const content = parseTemplate(templateText, data);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 60, right: 60 },
      info: {
        Title: data.title || "合同",
        Author: PARTY_A.name,
      },
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // Font
    doc.font("Helvetica");

    // Title
    doc.fontSize(16).text(content.split("\n")[0] || "合同", { align: "center" });
    doc.moveDown(1);

    // Content
    doc.fontSize(11);
    const lines = content.split("\n").slice(1);
    for (const line of lines) {
      if (line.trim().startsWith("第") && line.trim().endsWith("条")) {
        doc.fontSize(12).font("Helvetica-Bold").text(line.trim(), { indent: 0 });
        doc.fontSize(11).font("Helvetica");
        doc.moveDown(0.3);
      } else if (line.trim() === "") {
        doc.moveDown(0.5);
      } else {
        doc.text(line.trim(), { indent: 20, align: "justify" });
        doc.moveDown(0.2);
      }
    }

    // Signature area
    doc.moveDown(3);
    doc.fontSize(11);
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const halfWidth = pageWidth / 2 - 20;

    const signatureY = doc.y;
    doc.text("甲方（盖章）：" + PARTY_A.name, 60, signatureY, { width: halfWidth });
    doc.text("乙方（盖章）：", 60 + halfWidth + 20, signatureY, { width: halfWidth });
    doc.moveDown(2);
    doc.text("日期：" + data.date, 60);
    doc.text("日期：", 60 + halfWidth + 20);

    doc.end();
    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
  });
}

export function getDefaultTemplate(type) {
  if (type === "supply") {
    return `2026 花乡数科 × {{partyB_name}} 产品供应与代发协议

合同编号：{{contractNo}}

甲方（平台方）：{{partyA_name}}
统一社会信用代码：{{partyA_taxId}}

乙方（供应方）：{{partyB_name}}
统一社会信用代码：{{partyB_taxId}}

第一条 合作内容
甲乙双方本着平等互利、诚实信用的原则，就乙方通过甲方平台进行花卉绿植产品的供应与代发业务，达成如下协议。

第二条 甲方权利与义务
1. 甲方负责平台运营，为乙方提供商品展示、订单管理、物流配送等技术支持服务。
2. 甲方有权对乙方提供的商品信息进行审核，对不符合平台规则的商品予以下架处理。
3. 甲方应按约定周期与乙方结算代发货款。

第三条 乙方权利与义务
1. 乙方应保证所供商品符合国家质量标准及平台规定的品质要求。
2. 乙方应在接到订单后24小时内完成发货，并确保物流信息真实可追溯。
3. 乙方应提供真实、完整的商品信息，包括但不限于商品描述、规格、价格、库存等。

第四条 结算方式
双方按月结算代发费用，每月5日前对上月数据进行核对，15日前完成支付。

第五条 违约责任
任何一方违反本协议约定，应向对方支付违约金，金额为违约行为所涉订单金额的20%。

第六条 争议解决
本协议履行过程中发生争议，双方应友好协商解决；协商不成的，提交甲方所在地人民法院诉讼解决。

第七条 协议期限
本协议自双方签署之日起生效，有效期为一年。期满前30天，双方均未提出书面异议的，自动续签。

甲方（签章）：{{partyA_name}}
乙方（签章）：{{partyB_name}}

签订日期：{{date}}`;
  } else {
    return `2026 花乡数科 × {{partyB_name}} 批发供给协议

合同编号：{{contractNo}}

甲方（采购方）：{{partyA_name}}
统一社会信用代码：{{partyA_taxId}}

乙方（供应方）：{{partyB_name}}
统一社会信用代码：{{partyB_taxId}}

第一条 合作内容
甲方通过乙方采购花卉绿植产品，乙方按本协议约定向甲方提供批发供货服务。

第二条 供货要求
1. 乙方应按照甲方订单要求，提供符合约定规格和质量标准的产品。
2. 乙方应确保供货的及时性，常规订单在48小时内完成备货。
3. 乙方应提供产品的质检合格证明及相关资质文件。

第三条 价格与结算
1. 产品价格以双方确认的报价单为准，乙方调价应提前7天书面通知甲方。
2. 甲方按照实际验收合格的数量与乙方结算，结算周期为月结30天。

第四条 质量保证
1. 乙方保证所供产品为合格产品，不存在任何权利瑕疵。
2. 如因乙方产品质量问题导致甲方损失的，乙方应承担相应赔偿责任。

第五条 保密条款
双方应对本协议内容及履行过程中知悉的对方商业秘密予以保密，未经对方书面同意不得向第三方披露。

第六条 协议期限与终止
本协议有效期一年。任何一方提前30天书面通知可终止本协议。

甲方（签章）：{{partyA_name}}
乙方（签章）：{{partyB_name}}

签订日期：{{date}}`;
  }
}
