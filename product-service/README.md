# 2026FlowersProcumentSystem

智能供应链商品采购系统

## 技术栈
- Backend: Node.js + Express + MongoDB
- Frontend: React + Vite
- Database: MongoDB Replica Set (rpi8 PRIMARY, rpi4 SECONDARY)
- Deployment: Docker on ubuntu-master (100.96.54.109)

## 访问
http://100.96.54.109:3001

## 架构
- rpi8: MongoDB PRIMARY (write)
- rpi4: MongoDB SECONDARY (read)
- ubuntu-master: Node.js 服务 + PicGo 图床
