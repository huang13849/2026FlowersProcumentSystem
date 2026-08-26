# ── order-web ──
# 订单管理前端 (React CDN 单页应用, 纯静态 nginx 服务)
# API_BASE = window.location.origin, 所以同源 /api/* 转发到 order-service

FROM 100.76.15.64:5001/library/nginx:1.27-alpine-amd64

RUN rm -rf /usr/share/nginx/html/*
COPY public/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]