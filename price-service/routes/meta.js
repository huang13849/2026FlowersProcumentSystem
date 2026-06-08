import { Router } from 'express'
import { pool } from '../services/db.js'
import { cacheGet, cacheSet, cacheStatus } from '../services/cache.js'

const router = Router()

// 元数据：网站、品类、等级、省份 — 长缓存（30 分钟）
router.get('/websites', async (req, res) => {
  const key = 'meta:websites:v1'
  const cached = await cacheGet(key)
  if (cached) return res.json({ cached: true, items: cached })
  try {
    const { rows } = await pool.query(`
      SELECT website_id, website_name
      FROM web_site_tb
      WHERE COALESCE(is_used,1)=1 AND website_name <> ''
      ORDER BY website_name
    `)
    await cacheSet(key, rows, 1800)
    res.json({ cached: false, items: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/categories', async (req, res) => {
  const key = 'meta:categories:v1'
  const cached = await cacheGet(key)
  if (cached) return res.json({ cached: true, items: cached })
  try {
    const { rows } = await pool.query(`
      SELECT flowercategory_id AS id, parent_id, category_name, flower_type
      FROM flower_category_tb
      WHERE COALESCE(is_used,1)=1 AND category_name <> ''
      ORDER BY parent_id, category_name
    `)
    await cacheSet(key, rows, 1800)
    res.json({ cached: false, items: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/main-categories', async (req, res) => {
  const key = 'meta:main_categories:v1'
  const cached = await cacheGet(key)
  if (cached) return res.json({ cached: true, items: cached })
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT main_category AS name
      FROM stat_prices_tb
      WHERE main_category <> ''
      ORDER BY main_category
    `)
    await cacheSet(key, rows, 1800)
    res.json({ cached: false, items: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/levels', async (req, res) => {
  const key = 'meta:levels:v1'
  const cached = await cacheGet(key)
  if (cached) return res.json({ cached: true, items: cached })
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT flower_level AS name
      FROM stat_prices_tb
      WHERE flower_level IS NOT NULL AND flower_level <> ''
      ORDER BY flower_level
    `)
    await cacheSet(key, rows, 1800)
    res.json({ cached: false, items: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/provinces', async (req, res) => {
  const key = 'meta:provinces:v1'
  const cached = await cacheGet(key)
  if (cached) return res.json({ cached: true, items: cached })
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT province AS name
      FROM stat_prices_tb
      WHERE province IS NOT NULL AND province <> ''
      ORDER BY province
    `)
    await cacheSet(key, rows, 1800)
    res.json({ cached: false, items: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/cache-status', async (req, res) => {
  res.json(await cacheStatus())
})

export default router
