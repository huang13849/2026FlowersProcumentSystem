import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import pricesRouter from './routes/prices.js'
import metaRouter from './routes/meta.js'
import rawRouter from './routes/raw.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/prices/health', (req, res) => res.json({ ok: true, service: 'price-service', port: 3009 }))

app.use('/api/prices', pricesRouter)
app.use('/api/prices/meta', metaRouter)
app.use('/api/raw-flowers', rawRouter)

app.use(express.static(path.join(__dirname, 'frontend/dist')))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  res.sendFile(path.join(__dirname, 'frontend/dist/index.html'))
})

const PORT = process.env.PORT || 3009
app.listen(PORT, () => console.log(`[price-service] listening on :${PORT}`))