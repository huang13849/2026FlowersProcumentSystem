#!/usr/bin/env node
const fs=require('fs'); const src=fs.readFileSync('product-service/frontend/src/pages/ProductList.jsx','utf8');
function assert(c,m){ if(!c){console.error('FAIL:',m); process.exitCode=1;} else console.log('OK:',m); }
const cols=src.slice(src.indexOf('const COLUMNS = ['), src.indexOf('// 场景标签词表'));
assert(cols.indexOf("field: 'title'") > -1, 'title column exists');
assert(cols.indexOf("field: 'title'") < cols.indexOf("field: 'panorama'"), 'title is first product data column');
assert(src.includes('CHECKBOX_COL_WIDTH = 32'), 'checkbox width constant exists');
assert(src.includes('function stickyLeftForCol') && src.includes('function stickyStyleForCol'), 'sticky helper functions exist');
assert(src.includes("col.field === 'title'"), 'sticky helper targets title column');
assert(src.includes("position: 'sticky'") || src.includes("position:'sticky'"), 'sticky positioning is used');
assert(src.includes('left: stickyLeftForCol(col)') && src.includes('CHECKBOX_COL_WIDTH'), 'title freezes just after checkbox column');
assert(src.includes("position:'sticky', left:0") || src.includes("position:'sticky', left:0"), 'checkbox column is sticky at left edge');
assert(src.includes('...stickyStyleForCol(col, true)') && src.includes('...stickyStyleForCol(col)'), 'header and cells apply sticky style');
if(process.exitCode) process.exit(process.exitCode);
console.log('supplier title first/frozen verification passed');
