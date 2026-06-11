/**
 * API Gateway - 统一数据库连接管理
 * MongoDB Replica Set / PostgreSQL / Redis + Sentinel
 */
const mongoose = require('mongoose');
const { Pool } = require('pg');
const redis = require('redis');

// ===== 连接配置 =====
const config = {
  mongodb: {
    uri: process.env.MONGO_URI || 'mongodb://admin:Hy%401987921@100.67.126.90:27017/supply_chain?authSource=admin&replicaSet=rs0&readPreference=secondaryPreferred',
    options: {
      maxPoolSize: 20,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
    },
  },
  postgres: {
    host: process.env.PG_HOST || '100.67.126.90',
    port: process.env.PG_PORT || 5432,
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || undefined,
    database: process.env.PG_DATABASE || 'postgres',
    max: 10,
    idleTimeoutMillis: 30000,
  },
  redis: {
    sentinel: process.env.REDIS_SENTINEL_HOSTS
      ? process.env.REDIS_SENTINEL_HOSTS.split(',').map(h => ({ host: h.split(':')[0], port: parseInt(h.split(':')[1]) || 26379 }))
      : [{ host: process.env.REDIS_HOST || '100.96.54.109', port: 26379 }],
    name: process.env.REDIS_SENTINEL_NAME || 'mymaster',
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0'),
  },
};

// ===== MongoDB =====
let mongoDb = null;

async function connectMongo() {
  if (mongoDb) return mongoDb;
  try {
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    mongoDb = mongoose.connection.db;
    console.log(`✅ MongoDB connected: ${mongoose.connection.host} / ${mongoDb.databaseName}`);
    console.log(`   Replica Set: ${mongoose.connection.replicaSetStatus()?.set?.name || 'standalone'}`);
    return mongoDb;
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    throw err;
  }
}

function getMongoDb() {
  if (!mongoDb) throw new Error('MongoDB not connected');
  return mongoDb;
}

// ===== PostgreSQL =====
let pgPool = null;

async function connectPostgres() {
  if (pgPool) return pgPool;
  pgPool = new Pool(config.postgres);
  const client = await pgPool.connect();
  console.log(`✅ PostgreSQL connected: ${config.postgres.host}:${config.postgres.port}/${config.postgres.database}`);
  client.release();
  return pgPool;
}

function getPgPool() {
  if (!pgPool) throw new Error('PostgreSQL not connected');
  return pgPool;
}

// ===== Redis =====
let redisClient = null;

async function connectRedis() {
  if (redisClient) return redisClient;

  // 先尝试 Sentinel 模式
  try {
    // 查询 Sentinel 获取 master 地址
    const sentinelHost = config.redis.sentinel[0];
    const sentinelClient = redis.createClient({ socket: { host: sentinelHost.host, port: sentinelHost.port } });
    await sentinelClient.connect();

    const masterInfo = await sentinelClient.sendCommand(['SENTINEL', 'get-master-addr-by-name', config.redis.name]);
    await sentinelClient.disconnect();

    if (masterInfo && masterInfo.length >= 2) {
      const masterHost = masterInfo[0];
      const masterPort = parseInt(masterInfo[1]);
      console.log(`✅ Redis Sentinel resolved master, connecting direct: ${process.env.REDIS_HOST || '100.96.54.109'}:6379`);

      redisClient = redis.createClient({
        socket: { host: process.env.REDIS_HOST || '100.96.54.109', port: 6379 },
        password: config.redis.password,
        database: config.redis.db,
      });
    } else {
      throw new Error('Sentinel returned no master');
    }
  } catch (err) {
    // Fallback: 直连
    console.log(`⚠️  Sentinel fallback, direct connect: ${config.redis.sentinel[0].host}:6379`);
    redisClient = redis.createClient({
      socket: { host: config.redis.sentinel[0].host, port: 6379 },
      password: config.redis.password,
      database: config.redis.db,
    });
  }

  await redisClient.connect();
  console.log(`✅ Redis connected: ${redisClient.options?.socket?.host || 'unknown'}`);
  return redisClient;
}

function getRedisClient() {
  if (!redisClient) throw new Error('Redis not connected');
  return redisClient;
}

// ===== 连接全部 =====
async function connectAll() {
  const results = {};
  try { results.mongodb = await connectMongo(); } catch (e) { results.mongodbError = e.message; }
  try { results.postgres = await connectPostgres(); } catch (e) { results.postgresError = e.message; }
  try { results.redis = await connectRedis(); } catch (e) { results.redisError = e.message; }
  return results;
}

// ===== 健康检查 =====
async function healthCheck() {
  const health = { timestamp: new Date().toISOString() };

  // MongoDB
  try {
    const adminDb = mongoose.connection.db.admin();
    const result = await adminDb.ping();
    health.mongodb = { status: 'ok', database: mongoDb?.databaseName, host: mongoose.connection.host };
  } catch (e) {
    health.mongodb = { status: 'error', error: e.message };
  }

  // PostgreSQL
  try {
    const client = await pgPool.connect();
    await client.query('SELECT 1');
    client.release();
    health.postgres = { status: 'ok', host: config.postgres.host, database: config.postgres.database };
  } catch (e) {
    health.postgres = { status: 'error', error: e.message };
  }

  // Redis
  try {
    const pong = await redisClient.ping();
    health.redis = { status: pong === 'PONG' ? 'ok' : 'error' };
  } catch (e) {
    health.redis = { status: 'error', error: e.message };
  }

  return health;
}

module.exports = { connectAll, healthCheck, getMongoDb, getPgPool, getRedisClient };
