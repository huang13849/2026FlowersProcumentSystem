# order-web

订单管理前端微服务 (React CDN SPA, nginx 静态托管)。

## 数据流

```
浏览器 ─→ http://<node>:31009 (order-web nginx)
  ├─ /              → /usr/share/nginx/html/index.html
  ├─ /favicon.svg   → 静态文件
  └─ /api/orders/*  → proxy_pass http://order-service:3008
```

`index.html` 里 `API_BASE = window.location.origin`，所以浏览器发同源请求 `/api/orders`，order-web nginx 转发到 order-service backend (k3s Service DNS)。

## 部署

- **Namespace**: `supply-chain`
- **Node**: `xsyysj` (k3s-agent)
- **NodePort**: 31009
- **Image**: `100.76.15.64:5001/supply-chain/order-web:latest`

Jenkins job `order-web` 通过 `Jenkinsfile` 自动 build & deploy。

## 手动部署

```bash
docker build -t 100.76.15.64:5001/supply-chain/order-web:latest .
docker push 100.76.15.64:5001/supply-chain/order-web:latest
kubectl -n supply-chain apply -f k8s.yaml
kubectl -n supply-chain rollout restart deploy/order-web
```

## 验证

```bash
# UI
curl http://100.96.54.109:31009/ | grep "订单管理"
# 后端 API (通过 order-web 反代)
curl http://100.96.54.109:31009/api/orders?limit=1
```