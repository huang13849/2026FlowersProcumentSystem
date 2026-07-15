
/**
 * 统一标签池 - plant_collector.tags
 * 商品/用户/供应商共用
 */
const express = require('express');
const router = express.Router();
const { getPgPool } = require('../services/connections');

// GET /api/tags?scope=product|user|supplier   —— 列表（可按 scope 过滤）
router.get('/', async (req, res) => {
  try {
    const scope = req.query.scope;
    const pool = getPgPool();
    let r;
    if (scope) {
      r = await pool.query(
        `SELECT name, color, bg, border, scope, usage_count, created_at
           FROM plant_collector.tags
          WHERE $1 = ANY(scope)
          ORDER BY name`, [scope]
      );
    } else {
      r = await pool.query(
        `SELECT name, color, bg, border, scope, usage_count, created_at
           FROM plant_collector.tags ORDER BY name`
      );
    }
    res.json({ success: true, count: r.rowCount, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tags   { name, color?, bg?, border?, scope? }
router.post('/', async (req, res) => {
  const { name, color, bg, border, scope } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'name required' });
  try {
    const pool = getPgPool();
    const r = await pool.query(
      `INSERT INTO plant_collector.tags (name, color, bg, border, scope)
       VALUES ($1, COALESCE($2,'#555'), COALESCE($3,'#f5f5f5'), COALESCE($4,'#d9d9d9'), COALESCE($5, ARRAY['product','user','supplier']::TEXT[]))
       ON CONFLICT (name) DO UPDATE SET color=EXCLUDED.color, bg=EXCLUDED.bg, border=EXCLUDED.border, scope=EXCLUDED.scope
       RETURNING *`,
      [name.trim(), color, bg, border, scope]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/tags/:name  —— 删除标签 + 从所有实体 tags 数组中清除
router.delete('/:name', async (req, res) => {
  const name = req.params.name;
  try {
    const pool = getPgPool();
    // 从 user_profiles.tags 中移除
    await pool.query(`UPDATE plant_collector.user_profiles SET tags = array_remove(tags, $1) WHERE $1 = ANY(tags)`, [name]);
    // 从 flower_internet_supplier.tags 中移除
    await pool.query(`UPDATE public.flower_internet_supplier SET tags = (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements_text(tags) x WHERE x <> $1) WHERE tags @> to_jsonb(ARRAY[$1]::text[])`, [name]);
    await pool.query(`UPDATE plant_collector.suppliers SET tags = (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements_text(tags) x WHERE x <> $1) WHERE tags @> to_jsonb(ARRAY[$1]::text[])`, [name]);
    // 删除标签
    const r = await pool.query(`DELETE FROM plant_collector.tags WHERE name = $1`, [name]);
    // TODO: 同步清 Mongo product.sceneTags —— 由 product-service 提供 hook 或此处 axios 调用
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tags/apply  —— 批量打标签（多实体通用）
// body: { entity: 'user'|'supplier', ids: [...], tags: [...], mode: 'add'|'remove'|'set' }
router.post('/apply', async (req, res) => {
  const { entity, ids, tags, mode } = req.body || {};
  if (!entity || !Array.isArray(ids) || !ids.length || !Array.isArray(tags)) {
    return res.status(400).json({ success: false, error: 'entity, ids[], tags[] required' });
  }
  try {
    const pool = getPgPool();
    let sql;
    if (entity === 'user') {
      // user_profiles.tags is text[]
      if (mode === 'remove') {
        sql = `UPDATE plant_collector.user_profiles SET tags = COALESCE(tags,'{}'::text[]) - $1::text[] WHERE zid = ANY($2::text[])`;
      } else if (mode === 'set') {
        sql = `UPDATE plant_collector.user_profiles SET tags = $1::text[] WHERE zid = ANY($2::text[])`;
      } else {
        sql = `UPDATE plant_collector.user_profiles SET tags = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(tags,'{}'::text[]) || $1::text[]))) WHERE zid = ANY($2::text[])`;
      }
    } else if (entity === 'supplier') {
      // plant_collector.suppliers.tags is JSONB, keyed by mongo_id
      if (mode === 'remove') {
        sql = `UPDATE plant_collector.suppliers
                 SET tags = (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(tags,'[]'::jsonb)) x WHERE NOT (x = ANY($1::text[]))),
                     updated_at = NOW()
               WHERE mongo_id = ANY($2::text[])`;
      } else if (mode === 'set') {
        sql = `UPDATE plant_collector.suppliers
                 SET tags = to_jsonb($1::text[]), updated_at = NOW()
               WHERE mongo_id = ANY($2::text[])`;
      } else {
        sql = `UPDATE plant_collector.suppliers
                 SET tags = (SELECT jsonb_agg(DISTINCT x) FROM (
                       SELECT jsonb_array_elements_text(COALESCE(tags,'[]'::jsonb)) AS x
                       UNION SELECT unnest($1::text[]) AS x) u),
                     updated_at = NOW()
               WHERE mongo_id = ANY($2::text[])`;
      }
    } else if (entity === 'internet_supplier') {
      // legacy flower_internet_supplier (kept for compat)
      if (mode === 'remove') {
        sql = `UPDATE public.flower_internet_supplier SET tags = (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(tags,'[]'::jsonb)) x WHERE NOT (x = ANY($1::text[]))) WHERE siteshop_id = ANY($2::int[])`;
      } else if (mode === 'set') {
        sql = `UPDATE public.flower_internet_supplier SET tags = to_jsonb($1::text[]) WHERE siteshop_id = ANY($2::int[])`;
      } else {
        sql = `UPDATE public.flower_internet_supplier SET tags = (SELECT jsonb_agg(DISTINCT x) FROM (SELECT jsonb_array_elements_text(COALESCE(tags,'[]'::jsonb)) AS x UNION SELECT unnest($1::text[]) AS x) u) WHERE siteshop_id = ANY($2::int[])`;
      }
    } else {
      return res.status(400).json({ success: false, error: 'entity must be user|supplier' });
    }
    const idsCast = (entity === 'user' || entity === 'supplier') ? ids.map(String) : ids.map(x => parseInt(x, 10)).filter(n => !isNaN(n));
    const r = await pool.query(sql, [tags, idsCast]);
    res.json({ success: true, updated: r.rowCount });
  } catch (err) {
    console.error('[tags/apply]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
