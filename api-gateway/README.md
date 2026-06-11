# 🚪 API Gateway — 供应链平台统一数据网关

## 概述

API Gateway 是 supply-chain-platform 的核心微服务之一，统一对外提供 MongoDB / PostgreSQL / Redis / MySQL 的增删改查接口。

所有外部应用（如花伴 new-e-commerce、价格指数 price-service）通过 API Gateway 访问数据库，无需直连数据库实例。

## 架构

```
外部应用 (花伴 / 价格指数 / ...)
        │
        ▼ X-API-Key / Bearer Token
┌─────────────────────────────┐
│       API Gateway (3007)     │
│  ┌─────────┬──────────────┐ │
│  │  认证    │   限流        │ │
│  │  API Key │  1000/15min  │ │
│  └─────────┴──────────────┘ │
│  ┌──────────────────────────┐│
│  │   路由层                  ││
│  │  /api/mongo   → MongoDB  ││
│  │  /api/pg      → PostgreSQL│
│  │  /api/redis   → Redis     ││
│  │  /api/mysql   → MySQL     ││
│  │  /api/unified → 跨库联合  ││
│  └──────────────────────────┘│
└─────────────────────────────┘
        │          │          │
        ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────┐
   │MongoDB │ │  Redis  │ │  PG    │
   │ RS0    │ │ Master  │ │ Master │
   │ RPi8(P)│ │ Ubuntu  │ │ RPi8   │
   │ Mac(S) │ │         │ │        │
   └────────┘ └────────┘ └────────┘
```

## 数据库集群拓扑

### MongoDB Replica Set (rs0)
| 节点 | 主机 | IP:Port | 角色 |
|------|------|---------|------|
| RPi8 | mongodb-master | 100.67.126.90:27017 | PRIMARY |
| Mac Mini | mongodb-master-2 | 100.76.15.64:27017 | SECONDARY |

- 数据库: `supply_chain` (商品/供应商/用户/种花)
- 认证: admin / Hy@1987921
- 读写分离: 写→Primary, 读→SecondaryPreferred

### Redis
| 节点 | 主机 | IP:Port | 角色 |
|------|------|---------|------|
| ubuntu-master | redis-cache | 100.96.54.109:6379 | Master |
| ubuntu-master | redis-sentinel | 100.96.54.109:26379 | Sentinel |

- 用途: 缓存 / 会话 / 限流
- Sentinel 自动故障转移

### PostgreSQL
| 节点 | 主机 | IP:Port | 角色 |
|------|------|---------|------|
| RPi8 | postgres-master | 100.67.126.90:5432 | Master |

- 数据库: crm, graphql, k3s_srv, nextcloud, nextcloud4g

### MySQL
| 节点 | 主机 | IP:Port | 角色 |
|------|------|---------|------|
| RPi8 | mysql-master | 100.67.126.90:3306 | Master |
| RPi4 | mysql-slave | (内网) | Slave |

## API 接口

### 认证

所有 `/api/mongo`、`/api/pg`、`/api/redis`、`/api/mysql`、`/api/unified` 接口需要认证：

```bash
# 方式1: API Key
curl -H "X-API-Key: ***REMOVED_API_KEY***" http://100.96.54.109:3007/api/mongo/products

# 方式2: Bearer Token
curl -H "Authorization: Bearer <jwt-token>" http://100.96.54.109:3007/api/mongo/products

# 方式3: 内部服务 (服务间调用)
curl -H "X-Internal-Token: ***REMOVED_INTERNAL_TOKEN***" http://100.96.54.109:3007/api/mongo/products
```

### 可用 API Keys
| Key | 用途 |
|-----|------|
| `***REMOVED_API_KEY***` | 花伴客户端应用 |
| `***REMOVED_API_KEY***` | 供应链管理平台 |

### 健康检查（无需认证）

```bash
GET /api/health
```

### MongoDB CRUD

```bash
# 列出所有集合
GET /api/mongo/collections

# 查询文档（支持过滤/排序/分页/字段选择）
GET /api/mongo/:collection?filter={"category":"花卉"}&sort={"price":-1}&page=1&limit=20&fields=name,price

# 查询单个文档
GET /api/mongo/:collection/:id

# 创建文档
POST /api/mongo/:collection
Body: { "name": "测试商品", "price": 99.9 }

# 批量创建
POST /api/mongo/:collection/bulk
Body: [{ "name": "商品1" }, { "name": "商品2" }]

# 更新文档
PUT /api/mongo/:collection/:id
Body: { "price": 88.8 }

# 删除文档
DELETE /api/mongo/:collection/:id

# 聚合查询
POST /api/mongo/:collection/aggregate
Body: [{ "$match": { "price": { "$gt": 50 } } }, { "$group": { "_id": "$category", "avgPrice": { "$avg": "$price" } } }]
```

### PostgreSQL

```bash
# 列出数据库
GET /api/pg/databases

# 列出表
GET /api/pg/:database/tables

# 查询表数据
GET /api/pg/:database/:table?filter={"column":"value"}&page=1&limit=20

# 创建记录
POST /api/pg/:database/:table
Body: { "column1": "value1" }

# 更新记录
PUT /api/pg/:database/:table/:id
Body: { "column1": "new_value" }

# 删除记录
DELETE /api/pg/:database/:table/:id

# 执行原始 SQL
POST /api/pg/query
Body: { "database": "crm", "sql": "SELECT * FROM users LIMIT 10" }
```

### Redis

```bash
# 基本信息
GET /api/redis/info

# 获取 key
GET /api/redis/key/:key

# 设置 key
POST /api/redis/key/:key
Body: { "value": "hello", "ttl": 300, "type": "string" }

# 删除 key
DELETE /api/redis/key/:key

# 搜索 keys
GET /api/redis/keys/:pattern

# 健康检查
GET /api/redis/health
```

### 跨库联合查询

```bash
# 商品详情（MongoDB 商品 + Redis 缓存）
GET /api/unified/product/:id

# 数据库概览
GET /api/unified/overview
```

## 花伴项目调用示例

```javascript
// Mac Mini 上的花伴 App 调用 API Gateway
const API_KEY = '***REMOVED_API_KEY***';
const GATEWAY = 'http://100.96.54.109:3007';

// 查询商品
const products = await fetch(
  `${GATEWAY}/api/mongo/products?limit=20&fields=name,price,images,category`,
  { headers: { 'X-API-Key': API_KEY } }
).then(r => r.json());

// 查询种花数据
const plants = await fetch(
  `${GATEWAY}/api/mongo/plants?fields=name,emoji,growDays,stages`,
  { headers: { 'X-API-Key': API_KEY } }
).then(r => r.json());

// 查询用户花园
const myGarden = await fetch(
  `${GATEWAY}/api/mongo/gardenplots?filter={"userId":"${userId}"}`,
  { headers: { 'X-API-Key': API_KEY } }
).then(r => r.json());

// 创建种花记录
await fetch(`${GATEWAY}/api/mongo/gardenplots`, {
  method: 'POST',
  headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId, plantId, plantName: '向日葵', status: 'growing', currentDay: 0 }),
});

// Redis 缓存推荐结果
await fetch(`${GATEWAY}/api/redis/key/recommend:${userId}`, {
  method: 'POST',
  headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ value: JSON.stringify(recommendations), ttl: 300 }),
});
```

## 部署

```bash
# ubuntu-master 上
cd ~/supply-chain-platform
docker compose up -d api-gateway

# 验证
curl http://localhost:3007/api/health
```

## 微服务架构（更新后）

| 服务 | 端口 | 容器名 | 说明 |
|------|------|--------|------|
| api-gateway | 3007 | api-gateway | **统一数据网关**（新增） |
| product-service | 3001 | product-service | 商品管理 |
| supplier-service | 3002 | supplier-service | 供应商管理 |
| ai-service | 3003 | ai-service | AI 服务 |
| shop-service | 3004 | shop-service | 店铺管理 |
| publish-service | 3005 | publish-service | 多平台发布 |
| contract-service | 3006 | contract-service | 合同管理 |
| nginx-gateway | 8088 | nginx-gateway | Nginx 反向代理 |

## 安全

- API Key 认证：每个应用分配独立 Key
- 限流：每 IP 每 15 分钟 1000 次
- Helmet: HTTP 安全头
- CORS: 跨域白名单
- 内部服务 Token: 服务间调用认证
