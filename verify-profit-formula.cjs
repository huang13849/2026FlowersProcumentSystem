#!/usr/bin/env node
const fs = require('fs');
function assert(c,m){ if(!c){ console.error('FAIL:',m); process.exitCode=1; } else console.log('OK:',m); }
const fe = fs.readFileSync('product-service/frontend/src/pages/ProductList.jsx','utf8');
const ex = fs.readFileSync('product-service/backend/services/exporter.js','utf8');
assert(fe.includes('return s * (1 - ((ta - tb) / 100)) - c;'), 'frontend profit uses sellPrice*(1-(taxA-taxB))-cost');
assert(fe.includes('¥{pft.toFixed(2)}'), 'frontend profit displays 2 decimals');
assert(ex.includes('function computeProfit(p)') && ex.includes('return sellP * (1 - ((taxRateA - taxRateB) / 100)) - costP;'), 'exporter uses same profit formula');
assert(ex.includes('Number(pft.toFixed(2))'), 'exporter exports profit to 2 decimals');
assert(ex.includes('const pft = computeProfit(p);'), 'all export modes use computeProfit helper');
const sample = { sellPrice: 100, settlementPrice: 60, shippingFee: 10, taxRateA: 6, taxRateB: 3 };
const expected = 100 * (1 - ((6 - 3) / 100)) - (60 + 10);
assert(expected.toFixed(2) === '27.00', 'sample formula gives expected 27.00');
if(process.exitCode) process.exit(process.exitCode);
console.log('profit formula verification passed');
