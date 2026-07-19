process.env.MONGO_URI/**
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URIconst mongoose = require('mongoose');
process.env.MONGO_URIconst { Pool } = require('pg');
process.env.MONGO_URIconst redis = require('redis');
process.env.MONGO_URIconst { Client: MinioClient } = require('minio');
process.env.MONGO_URI
process.env.MONGO_URI// ===== 连接配置 =====
process.env.MONGO_URIconst config = {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI};
process.env.MONGO_URI
process.env.MONGO_URI// ===== MongoDB =====
process.env.MONGO_URIlet mongoDb = null;
process.env.MONGO_URI
process.env.MONGO_URIasync function connectMongo() {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URIfunction getMongoDb() {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URI// ===== PostgreSQL Primary (RPi8) =====
process.env.MONGO_URIlet pgPool = null;
process.env.MONGO_URI
process.env.MONGO_URIasync function connectPostgres() {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URIfunction getPgPool() {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URI// ===== PostgreSQL Standby(s) - 读副本池,支持多副本round-robin =====
process.env.MONGO_URI// pgStandbyPools: [{ pool, host, port, healthy }]
process.env.MONGO_URIlet pgStandbyPools = [];
process.env.MONGO_URIlet pgStandbyRR = 0;
process.env.MONGO_URI
process.env.MONGO_URIasync function connectPostgresStandby() {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URI// 兼容旧代码:返回当前 RR 选中的健康副本 pool(单值)
process.env.MONGO_URIfunction getPgStandbyPool() {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URI// 新接口:返回所有健康副本(供 /replication 端点展示)
process.env.MONGO_URIfunction getPgStandbyPools() {
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URI// ===== PostgreSQL Zitadel (RPi8, read-only aggregation) =====
process.env.MONGO_URIlet zitadelPgPool = null;
process.env.MONGO_URI
process.env.MONGO_URIasync function connectZitadelPg() {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URIfunction getZitadelPgPool() {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI// ===== Redis =====
process.env.MONGO_URIlet redisClient = null;
process.env.MONGO_URI
process.env.MONGO_URIasync function connectRedis() {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URIfunction getRedisClient() {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URI// ===== MinIO =====
process.env.MONGO_URIlet minioClient = null;
process.env.MONGO_URI
process.env.MONGO_URIasync function connectMinio() {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URIfunction getMinioClient() {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URIfunction getMinioBucket() {
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URIfunction getMinioPublicUrl() {
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URI// ===== 连接全部 =====
process.env.MONGO_URIasync function connectAll() {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URI// ===== 健康检查 =====
process.env.MONGO_URIasync function healthCheck() {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI}
process.env.MONGO_URI
process.env.MONGO_URImodule.exports = {
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI
process.env.MONGO_URI};
