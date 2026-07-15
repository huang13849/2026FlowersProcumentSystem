
/**
 * 统一标签池 - plant_collector.tags  (共享 service)
 * 支持 scope: product | user | supplier
 * usage_count 实时计算：
 *   - product  → Mongo db.products.countDocuments({sceneTags: name})
 *   - user     → PG plant_collector.user_profiles ($1 = ANY(tags))
 *   - supplier → PG public.suppliers (tags @> jsonb_array)
 */
const express = require('express');
const router = express.Router();
const { getPgPool } = require('../services/connections');
const productApi = require('../services/productApiClient');

async function computeUsage(name, scope) {
  const pool = getPgPool();
  const result = { product: 0, user: 0, supplier: 0 };
  const scopes = Array.isArray(scope) ? scope : (scope ? [scope] : ['product', 'user', 'supplier']);
  try {
    if (scopes.includes('product')) {
      result.product = await productApi.countBySceneTag(name);
    }
  } catch (e) { console.warn('[tags] countBySceneTag failed:', e.message); }
  try {
    if (scopes.includes('user')) {
      const r = await pool.query(`SELECT COUNT(*)::int AS c FROM plant_collector.user_profiles WHERE $1 = ANY(tags)`, [name]);
      result.user = r.rows[0].c;
    }
  } catch {}
  try {
    if (scopes.includes('supplier')) {
      const r = await pool.query(`SELECT COUNT(*)::int AS c FROM public.suppliers WHERE tags @> to_jsonb(ARRAY[$1]::text[])`, [name]);
      result.supplier = r.rows[0].c;
    }
  } catch {}
  return result;
}

// GET /api/tags?scope=product|user|supplier
router.get('/', async (req, res) => {
  try {
    const scope = req.query.scope;
    const pool = getPgPool();
    let r;
    if (scope) {
      r = await pool.query(
        `SELECT name, color, bg, border, scope, created_at
           FROM plant_collector.tags
          WHERE $1 = ANY(scope)
          ORDER BY name`, [scope]
      );
    } else {
      r = await pool.query(
        `SELECT name, color, bg, border, scope, created_at
           FROM plant_collector.tags ORDER BY name`
      );
    }
    // 实时算 usage_count
    const rows = await Promise.all(r.rows.map(async (t) => {
      const u = await computeUsage(t.name, scope || t.scope);
      const uc = scope ? (u[scope] || 0) : (u.product + u.user + u.supplier);
      return { ...t, usage_count: uc, usage_breakdown: u };
    }));
    res.json({ success: true, count: rows.length, data: rows });
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
    const scopeVal = Array.isArray(scope) ? scope : (scope ? [scope] : ['product', 'user', 'supplier']);
    const r = await pool.query(
      `INSERT INTO plant_collector.tags (name, color, bg, border, scope)
       VALUES ($1, COALESCE($2,'#555'), COALESCE($3,'#f5f5f5'), COALESCE($4,'#d9d9d9'), $5::TEXT[])
       ON CONFLICT (name) DO UPDATE SET
         color = COALESCE(EXCLUDED.color, plant_collector.tags.color),
         bg    = COALESCE(EXCLUDED.bg,    plant_collector.tags.bg),
         border= COALESCE(EXCLUDED.border,plant_collector.tags.border),
         scope = (SELECT ARRAY(SELECT DISTINCT unnest(plant_collector.tags.scope || EXCLUDED.scope)))
       RETURNING *`,
      [name.trim(), color, bg, border, scopeVal]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/tags/:name
router.delete('/:name', async (req, res) => {
  const name = req.params.name;
  try {
    const pool = getPgPool();
    // 从 PG 三处剥离
    await pool.query(`UPDATE plant_collector.user_profiles SET tags = array_remove(tags, $1) WHERE $1 = ANY(tags)`, [name]);
    await pool.query(`UPDATE public.flower_internet_supplier SET tags = (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements_text(tags) x WHERE x <> $1) WHERE tags @> to_jsonb(ARRAY[$1]::text[])`, [name]);
    await pool.query(`UPDATE public.suppliers SET tags = (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements_text(tags) x WHERE x <> $1) WHERE tags @> to_jsonb(ARRAY[$1]::text[])`, [name]);
    // 从商品 sceneTags 剥离（通过 product-api-service）
    try {
      await productApi.detachTagFromAll(name);
    } catch (e) { console.warn('[tags] detachTagFromAll failed:', e.message); }
    // 删除标签
    const r = await pool.query(`DELETE FROM plant_collector.tags WHERE name = $1`, [name]);
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tags/apply  entity: user | supplier | internet_supplier | product
router.post('/apply', async (req, res) => {
  const { entity, ids, tags, mode } = req.body || {};
  if (!entity || !Array.isArray(ids) || !ids.length || !Array.isArray(tags)) {
    return res.status(400).json({ success: false, error: 'entity, ids[], tags[] required' });
  }
  try {
    const pool = getPgPool();
    // Product 走 product-api-service
    if (entity === 'product') {
      try {
        const r = await productApi.applySceneTags({ ids: ids.map(String), tags, mode });
        return res.json({ success: true, updated: r.updated });
      } catch (e) {
        return res.status(e.status || 500).json({ success: false, error: e.message });
      }
    }
    let sql;
    if (entity === 'user') {
      if (mode === 'remove') {
        sql = `UPDATE plant_collector.user_profiles SET tags = COALESCE(tags,'{}'::text[]) - $1::text[] WHERE zid = ANY($2::text[])`;
      } else if (mode === 'set') {
        sql = `UPDATE plant_collector.user_profiles SET tags = $1::text[] WHERE zid = ANY($2::text[])`;
      } else {
        sql = `UPDATE plant_collector.user_profiles SET tags = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(tags,'{}'::text[]) || $1::text[]))) WHERE zid = ANY($2::text[])`;
      }
    } else if (entity === 'supplier') {
      if (mode === 'remove') {
        sql = `UPDATE public.suppliers
                 SET tags = (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(tags,'[]'::jsonb)) x WHERE NOT (x = ANY($1::text[]))),
                     updated_at = NOW()
               WHERE mongo_id = ANY($2::text[])`;
      } else if (mode === 'set') {
        sql = `UPDATE public.suppliers
                 SET tags = to_jsonb($1::text[]), updated_at = NOW()
               WHERE mongo_id = ANY($2::text[])`;
      } else {
        sql = `UPDATE public.suppliers
                 SET tags = (SELECT jsonb_agg(DISTINCT x) FROM (
                       SELECT jsonb_array_elements_text(COALESCE(tags,'[]'::jsonb)) AS x
                       UNION SELECT unnest($1::text[]) AS x) u),
                     updated_at = NOW()
               WHERE mongo_id = ANY($2::text[])`;
      }
    } else if (entity === 'internet_supplier') {
      if (mode === 'remove') {
        sql = `UPDATE public.flower_internet_supplier SET tags = (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(tags,'[]'::jsonb)) x WHERE NOT (x = ANY($1::text[]))) WHERE siteshop_id = ANY($2::int[])`;
      } else if (mode === 'set') {
        sql = `UPDATE public.flower_internet_supplier SET tags = to_jsonb($1::text[]) WHERE siteshop_id = ANY($2::int[])`;
      } else {
        sql = `UPDATE public.flower_internet_supplier SET tags = (SELECT jsonb_agg(DISTINCT x) FROM (SELECT jsonb_array_elements_text(COALESCE(tags,'[]'::jsonb)) AS x UNION SELECT unnest($1::text[]) AS x) u) WHERE siteshop_id = ANY($2::int[])`;
      }
    } else {
      return res.status(400).json({ success: false, error: 'entity must be user|supplier|product|internet_supplier' });
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
