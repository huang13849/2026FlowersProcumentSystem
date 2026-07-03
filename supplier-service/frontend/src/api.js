import axios from 'axios'

const api = axios.create({ baseURL: '' })
api.interceptors.request.use(c => {
  const t = localStorage.getItem('token')
  if (t) c.headers.Authorization = 'Bearer ' + t
  return c
})
api.interceptors.response.use(r => r, e => {
  if (e.response?.status === 401) {
    localStorage.removeItem('token')
    window.location = '/'
  }
  return Promise.reject(e)
})

// API Gateway 客户端 — MinIO 文件操作走 Gateway
const GATEWAY_URL = window.__GATEWAY_URL__ || 'http://100.96.54.109:31007'
const GATEWAY_API_KEY = window.__GATEWAY_API_KEY__ || '***REMOVED_API_KEY***'

const gatewayApi = axios.create({ baseURL: GATEWAY_URL })
gatewayApi.interceptors.request.use(c => {
  c.headers['x-api-key'] = GATEWAY_API_KEY
  return c
})

export { api, gatewayApi, GATEWAY_URL, GATEWAY_API_KEY }
export default api
