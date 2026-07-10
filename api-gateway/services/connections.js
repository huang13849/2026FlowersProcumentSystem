/**
 * API Gateway - 统一数据库连接管理
 * MongoDB Replica Set / PostgreSQL Primary+Standby / Redis + Sentinel / MinIO
 */
const mongoose = require('mongoose');
const { Pool } = require('pg');
const redis = require('redis');
const { Client: MinioClient } = require('minio');

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
  pgStandby: {
    host: process.env.PG_STANDBY_HOST || '100.76.15.64',
    port: process.env.PG_STANDBY_PORT || 5432,
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || undefined,
    database: process.env.PG_DATABASE || 'postgres',
    max: 5,
    idleTimeoutMillis: 30000,
  },
  zitadelPg: {
    host: process.env.ZITADEL_PG_HOST || '100.67.126.90',
    port: parseInt(process.env.ZITADEL_PG_PORT || '5432'),
    user: process.env.ZITADEL_PG_USER || 'zitadel',
    password: process.env.ZITADEL_PG_PASSWORD || undefined,
    database: process.env.ZITADEL_PG_DATABASE || 'zitadel',
    max: 5,
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
  minio: {
    endPoint: (process.env.MINIO_ENDPOINT || '100.96.54.109:9000').split(':')[0],
    port: parseInt((process.env.MINIO_ENDPOINT || '100.96.54.109:9000').split(':')[1] || '9000'),
    useSSL: (process.env.MINIO_ENDPOINT || '').startsWith('https'),
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket: process.env.MINIO_BUCKET || 'supply-chain',
    publicUrl: process.env.MINIO_PUBLIC_URL || 'http://100.96.54.109:9000',
  },
};

// ===== MongoDB =====
let mongoDb = null;

async function connectMongo() {
  if (mongoDb) return mongoDb;
  try {
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    mongoDb = mongoose.connection.db;
    console.log('✅ MongoDB connected: ' + mongoose.connection.host + ' / ' + mongoDb.databaseName);
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

// ===== PostgreSQL Primary (RPi8) =====
let pgPool = null;

async function connectPostgres() {
  if (pgPool) return pgPool;
  pgPool = new Pool(config.postgres);
  const client = await pgPool.connect();
  console.log('✅ PostgreSQL Primary connected: ' + config.postgres.host + ':' + config.postgres.port + '/' + config.postgres.database);
  client.release();
  return pgPool;
}

function getPgPool() {
  if (!pgPool) throw new Error('PostgreSQL not connected');
  return pgPool;
}

// ===== PostgreSQL Standby (Mac Mini) =====
let pgStandbyPool = null;

async function connectPostgresStandby() {
  if (pgStandbyPool) return pgStandbyPool;
  try {
    pgStandbyPool = new Pool(config.pgStandby);
    const client = await pgStandbyPool.connect();
    console.log('✅ PostgreSQL Standby connected: ' + config.pgStandby.host + ':' + config.pgStandby.port + '/' + config.pgStandby.database);
    client.release();
    return pgStandbyPool;
  } catch (err) {
    console.warn('⚠️  PostgreSQL Standby connection failed:', err.message);
    return null;
  }
}

function getPgStandbyPool() {
  return pgStandbyPool;
}

// ===== PostgreSQL Zitadel (RPi8, read-only aggregation) =====
let zitadelPgPool = null;

async function connectZitadelPg() {
  if (zitadelPgPool) return zitadelPgPool;
  try {
    zitadelPgPool = new Pool(config.zitadelPg);
    const client = await zitadelPgPool.connect();
    console.log('✅ PostgreSQL Zitadel connected: ' + config.zitadelPg.host + ':' + config.zitadelPg.port + '/' + config.zitadelPg.database);
    client.release();
    return zitadelPgPool;
  } catch (err) {
    console.warn('⚠️  PostgreSQL Zitadel connection failed:', err.message);
    zitadelPgPool = null;
    return null;
  }
}

function getZitadelPgPool() {
  if (!zitadelPgPool) throw new Error('Zitadel PostgreSQL not connected');
  return zitadelPgPool;
}


// ===== Redis =====
let redisClient = null;

async function connectRedis() {
  if (redisClient) return redisClient;
  try {
    const sentinelHost = config.redis.sentinel[0];
    const sentinelClient = redis.createClient({ socket: { host: sentinelHost.host, port: sentinelHost.port } });
    await sentinelClient.connect();
    const masterInfo = await sentinelClient.sendCommand(['SENTINEL', 'get-master-addr-by-name', config.redis.name]);
    await sentinelClient.disconnect();

    if (masterInfo && masterInfo.length >= 2) {
      console.log('✅ Redis Sentinel resolved master, connecting direct: ' + (process.env.REDIS_HOST || '100.96.54.109') + ':6379');
      redisClient = redis.createClient({
        socket: { host: process.env.REDIS_HOST || '100.96.54.109', port: 6379 },
        password: config.redis.password,
        database: config.redis.db,
      });
    } else {
      throw new Error('Sentinel returned no master');
    }
  } catch (err) {
    console.log('⚠️  Sentinel fallback, direct connect: ' + config.redis.sentinel[0].host + ':6379');
    redisClient = redis.createClient({
      socket: { host: config.redis.sentinel[0].host, port: 6379 },
      password: config.redis.password,
      database: config.redis.db,
    });
  }
  await redisClient.connect();
  console.log('✅ Redis connected');
  return redisClient;
}

function getRedisClient() {
  if (!redisClient) throw new Error('Redis not connected');
  return redisClient;
}

// ===== MinIO =====
let minioClient = null;

async function connectMinio() {
  if (minioClient) return minioClient;
  minioClient = new MinioClient({
    endPoint: config.minio.endPoint,
    port: config.minio.port,
    useSSL: config.minio.useSSL,
    accessKey: config.minio.accessKey,
    secretKey: config.minio.secretKey,
  });

  // 确保 bucket 存在
  try {
    const exists = await minioClient.bucketExists(config.minio.bucket);
    if (!exists) {
      await minioClient.makeBucket(config.minio.bucket);
      console.log('📦 MinIO bucket created: ' + config.minio.bucket);
    }
  } catch (err) {
    console.warn('⚠️  MinIO bucket check failed:', err.message);
  }

  console.log('✅ MinIO connected: ' + config.minio.endPoint + ':' + config.minio.port + ' bucket=' + config.minio.bucket);
  return minioClient;
}

function getMinioClient() {
  if (!minioClient) throw new Error('MinIO not connected');
  return minioClient;
}

function getMinioBucket() {
  return config.minio.bucket;
}

function getMinioPublicUrl() {
  return config.minio.publicUrl;
}

// ===== 连接全部 =====
async function connectAll() {
  const results = {};
  try { results.mongodb = await connectMongo(); } catch (e) { results.mongodbError = e.message; }
  try { results.postgres = await connectPostgres(); } catch (e) { results.postgresError = e.message; }
  try { results.pgStandby = await connectPostgresStandby(); } catch (e) { results.pgStandbyError = e.message; }
  try { results.zitadelPg = await connectZitadelPg(); } catch (e) { results.zitadelPgError = e.message; }
  try { results.redis = await connectRedis(); } catch (e) { results.redisError = e.message; }
  try { results.minio = await connectMinio(); } catch (e) { results.minioError = e.message; }
  return results;
}

// ===== 健康检查 =====
async function healthCheck() {
  const health = { timestamp: new Date().toISOString() };

  try {
    const adminDb = mongoose.connection.db.admin();
    await adminDb.ping();
    health.mongodb = { status: 'ok', database: mongoDb?.databaseName, host: mongoose.connection.host };
  } catch (e) {
    health.mongodb = { status: 'error', error: e.message };
  }

  try {
    const client = await pgPool.connect();
    await client.query('SELECT 1');
    client.release();
    health.postgres = { status: 'ok', host: config.postgres.host, database: config.postgres.database, role: 'primary' };
  } catch (e) {
    health.postgres = { status: 'error', error: e.message };
  }

  try {
    if (pgStandbyPool) {
      const sClient = await pgStandbyPool.connect();
      const replResult = await sClient.query('SELECT pg_is_in_recovery(), pg_last_wal_receive_lsn() as receive_lsn, pg_last_wal_replay_lsn() as replay_lsn');
      sClient.release();
      const row = replResult.rows[0];
      health.pgStandby = {
        status: 'ok',
        host: config.pgStandby.host,
        database: config.pgStandby.database,
        role: row.pg_is_in_recovery ? 'standby' : 'primary',
        receiveLsn: row.receive_lsn,
        replayLsn: row.replay_lsn,
      };
    } else {
      health.pgStandby = { status: 'disabled' };
    }
  } catch (e) {
    health.pgStandby = { status: 'error', error: e.message };
  }

  try {
    const pong = await redisClient.ping();
    health.redis = { status: pong === 'PONG' ? 'ok' : 'error' };
  } catch (e) {
    health.redis = { status: 'error', error: e.message };
  }

  try {
    const exists = await minioClient.bucketExists(config.minio.bucket);
    health.minio = { status: exists ? 'ok' : 'error', bucket: config.minio.bucket, endpoint: config.minio.endPoint + ':' + config.minio.port };
  } catch (e) {
    health.minio = { status: 'error', error: e.message };
  }

  return health;
}

module.exports = {
  connectAll, healthCheck,
  getMongoDb, getPgPool, getPgStandbyPool, getZitadelPgPool, getRedisClient,
  getMinioClient, getMinioBucket, getMinioPublicUrl,
};
