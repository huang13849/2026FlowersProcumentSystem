import pg from 'pg'

const { Pool } = pg

const host = process.env.PG_HOST || '36.139.238.74'
const port = Number(process.env.PG_PORT || 5432)
const user = process.env.PG_USER || 'postgres'
const password = process.env.PG_PASSWORD || (function(){throw new Error('PG_PASSWORD env required')}())
const database = process.env.PG_DATABASE || 'flowerpriceindex'

// Use connectionString with URL-encoded password to avoid special char issues
const encodedPassword = encodeURIComponent(password)
const connectionString = 'postgresql://' + user + ':' + encodedPassword + '@' + host + ':' + port + '/' + database

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
})

pool.on('error', (err) => console.error('[pg pool error]', err.message))