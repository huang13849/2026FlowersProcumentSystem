/**
 * 配置模块 —— 统一管理环境变量与默认值
 *
 * 环境变量由入口 index.js 中的 dotenv.config() 加载，
 * 这里只读取 process.env，不重复加载。
 */

const config = {
  port: parseInt(process.env.PORT, 10) || 3005,

  productService: {
    baseUrl: process.env.PRODUCT_SERVICE_URL || 'http://product-service:3001',
    // 实际 product-service (backend/server.js) 默认是 PORT=3000,
    // 但 docker-compose 中映射为 3001:3000
    // 容器间通信用 http://product-service:3001
    username: process.env.PRODUCT_SERVICE_USERNAME || '',
    password: process.env.PRODUCT_SERVICE_PASSWORD || '',
    timeoutMs: 15000,
  },

  minio: {
    endPoint: process.env.MINIO_ENDPOINT || 'minio',
    port: parseInt(process.env.MINIO_PORT, 10) || 9000,
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket: process.env.MINIO_BUCKET || 'products',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  },

  platforms: {
    douyin: {
      name: '抖店',
      appKey: process.env.DOUYIN_APP_KEY || '',
      appSecret: process.env.DOUYIN_APP_SECRET || '',
      apiBase: 'https://openapi-fxg.jinritemai.com',
    },
    xiaohongshu: {
      name: '小红书',
      appKey: process.env.XIAOHONGSHU_APP_KEY || '',
      appSecret: process.env.XIAOHONGSHU_APP_SECRET || '',
      apiBase: 'https://ark.xiaohongshu.com/api',
    },
    pinduoduo: {
      name: '拼多多',
      appKey: process.env.PINDUODUO_APP_KEY || '',
      appSecret: process.env.PINDUODUO_APP_SECRET || '',
      apiBase: 'https://gw-api.pinduoduo.com/api/router',
    },
    shipinhao: {
      name: '视频号',
      appKey: process.env.SHIPINHAO_APP_KEY || '',
      appSecret: process.env.SHIPINHAO_APP_SECRET || '',
      apiBase: 'https://api.weixin.qq.com/channels/ec',
      // 微信小店配置
      freightTemplateId: process.env.WECHAT_FREIGHT_TEMPLATE_ID || '905443892004',
      afterSaleAddressId: process.env.WECHAT_AFTER_SALE_ADDRESS_ID || '62961836002',
    },
    huaxiang: {
      name: '花乡花木',
      apiBase: process.env.HUAXIANG_API_BASE || 'https://admin.huaxianghuamu.cn',
      token: process.env.HUAXIANG_TOKEN || '',
      cookie: process.env.HUAXIANG_COOKIE || '',
      productCategory: parseInt(process.env.HUAXIANG_CATEGORY, 10) || 9000023,
    },
  },

  retry: {
    maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 3,
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS, 10) || 5000,
  },
};

module.exports = config;
