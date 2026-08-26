# DEPRECATED — moved to order-web-service

This directory is no longer maintained. The active order management frontend
code now lives in the independent repository:

  http://100.76.15.64:13000/admin/order-web-service

## Why

split (2026-08-27): order-web-service 拆出独立仓库，部署/构建不再依赖 supply-chain-platform。

## What still works

- k3s Deployment/Service name `order-web` unchanged (NodePort 31020)

## What to NOT do

- Don't commit new changes here
- Update order-web-service instead
