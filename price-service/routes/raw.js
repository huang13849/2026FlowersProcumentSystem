import { Router } from 'express'
import crypto from 'crypto'
import { pool } from '../services/db.js'
import { cacheGet, cacheSet } from '../services/cache.js'

const router = Router()

function hash(obj) {
  return crypto.createHash('md5').update(JSON.stringify(obj)).digest('hex')
}

router.get('/', async (req, res) => {
  const {
    main_category, sub_category, flower_name, flower_level,
    province, city, website_id,
    date_from, date_to, keyword,
    page = '1', page_size = '20'
  } = req.query

  const pn = Math.max(1, parseInt(page))
  const ps = Math.min(200, Math.max(1, parseInt(page_size)))
  const offset = (pn - 1) * ps

  const params = []
  const w = []
  const $ = (v) => { params.push(v); return `$${params.length}` }

  if (main_category) w.push(`main_category = ${$(main_category)}`)
  if (sub_category) w.push(`sub_category = ${$(sub_category)}`)
  if (flower_name) w.push(`flower_name = ${$(flower_name)}`)
  if (flower_level) w.push(`flower_level = ${$(flower_level)}`)
  if (province) w.push(`province = ${$(province)}`)
  if (city) w.push(`city = ${$(city)}`)
  if (website_id) w.push(`website_id = ${$(Number(website_id))}`)
  if (date_from) w.push(`create_date >= ${$(date_from)}`)
  if (date_to) w.push(`create_date <= ${$(date_to)}`)
  if (keyword) {
    const p1 = $(`%${keyword}%`)
    const p2 = $(`%${keyword}%`)
    w.push(`(flower_name ILIKE ${p1} OR sub_category ILIKE ${p2})`)
  }

  const where = w.length ? 'WHERE ' + w.join(' AND ') : ''
  const ck = `raw:${hash(req.query)}`
  const cached = await cacheGet(ck)
  if (cached) return res.json({ cached: true, ...cached })

  try {
    const cols = `rawflower_id, shop_code, province, city,
      main_category, sub_category, flower_name, flower_code, flower_brand,
      origin_type, flower_pic, flower_level, flower_standard, flower_unit,
      pack_type, flower_weight, flower_volume, sale_type, stock_num,
      max_price, min_price, avg_price, service_fee,
      today_soldcount, month_soldcount, total_soldcount, repeat_customernum,
      description, create_date,
      website_id, website_name, shop_name, cleaning_result,
      crawler_url, main_id, sub_id, is_comment`

    const { rows: items } = await pool.query(
      `SELECT ${cols} FROM raw_flower_tb ${where} ORDER BY rawflower_id DESC LIMIT ${ps} OFFSET ${offset}`,
      params
    )

    // Fast approximate count from pg_class (no WHERE)
    let total = 0
    if (w.length === 0) {
      const { rows: [r] } = await pool.query(
        `SELECT reltuples::int AS n FROM pg_class WHERE relname='raw_flower_tb'`
      )
      total = r.n
    } else {
      // For filtered queries, use a fast indexed count via estimated plan
      const { rows: [{ n }] } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM raw_flower_tb ${where}`,
        params
      )
      total = n
    }

    const payload = { items, total, page: pn, page_size: ps }
    await cacheSet(ck, payload, 60)
    res.json({ cached: false, ...payload })
  } catch (e) {
    console.error('[raw error]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// meta data endpoints
router.get('/meta/main-categories', async (req, res) => {
  const ck = 'meta:raw:cats'
  const cached = await cacheGet(ck)
  if (cached) return res.json({ items: cached })
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT main_category AS name FROM raw_flower_tb WHERE main_category <> '' ORDER BY main_category`
    )
    await cacheSet(ck, rows, 1800)
    res.json({ items: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/meta/levels', async (req, res) => {
  const ck = 'meta:raw:levels'
  const cached = await cacheGet(ck)
  if (cached) return res.json({ items: cached })
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT flower_level AS name FROM raw_flower_tb WHERE flower_level IS NOT NULL AND flower_level <> '' ORDER BY flower_level`
    )
    await cacheSet(ck, rows, 1800)
    res.json({ items: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/meta/websites', async (req, res) => {
  const ck = 'meta:raw:sites'
  const cached = await cacheGet(ck)
  if (cached) return res.json({ items: cached })
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT website_id, website_name FROM raw_flower_tb WHERE website_name <> '' ORDER BY website_name`
    )
    await cacheSet(ck, rows, 1800)
    res.json({ items: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/meta/provinces', async (req, res) => {
  const ck = 'meta:raw:provs'
  const cached = await cacheGet(ck)
  if (cached) return res.json({ items: cached })
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT province AS name FROM raw_flower_tb WHERE province <> '' ORDER BY province`
    )
    await cacheSet(ck, rows, 1800)
    res.json({ items: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default router