# DEPRECATED — moved to order-management-service

This directory is no longer maintained. The active order management backend
code now lives in the independent repository:

  http://100.76.15.64:13000/admin/order-management-service

## Why

split (2026-08-27): order-management-service 拆出独立仓库，部署/构建不再依赖 supply-chain-platform。

## What still works

- k3s Deployment/Service name `order-service` unchanged (NodePort 31008)
- API endpoints unchanged
- DB schema unchanged

## What to NOT do

- Don't commit new changes here
- Don't push from this directory to gitea
- Update order-management-service instead
