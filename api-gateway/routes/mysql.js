/**
 * API Gateway - MySQL 路由（RPi8 mysql-master）
 */
const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');

async function getPool() {
  if (getPool._pool) return getPool._pool;
  getPool._pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '100.67.126.90',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '123456',
    waitForConnections: true,
    connectionLimit: 5,
  });
  return getPool._pool;
}

// 列出数据库
router.get('/databases', async (req, res) => {
  try {
    const pool = await getPool();
    const [rows] = await pool.query('SHOW DATABASES');
    res.json({ databases: rows.map(r => r.Database) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 列出表
router.get('/:database/tables', async (req, res) => {
  try {
    const pool = await getPool();
    const [rows] = await pool.query(`SHOW TABLES FROM \`${req.params.database}\``);
    res.json({ database: req.params.database, tables: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 查询
router.post('/:database/query', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.query(`USE \`${req.params.database}\``);
    const { sql, params = [] } = req.body;
    if (!sql) return res.status(400).json({ error: '需要 sql 参数' });
    // 只允许 SELECT 查询
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('SHOW') && !trimmed.startsWith('DESCRIBE') && !trimmed.startsWith('EXPLAIN')) {
      return res.status(403).json({ error: '只允许 SELECT/SHOW/DESCRIBE/EXPLAIN 查询' });
    }
    const [rows] = await pool.query(sql, params);
    res.json({ database: req.params.database, count: rows.length, data: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
