import axios from 'axios';
const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = 'Bearer ' + token;
  return cfg;
});

// API Gateway 客户端 — MinIO 文件操作走 Gateway
const GATEWAY_URL = window.__GATEWAY_URL__ || 'http://100.96.54.109:3007'
const GATEWAY_API_KEY = window.__GATEWAY_API_KEY__ || '***REMOVED_API_KEY***'

const gatewayApi = axios.create({ baseURL: GATEWAY_URL })
gatewayApi.interceptors.request.use(c => {
  c.headers['x-api-key'] = GATEWAY_API_KEY
  return c
})

export { gatewayApi, GATEWAY_URL, GATEWAY_API_KEY }
export default api;
