/**
 * API Gateway - 认证中间件
 * 支持 API Key 和 JWT 两种认证方式
 */
const API_KEYS = (process.env.API_KEYS || (function(){throw new Error('API_KEYS env required')})()).split(',').filter(Boolean);
const JWT_SECRET = process.env.JWT_SECRET || (function(){throw new Error('JWT_SECRET env required')})();

function authMiddleware(req, res, next) {
  // 白名单路径
  const publicPaths = ['/health', '/api/health', '/api/status', '/api/auth'];
  if (publicPaths.some(p => req.path.startsWith(p))) {
    return next();
  }

  // 1. API Key 认证
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (apiKey && API_KEYS.includes(apiKey)) {
    req.auth = { type: 'apikey', key: apiKey };
    return next();
  }

  // 2. Bearer Token 认证
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, JWT_SECRET);
      req.auth = { type: 'jwt', user: decoded };
      return next();
    } catch (e) {
      // Token 无效，继续检查其他方式
    }
  }

  // 3. 内部服务认证（服务间调用）
  const internalToken = req.headers['x-internal-token'];
  if (internalToken === process.env.INTERNAL_TOKEN) {
    req.auth = { type: 'internal' };
    return next();
  }

  return res.status(401).json({
    error: '认证失败',
    message: '需要 API Key (x-api-key) 或 Bearer Token',
    hint: '在请求头添加 X-API-Key 或 Authorization: Bearer <token>',
  });
}

module.exports = authMiddleware;
