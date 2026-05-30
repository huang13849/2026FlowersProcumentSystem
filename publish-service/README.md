# publish-service 多平台商品发布服务

## 🚀 快速开始

```bash
# 1. 进入目录
cd supply-chain-platform/publish-service/backend

# 2. 安装依赖
npm install

# 3. 配置平台密钥
cp ../.env.example ../.env
# 编辑 .env，填入抖店/小红书/拼多多/视频号的密钥

# 4. 启动服务（开发模式）
npm run dev

# 5. 使用 Docker Compose
cd ..
docker-compose -f docker-compose.publish.yml up -d
```

## 📡 接口文档

所有接口通过网关 `http://localhost:8088` 访问，路径前缀 `/api/publish`

### 1. 发布商品到多平台

```
POST /api/publish
```

**请求体：**
```json
{
  "productId": "60f7b3c5a9e1f2a3b4c5d6e7",
  "platforms": ["douyin", "xiaohongshu"],
  "requestedBy": "admin"
}
```

**响应 (202 Accepted)：**
```json
{
  "success": true,
  "taskId": "a1b2c3d4-...",
  "message": "发布任务已创建，正在异步处理",
  "_links": {
    "status": "/api/publish/status/a1b2c3d4-...",
    "record": "/api/publish/record/60f7b3c5..."
  }
}
```

### 2. 查询发布状态

```
GET /api/publish/status/:taskId
```

**响应：**
```json
{
  "taskId": "a1b2c3d4-...",
  "productId": "60f7b3c5...",
  "status": "success",
  "platforms": ["douyin", "xiaohongshu"],
  "results": {
    "douyin": {
      "platform": "douyin",
      "platformName": "抖店",
      "status": "success",
      "platformProductId": "3482938471",
      "durationMs": 3200
    },
    "xiaohongshu": {
      "platform": "xiaohongshu",
      "platformName": "小红书",
      "status": "success",
      "platformProductId": "abc123",
      "durationMs": 4500
    }
  },
  "completedAt": "2026-05-29T16:30:00.000Z"
}
```

### 3. 查询商品同步记录

```
GET /api/publish/record/:productId
GET /api/publish/record/:productId?platform=douyin&status=success
```

### 4. 重新发布（失败重试）

```
POST /api/publish/retry
```

**请求体：**
```json
{
  "taskId": "a1b2c3d4-...",
  "platforms": ["douyin"]
}
```

### 5. 下架商品

```
POST /api/publish/offline
```

**请求体：**
```json
{
  "platform": "douyin",
  "platformProductId": "3482938471",
  "productId": "60f7b3c5..."
}
```

### 6. 获取支持的平台列表

```
GET /api/publish/platforms
```

**响应：**
```json
{
  "total": 4,
  "platforms": [
    { "key": "douyin", "name": "抖店", "configured": false },
    { "key": "xiaohongshu", "name": "小红书", "configured": false },
    { "key": "pinduoduo", "name": "拼多多", "configured": false },
    { "key": "shipinhao", "name": "视频号", "configured": false }
  ]
}
```

### 健康检查

```
GET /api/publish/health
GET /health
```

## 🏗️ 架构

```
nginx-gateway (8088)
    │
    ▼
publish-service (3005)
    │
    ├─→ product-service (3000)  ─→ MongoDB
    │
    ├─→ MinIO (9000)
    │
    └─→ 平台适配器
         ├── DouyinAdapter   ─→ 抖店 API
         ├── XiaohongshuAdapter ─→ 小红书 API
         ├── PinduoduoAdapter   ─→ 拼多多 API
         └── ShipinhaoAdapter   ─→ 视频号 API
```

## 📁 目录结构

```
publish-service/
├── backend/
│   ├── src/
│   │   ├── api/             # HTTP 路由
│   │   │   └── publish.js
│   │   ├── core/            # 核心业务逻辑
│   │   │   ├── PublishOrchestrator.js  # 发布编排器
│   │   │   ├── ImageUploadService.js   # 图片上传服务
│   │   │   └── StateManager.js         # 状态管理
│   │   ├── adapter/         # 平台适配器（可插拔）
│   │   │   ├── BasePlatformAdapter.js
│   │   │   ├── DouyinAdapter.js
│   │   │   ├── XiaohongshuAdapter.js
│   │   │   ├── PinduoduoAdapter.js
│   │   │   ├── ShipinhaoAdapter.js
│   │   │   └── index.js    # 适配器注册中心
│   │   ├── client/          # 外部服务客户端
│   │   │   ├── ProductClient.js
│   │   │   └── MinioImageClient.js
│   │   ├── task/            # 异步任务队列
│   │   │   └── AsyncTaskQueue.js
│   │   ├── model/           # 数据模型
│   │   │   └── index.js
│   │   ├── config/          # 配置
│   │   │   └── index.js
│   │   └── index.js         # 入口
│   └── package.json
├── data/                    # 运行时状态持久化（gitignore）
├── .env                     # 环境变量
├── Dockerfile
└── README.md
```

## 🔧 添加新平台

1. 创建适配器 `backend/src/adapter/NewPlatformAdapter.js`，继承 `BasePlatformAdapter`
2. 实现三个方法：`mapProductToPlatform()`, `publishProduct()`, `uploadImage()`
3. 在 `backend/src/adapter/index.js` 注册：

```js
const NewPlatformAdapter = require('./NewPlatformAdapter');
const adapterClasses = {
  // ...
  newplatform: NewPlatformAdapter,
};
```

4. 在 `backend/src/model/index.js` 的 `SupportedPlatforms` 数组中添加
5. 在 `.env` 中添加平台密钥

## ⚙️ 环境变量

| 变量 | 默认值 | 说明 |
|------|-------|------|
| `PORT` | 3005 | 服务端口 |
| `PRODUCT_SERVICE_URL` | http://product-service:3000 | 商品服务地址 |
| `MINIO_ENDPOINT` | minio | MinIO 服务地址 |
| `MINIO_PORT` | 9000 | MinIO 端口 |
| `MINIO_ACCESS_KEY` | minioadmin | MinIO 访问密钥 |
| `MINIO_SECRET_KEY` | minioadmin | MinIO 密钥 |
| `DOUYIN_APP_KEY` | — | 抖店 AppKey |
| `DOUYIN_APP_SECRET` | — | 抖店 AppSecret |
| `XIAOHONGSHU_APP_KEY` | — | 小红书 AppKey |
| `PINDUODUO_APP_KEY` | — | 拼多多 AppKey |
| `SHIPINHAO_APP_KEY` | — | 视频号 AppKey |
| `MAX_RETRIES` | 3 | 最大重试次数 |
| `RETRY_DELAY_MS` | 5000 | 重试间隔(ms) |

## 🧪 测试

```bash
# 健康检查
curl http://localhost:3005/health

# 查看支持的平台
curl http://localhost:3005/api/publish/platforms

# 发布商品（需要 product-service 运行中）
curl -X POST http://localhost:3005/api/publish \
  -H "Content-Type: application/json" \
  -d '{"productId":"abc123","platforms":["douyin"]}'
```
