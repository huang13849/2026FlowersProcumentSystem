/**
 * API Gateway - PostgreSQL 路由
 * 统一 CRUD 接口，支持任意表的增删改查
 * 主从架构：RPi8 Primary (读写) + Mac Mini Standby (只读)
 * 读取操作支持 ?readFrom=standby 路由到从库
 */
const express = require('express');
const router = express.Router();
const { getPgPool, getPgStandbyPool, getPgStandbyPools } = require('../services/connections');

// 选择读库:
//   ?readFrom=primary    强制走 primary (RPi8)
//   ?readFrom=standby    强制走某个 standby (副本挂了则走 primary 兜底)
//   默认(什么都不传)     读走 standby, 副本挂了则 primary 兜底
// 写操作(pg-put/post/delete)另有独立 primary getter, 不走这里
function getReadPool(readFrom) {
  if (readFrom === 'primary') {
    return { pool: getPgPool(), role: 'primary' };
  }
  // default + explicit standby -> try standby first
  const standby = getPgStandbyPool();
  if (standby) return { pool: standby, role: 'standby' };
  // fallback
  return { pool: getPgPool(), role: 'primary-fallback' };
}

// ===== 复制状态监控 =====
router.get('/replication', async (req, res) => {
  try {
    const pool = getPgPool();
    const primaryResult = await pool.query(`
      SELECT
        pg_is_in_recovery() as in_recovery,
        (SELECT pg_is_in_recovery()) = false as is_primary,
        pg_current_wal_lsn() as current_wal_lsn,
        (SELECT count(*) FROM pg_stat_replication) as standby_count
    `);

    let replicationStats = [];
    try {
      const replResult = await pool.query(`
        SELECT
          pid, usename, application_name, client_addr,
          state, sync_state,
          sent_lsn, write_lsn, flush_lsn, replay_lsn,
          write_lag, flush_lag, replay_lag
        FROM pg_stat_replication
      `);
      replicationStats = replResult.rows;
    } catch (e) { /* ignore */ }

    let standbyInfo = null;
    const standby = getPgStandbyPool();
    if (standby) {
      try {
        const sResult = await standby.query(`
          SELECT
            pg_is_in_recovery() as in_recovery,
            pg_last_wal_receive_lsn() as receive_lsn,
            pg_last_wal_replay_lsn() as replay_lsn,
            (SELECT status FROM pg_stat_wal_receiver LIMIT 1) as wal_receiver_status,
            (SELECT sender_host FROM pg_stat_wal_receiver LIMIT 1) as sender_host,
            (SELECT slot_name FROM pg_stat_wal_receiver LIMIT 1) as slot_name
        `);
        standbyInfo = sResult.rows[0];
      } catch (e) {
        standbyInfo = { error: e.message };
      }
    }

    res.json({
      primary: {
        host: process.env.PG_HOST || '100.67.126.90',
        ...primaryResult.rows[0],
        replication: replicationStats,
      },
      standby: standby
        ? { host: process.env.PG_STANDBY_HOST || '100.76.15.64', ...standbyInfo }
        : { status: 'disabled' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 列出所有数据库 =====
router.get('/databases', async (req, res) => {
  try {
    const { pool, role } = getReadPool(req.query.readFrom);
    const result = await pool.query(
      "SELECT datname, pg_size_pretty(pg_database_size(datname)) as size FROM pg_database WHERE datistemplate = false ORDER BY datname"
    );
    res.json({ databases: result.rows, readFrom: role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 列出表 =====
router.get('/:database/tables', async (req, res) => {
  try {
    const { database } = req.params;
    const { readFrom } = req.query;
    const { Pool } = require('pg');
    const host = readFrom === 'standby' ? (process.env.PG_STANDBY_HOST || '100.76.15.64') : (process.env.PG_HOST || '100.67.126.90');
    const pool = new Pool({
      host,
      port: 5432,
      database,
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || '',
    });
    const result = await pool.query(
      "SELECT tablename, schemaname FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY tablename"
    );
    await pool.end();
    res.json({ database, tables: result.rows, readFrom: readFrom === 'standby' ? 'standby' : 'primary' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 原生 SQL 查询（仅 SELECT）=====
router.post('/:database/query', async (req, res) => {
  try {
    const { database } = req.params;
    const { sql, params = [], readFrom } = req.body;

    const normalized = sql.trim().toUpperCase();
    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
      return res.status(403).json({ error: '仅允许 SELECT 查询' });
    }
    if (/INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE/i.test(normalized)) {
      return res.status(403).json({ error: '禁止修改操作，请使用对应的 CRUD 接口' });
    }

    const { Pool } = require('pg');
    const host = readFrom === 'standby' ? (process.env.PG_STANDBY_HOST || '100.76.15.64') : (process.env.PG_HOST || '100.67.126.90');
    const pool = new Pool({
      host,
      port: 5432,
      database,
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || '',
    });

    const result = await pool.query(sql, params);
    await pool.end();
    res.json({ database, count: result.rows.length, data: result.rows, readFrom: readFrom === 'standby' ? 'standby' : 'primary' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ===== 查询表数据（支持过滤/分页/排序）=====
router.get('/:database/:table', async (req, res) => {
  try {
    const { database, table } = req.params;
    const {
      filter = '{}',
      sort = '',
      fields = '*',
      page = 1,
      limit = 50,
      countOnly,
      readFrom,
    } = req.query;

    const { Pool } = require('pg');
    const host = readFrom === 'standby' ? (process.env.PG_STANDBY_HOST || '100.76.15.64') : (process.env.PG_HOST || '100.67.126.90');
    const pool = new Pool({
      host,
      port: 5432,
      database,
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || '',
    });

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      await pool.end();
      return res.status(400).json({ error: '无效的表名' });
    }

    if (countOnly === 'true') {
      const result = await pool.query(`SELECT COUNT(*) as total FROM "${table}"`);
      await pool.end();
      return res.json({ database, table, total: parseInt(result.rows[0].total), readFrom: readFrom === 'standby' ? 'standby' : 'primary' });
    }

    const filters = JSON.parse(filter);
    const whereClauses = [];
    const values = [];
    let paramIdx = 1;
    for (const [key, val] of Object.entries(filters)) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue;
      if (val === null) {
        whereClauses.push(`"${key}" IS NULL`);
      } else if (typeof val === 'object' && val.$like) {
        whereClauses.push(`"${key}" LIKE $${paramIdx++}`);
        values.push(val.$like);
      } else if (typeof val === 'object' && val.$gte !== undefined) {
        whereClauses.push(`"${key}" >= $${paramIdx++}`);
        values.push(val.$gte);
        if (val.$lte !== undefined) {
          whereClauses.push(`"${key}" <= $${paramIdx++}`);
          values.push(val.$lte);
        }
      } else {
        whereClauses.push(`"${key}" = $${paramIdx++}`);
        values.push(val);
      }
    }
    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    let orderBy = '';
    if (sort) {
      const sortParts = sort.split(',').map(s => {
        const desc = s.startsWith('-');
        const col = desc ? s.slice(1) : s;
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) return null;
        return `"${col}" ${desc ? 'DESC' : 'ASC'}`;
      }).filter(Boolean);
      if (sortParts.length > 0) orderBy = `ORDER BY ${sortParts.join(', ')}`;
    }

    const fieldList = fields === '*' ? '*' : fields.split(',').map(f => {
      const trimmed = f.trim();
      return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed) ? `"${trimmed}"` : null;
    }).filter(Boolean).join(', ') || '*';

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const countResult = await pool.query(`SELECT COUNT(*) as total FROM "${table}" ${where}`, values);
    const total = parseInt(countResult.rows[0].total);

    const result = await pool.query(
      `SELECT ${fieldList} FROM "${table}" ${where} ${orderBy} LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, parseInt(limit), offset]
    );

    await pool.end();
    res.json({
      database,
      table,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      data: result.rows,
      readFrom: readFrom === 'standby' ? 'standby' : 'primary',
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== 查询单行 =====
router.get('/:database/:table/:id', async (req, res) => {
  try {
    const { database, table, id } = req.params;
    const { readFrom } = req.query;
    const { Pool } = require('pg');
    const host = readFrom === 'standby' ? (process.env.PG_STANDBY_HOST || '100.76.15.64') : (process.env.PG_HOST || '100.67.126.90');
    const pool = new Pool({
      host,
      port: 5432,
      database,
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || '',
    });

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      await pool.end();
      return res.status(400).json({ error: '无效的表名' });
    }

    const result = await pool.query(`SELECT * FROM "${table}" WHERE id = $1`, [id]);
    await pool.end();
    if (result.rows.length === 0) return res.status(404).json({ error: '记录不存在' });
    res.json({ database, table, data: result.rows[0], readFrom: readFrom === 'standby' ? 'standby' : 'primary' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== 插入行 (写→Primary) =====
router.post('/:database/:table', async (req, res) => {
  try {
    const { database, table } = req.params;
    const data = req.body;
    const { Pool } = require('pg');
    const pool = new Pool({
      host: process.env.PG_HOST || '100.67.126.90',
      port: 5432,
      database,
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || '',
    });

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      await pool.end();
      return res.status(400).json({ error: '无效的表名' });
    }

    const columns = Object.keys(data).filter(k => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k));
    const values = columns.map(c => data[c]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const colNames = columns.map(c => `"${c}"`).join(', ');

    const result = await pool.query(
      `INSERT INTO "${table}" (${colNames}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    await pool.end();
    res.status(201).json({ database, table, data: result.rows[0], writtenTo: 'primary' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== 更新行 (写→Primary) =====
router.put('/:database/:table/:id', async (req, res) => {
  try {
    const { database, table, id } = req.params;
    const data = req.body;
    const { Pool } = require('pg');
    const pool = new Pool({
      host: process.env.PG_HOST || '100.67.126.90',
      port: 5432,
      database,
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || '',
    });

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      await pool.end();
      return res.status(400).json({ error: '无效的表名' });
    }

    const columns = Object.keys(data).filter(k => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k));
    const setClauses = columns.map((c, i) => `"${c}" = $${i + 1}`);
    const values = columns.map(c => data[c]);

    const result = await pool.query(
      `UPDATE "${table}" SET ${setClauses.join(', ')} WHERE id = $${columns.length + 1} RETURNING *`,
      [...values, id]
    );
    await pool.end();
    if (result.rows.length === 0) return res.status(404).json({ error: '记录不存在' });
    res.json({ database, table, data: result.rows[0], writtenTo: 'primary' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== 删除行 (写→Primary) =====
router.delete('/:database/:table/:id', async (req, res) => {
  try {
    const { database, table, id } = req.params;
    const { Pool } = require('pg');
    const pool = new Pool({
      host: process.env.PG_HOST || '100.67.126.90',
      port: 5432,
      database,
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || '',
    });

    const result = await pool.query(`DELETE FROM "${table}" WHERE id = $1 RETURNING *`, [id]);
    await pool.end();
    if (result.rows.length === 0) return res.status(404).json({ error: '记录不存在' });
    res.json({ database, table, deleted: true, data: result.rows[0], writtenTo: 'primary' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
