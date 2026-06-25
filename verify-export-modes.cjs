#!/usr/bin/env node
const fs=require('fs');
function assert(c,m){ if(!c){ console.error('FAIL:',m); process.exitCode=1; } else console.log('OK:',m); }
const fe=fs.readFileSync('product-service/frontend/src/pages/ProductList.jsx','utf8');
const route=fs.readFileSync('product-service/backend/routes/export.js','utf8');
const exporter=fs.readFileSync('product-service/backend/services/exporter.js','utf8');
assert(fe.includes("exportExcel('simple')") && fe.includes('📄 简单导出'), 'frontend has simple export button');
assert(fe.includes("exportExcel('full')") && fe.includes('📊 全列全量导出'), 'frontend has full export button');
assert(fe.includes("params.set('mode', mode === 'full' ? 'full' : 'simple')"), 'frontend passes export mode');
assert(route.includes('requestedMode') && route.includes('mode === "full"') && route.includes('mode === "withImages"'), 'backend route supports export modes');
assert(exporter.includes('SIMPLE_EXPORT_COLUMNS') && exporter.includes('FULL_EXPORT_COLUMNS'), 'exporter defines simple and full columns');
assert(exporter.includes('exportNoImageExcel') && exporter.includes('if (mode === "simple" || mode === "full")'), 'exporter bypasses embedded images for simple/full');
assert(exporter.includes('图片/视频 URL 文本') || exporter.includes('图片/视频 URL'), 'full export keeps image/video URLs as text');
assert(fe.includes('product-list-table') && fe.includes('场景标签') && fe.includes('商品视频'), 'current product table features retained');
if(process.exitCode) process.exit(process.exitCode);
console.log('export modes verification passed');
