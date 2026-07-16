const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3020;

// ==== APP MANIFEST (single source of truth) ====
const APPS = [
  { id:'products',   name:'商品管理',      icon:'🌸', href:'http://100.96.54.109:31001/', color:'#eb2f96', gradient:'linear-gradient(135deg,#f759ab,#eb2f96)' },
  { id:'suppliers',  name:'供应商管理',   icon:'🏭', href:'http://100.96.54.109:31002/', color:'#722ed1', gradient:'linear-gradient(135deg,#9254de,#722ed1)' },
  { id:'shops',      name:'店铺管理',      icon:'🏪', href:'http://100.96.54.109:31004/', color:'#1890ff', gradient:'linear-gradient(135deg,#40a9ff,#1890ff)' },
  { id:'orders',     name:'订单管理',      icon:'🛒', href:'http://100.96.54.109:31008/', color:'#fa8c16', gradient:'linear-gradient(135deg,#ffa940,#fa8c16)' },
  { id:'users',      name:'用户管理',      icon:'👥', href:'http://100.96.54.109:8088/users', color:'#13c2c2', gradient:'linear-gradient(135deg,#36cfc9,#13c2c2)' },
  { id:'tags',       name:'标签总控',      icon:'🏷️', href:'http://100.96.54.109:8088/tags-admin', color:'#eb2f96', gradient:'linear-gradient(135deg,#eb2f96,#722ed1)' },
  { id:'architect',  name:'架构设计',      icon:'🏗️', href:'http://100.96.54.109:30811/', color:'#fa8c16', gradient:'linear-gradient(135deg,#ffa940,#fa8c16)' },
  { id:'maps',       name:'地图管理',      icon:'🗺️', href:'http://100.96.54.109:31307/', color:'#52c41a', gradient:'linear-gradient(135deg,#73d13d,#52c41a)' },
  { id:'metadata',   name:'数据目录',      icon:'📊', href:'http://100.96.54.109:8088/shrubs', color:'#faad14', gradient:'linear-gradient(135deg,#ffc53d,#faad14)' },
  { id:'monitor',    name:'监控看板',      icon:'📈', href:'http://100.96.54.109:8088/monitor/', color:'#f5222d', gradient:'linear-gradient(135deg,#ff4d4f,#f5222d)' }
];

app.use((req,res,next)=>{ res.set('Access-Control-Allow-Origin','*'); res.set('Cache-Control','no-store'); next(); });

app.get('/api/nav/apps', (req,res) => res.json({ success:true, count:APPS.length, data:APPS }));
app.get('/api/nav/health', async (req,res) => {
  const http = require('http');
  const checks = await Promise.all(APPS.map(a => new Promise(resolve => {
    try {
      const u = new URL(a.href);
      const req = http.request({ host:u.hostname, port:u.port||80, path:u.pathname, method:'HEAD', timeout:1500 },
        r => resolve({ id:a.id, status:r.statusCode<500?'up':'down', code:r.statusCode }));
      req.on('error', () => resolve({ id:a.id, status:'down', code:0 }));
      req.on('timeout', () => { req.destroy(); resolve({ id:a.id, status:'down', code:0 }); });
      req.end();
    } catch(e) { resolve({ id:a.id, status:'down', code:0 }); }
  })));
  res.json({ success:true, data:checks });
});

app.get('/nav.css', (req,res) => {
  res.type('text/css');
  res.send(fs.readFileSync(path.join(__dirname,'public','nav.css'),'utf8'));
});
app.get('/nav.js', (req,res) => {
  res.type('application/javascript');
  const js = fs.readFileSync(path.join(__dirname,'public','nav.js'),'utf8');
  res.send(js.replace('__APPS_JSON__', JSON.stringify(APPS)));
});
app.get(['/','/console','/console/'], (req,res) => {
  res.type('text/html');
  const html = fs.readFileSync(path.join(__dirname,'public','console.html'),'utf8');
  res.send(html.replace('__APPS_JSON__', JSON.stringify(APPS)));
});

app.get('/healthz', (req,res) => res.json({ ok:true, service:'console-nav', version:'1.0.0' }));

app.listen(PORT, () => console.log(`[console-nav] listening on ${PORT}`));
