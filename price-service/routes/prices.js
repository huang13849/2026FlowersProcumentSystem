import { Router } from 'express'
import crypto from 'crypto'
import { pool } from '../services/db.js'
import { cacheGet, cacheSet } from '../services/cache.js'

const router = Router()

function hashKey(obj) {
  return crypto.createHash('md5').update(JSON.stringify(obj)).digest('hex')
}

router.get('/', async (req, res) => {
  const {
    website_id, main_category, sub_category, flower_level,
    province, city, date_from, date_to, keyword,
    page = '1', page_size = '50',
    sort_field = 'create_date', sort_order = 'desc',
  } = req.query

  const pageNum = Math.max(1, parseInt(page))
  const pageSize = Math.min(200, Math.max(1, parseInt(page_size)))
  const offset = (pageNum - 1) * pageSize

  const params = []
  const wheres = []
  const push = (val) => { params.push(val); return `$${params.length}` }

  if (website_id) wheres.push(`website_id = ${push(Number(website_id))}`)
  if (main_category) wheres.push(`main_category = ${push(main_category)}`)
  if (sub_category) wheres.push(`sub_category = ${push(sub_category)}`)
  if (flower_level) wheres.push(`flower_level = ${push(flower_level)}`)
  if (province) wheres.push(`province = ${push(province)}`)
  if (city) wheres.push(`city = ${push(city)}`)
  if (date_from) wheres.push(`create_date >= ${push(date_from)}`)
  if (date_to) wheres.push(`create_date <= ${push(date_to)}`)
  if (keyword) {
    const p1 = push(`%${keyword}%`)
    const p2 = push(`%${keyword}%`)
    wheres.push(`(flower_name ILIKE ${p1} OR sub_category ILIKE ${p2})`)
  }

  const whereSql = wheres.length ? 'WHERE ' + wheres.join(' AND ') : ''
  const sortField = ['create_date', 'avg_price', 'sell_avgprice', 'retail_avgprice'].includes(sort_field) ? sort_field : 'create_date'
  const sortDir = sort_order === 'asc' ? 'ASC' : 'DESC'

  const cacheKey = `prices:list:${hashKey({ ...req.query })}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json({ cached: true, ...cached })

  try {
    const dataSql = `
      SELECT statprice_id, website_id, website_name, province, city,
             main_category, sub_category, flower_name, flower_code,
             flower_level, flower_standard, sale_type, stock_num,
             avg_price, sell_avgprice, retail_avgprice,
             today_soldcount, month_soldcount, total_soldcount,
             create_date, risk_type, stat_type
      FROM stat_prices_tb
      ${whereSql}
      ORDER BY ${sortField} ${sortDir}
      LIMIT ${pageSize} OFFSET ${offset}
    `
    const countSql = `SELECT COUNT(*)::int AS total FROM stat_prices_tb ${whereSql}`

    const [{ rows: items }, { rows: [{ total }] }] = await Promise.all([
      pool.query(dataSql, params),
      pool.query(countSql, params),
    ])

    const websiteIds = [...new Set(items.map(r => r.website_id).filter(Boolean))]
    let nameMap = {}
    if (websiteIds.length > 0) {
      const { rows: wn } = await pool.query(
        `SELECT website_id, website_name FROM web_site_tb WHERE website_id = ANY($1)`,
        [websiteIds]
      )
      nameMap = Object.fromEntries(wn.map(w => [w.website_id, w.website_name]))
    }
    const enriched = items.map(r => ({
      ...r,
      website_name: r.website_name || nameMap[r.website_id] || '',
    }))

    const payload = { items: enriched, total, page: pageNum, page_size: pageSize }
    await cacheSet(cacheKey, payload, 60)
    res.json({ cached: false, ...payload })
  } catch (e) {
    console.error('[prices list error]', e.message)
    res.status(500).json({ error: e.message })
  }
})

router.get('/summary', async (req, res) => {
  const { date_from, date_to, website_id } = req.query
  const cacheKey = `prices:summary:${hashKey(req.query)}`
  const cached = await cacheGet(cacheKey)
  if (cached) return res.json({ cached: true, items: cached })

  const wheres = []
  const params = []
  const push = (v) => { params.push(v); return `$${params.length}` }
  if (date_from) wheres.push(`create_date >= ${push(date_from)}`)
  if (date_to) wheres.push(`create_date <= ${push(date_to)}`)
  if (website_id) wheres.push(`website_id = ${push(Number(website_id))}`)
  const whereSql = wheres.length ? 'WHERE ' + wheres.join(' AND ') : ''
  try {
    const { rows } = await pool.query(`
      SELECT main_category,
             COUNT(*)::int AS n,
             AVG(avg_price)::numeric(10,2) AS avg_price,
             AVG(sell_avgprice)::numeric(10,2) AS sell_avg,
             AVG(retail_avgprice)::numeric(10,2) AS retail_avg
      FROM stat_prices_tb
      ${whereSql}
      GROUP BY main_category
      ORDER BY n DESC
      LIMIT 50
    `, params)
    await cacheSet(cacheKey, rows, 120)
    res.json({ cached: false, items: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default router
