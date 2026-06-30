/**
 * 平台适配器注册中心 —— 可插拔平台管理
 */
const DouyinAdapter = require('./DouyinAdapter');
const XiaohongshuAdapter = require('./XiaohongshuAdapter');
const PinduoduoAdapter = require('./PinduoduoAdapter');
const ShipinhaoAdapter = require('./ShipinhaoAdapter');

const HuaxiangAdapter = require('./HuaxiangAdapter');

/**
 * 全局适配器注册表
 * 新增平台只需在此注册即可
 */
const adapterRegistry = new Map();

const adapterClasses = {
  douyin: DouyinAdapter,
  xiaohongshu: XiaohongshuAdapter,
  pinduoduo: PinduoduoAdapter,
  shipinhao: ShipinhaoAdapter,
  huaxiang: HuaxiangAdapter,
};

// 初始化所有适配器
function initAdapters() {
  for (const [key, AdapterClass] of Object.entries(adapterClasses)) {
    const adapter = new AdapterClass();
    adapterRegistry.set(key, adapter);
    const configured = adapter.isConfigured() ? '✅ 已配置' : '⚠️ 未配置密钥';
    console.log(`[AdapterRegistry] ${adapter.platformName} (${key}) → ${configured}`);
  }
}

/**
 * 获取平台适配器
 * @param {string} platformKey 平台标识 douyin/xiaohongshu/...
 * @returns {BasePlatformAdapter}
 * @throws 平台不支持
 */
function getAdapter(platformKey, options = {}) {
  const baseAdapter = adapterRegistry.get(platformKey);
  if (!baseAdapter) {
    throw new Error(`不支持的平台: ${platformKey}。支持: ${[...adapterRegistry.keys()].join(', ')}`);
  }

  // 花乡花木支持“本次任务临时账号”，避免多个账号切换时重启服务/改 .env。
  if (platformKey === 'huaxiang' && options.account) {
    const adapter = new HuaxiangAdapter();
    adapter.setAccount(options.account);
    return adapter;
  }

  return baseAdapter;
}

/**
 * 获取所有支持的平台列表（含配置状态）
 * @returns {Array<{ key: string, name: string, configured: boolean }>}
 */
function getSupportedPlatforms() {
  const result = [];
  for (const [key, adapter] of adapterRegistry) {
    result.push({
      key,
      name: adapter.platformName,
      configured: adapter.isConfigured(),
    });
  }
  return result;
}

module.exports = {
  initAdapters,
  getAdapter,
  getSupportedPlatforms,
  adapterRegistry,
};
