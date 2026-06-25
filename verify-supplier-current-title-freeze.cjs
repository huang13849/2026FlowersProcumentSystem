#!/usr/bin/env node
const fs=require('fs');
const src=fs.readFileSync('product-service/frontend/src/pages/ProductList.jsx','utf8');
function assert(c,m){ if(!c){ console.error('FAIL:',m); process.exitCode=1; } else console.log('OK:',m); }
const cols=src.slice(src.indexOf('const COLUMNS = ['), src.indexOf('// 场景标签词表'));
assert(cols.indexOf("field: 'title'") >= 0, 'title column exists');
assert(cols.indexOf("field: 'title'") < cols.indexOf("field: 'panorama'"), 'title is first product data column');
assert(src.includes('className="product-list-table"'), 'table has product-list-table class');
assert(src.includes('.product-list-table th:first-child') && src.includes('left: 0 !important'), 'checkbox column is frozen at left 0');
assert(src.includes('.product-list-table th:nth-child(2)') && src.includes('left: 32px !important'), 'title column is frozen after checkbox');
assert(src.includes('sceneTags') && src.includes('场景标签'), 'scene tag feature retained');
assert(src.includes('floweringMonths') && src.includes('花期'), 'flowering months feature retained');
assert(src.includes('product_videos') && src.includes('商品视频'), 'product video feature retained');
assert(src.includes('shipping_description') && src.includes('运费说明'), 'shipping description feature retained');
if(process.exitCode) process.exit(process.exitCode);
console.log('supplier current-version title-first-freeze verification passed');
