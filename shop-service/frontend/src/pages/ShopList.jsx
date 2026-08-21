import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import { ImageCell, EditableCell, Th, tdStyle, btnStyle } from '../components/EditableTable'

const EMPTY_SHOP = {
  shopName: '', lakalaShopNo: '', terminalNo: '', wechatMerchantNo: '', alipayMerchantNo: '',
  phone: '', contactName: '', date: '', idNumber: '',
  address: '', longitude: null, latitude: null,
  idCardImages: [], bankCardImages: [], qrCodeImages: [],
  businessCategory: '', tags: [],
  huaxiangApiBase: 'http://adminapi.huaxianghuamu.cn/', huaxiangApiToken: '', huaxiangCookie: '', huaxiangPlatformId: '',
  freightMode: 'uniform', freightTemplateId: 216, uniformPostage: 0
}

export default function ShopList() {
  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')  // 当前按 tag 筛选
  const [tagPool, setTagPool] = useState([])       // 全局 tag 池 [{name, count}]
  const [selectedIds, setSelectedIds] = useState([]) // 选中的店铺 _id
  const [showTagMgr, setShowTagMgr] = useState(false)
  const [showBatchTag, setShowBatchTag] = useState(false)
  const [geocoding, setGeocoding] = useState({})
  const [editingAddr, setEditingAddr] = useState({})

  useEffect(() => { loadShops(); loadTagPool() }, [])

  const loadShops = async () => {
    try {
      setLoading(true)
      const res = await api.get('/api/shops')
      setShops(res.data.shops || [])
      setSelectedIds([]) // 刷新后清空选中
    } catch (e) {
      console.error('加载店铺失败', e)
      alert('加载店铺列表失败: ' + (e.response?.data?.error || e.message))
    } finally { setLoading(false) }
  }

  const loadTagPool = async () => {
    try {
      const res = await api.get('/api/shops/tags/pool')
      setTagPool(res.data.data || [])
    } catch (e) {
      console.warn('加载标签池失败', e)
    }
  }

  // ── Auto-save a single field ──
  const updateField = async (id, field, value) => {
    setShops(prev => prev.map(s => s._id === id ? { ...s, [field]: value } : s))
    try {
      await api.put('/api/shops/' + id, { [field]: value })
    } catch (e) {
      console.error('保存失败', e)
      alert('保存失败: ' + (e.response?.data?.error || e.message))
    }
  }

  // ── 地址转经纬度 ──
  const handleGeocode = async (id, address) => {
    if (!address || !address.trim()) return
    setGeocoding(p => ({ ...p, [id]: true }))
    try {
      const res = await api.post('/api/shops/geocode', { address: address.trim() })
      const { longitude, latitude } = res.data
      await updateField(id, 'longitude', longitude)
      await updateField(id, 'latitude', latitude)
    } catch (e) {
      alert('地址解析失败: ' + (e.response?.data?.error || e.message))
    }
    setGeocoding(p => ({ ...p, [id]: false }))
  }

  const saveAddress = async (id) => {
    const addr = editingAddr[id]
    if (addr === undefined) return
    await updateField(id, 'address', addr)
    setEditingAddr(p => { const n = { ...p }; delete n[id]; return n })
  }

  const addRow = async () => {
    try {
      const res = await api.post('/api/shops', { ...EMPTY_SHOP })
      setShops(prev => [res.data, ...prev])
    } catch (e) {
      alert('新增失败: ' + (e.response?.data?.error || e.message))
    }
  }

  // ── Delete single shop ──
  const deleteRow = async (id, shopName) => {
    if (!confirm('确认删除店铺「' + (shopName || '未命名') + '」？')) return
    try {
      await api.delete('/api/shops/' + id)
      setShops(prev => prev.filter(s => s._id !== id))
      setSelectedIds(prev => prev.filter(x => x !== id))
    } catch (e) {
      alert('删除失败: ' + (e.response?.data?.error || e.message))
    }
  }

  // ── Batch delete ──
  const batchDelete = async () => {
    if (!selectedIds.length) return alert('请先勾选要删除的店铺');
    if (!confirm(`确认删除选中的 ${selectedIds.length} 家店铺？此操作不可恢复！`)) return
    try {
      const res = await api.post('/api/shops/batch-delete', { ids: selectedIds })
      setShops(prev => prev.filter(s => !selectedIds.includes(s._id)))
      setSelectedIds([])
      alert(`已删除 ${res.data.deleted} 家店铺`);
    } catch (e) {
      alert('批量删除失败: ' + (e.response?.data?.error || e.message))
    }
  }

  // ── Batch tag ──
  const batchTag = async (tags, mode) => {
    if (!selectedIds.length) return alert('请先勾选店铺');
    if (!tags.length) return alert('请输入至少一个标签');
    try {
      const res = await api.post('/api/shops/batch-tags', { ids: selectedIds, tags, mode })
      // 本地更新标签
      setShops(prev => prev.map(s => {
        if (!selectedIds.includes(s._id)) return s
        let cur = Array.isArray(s.tags) ? [...s.tags] : [];
        if (mode === 'set') cur = tags;
        else if (mode === 'add') cur = Array.from(new Set([...cur, ...tags]));
        else cur = cur.filter(t => !tags.includes(t));
        return { ...s, tags: cur };
      }));
      loadTagPool();
      setShowBatchTag(false);
      setSelectedIds([]);
      alert(`已${mode === 'add' ? '添加' : mode === 'remove' ? '移除' : '设置'}标签: 影响了 ${res.data.updated} 家店铺`);
    } catch (e) {
      alert('批量打标签失败: ' + (e.response?.data?.error || e.message))
    }
  }

  // ── 切换选中 ──
  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  const toggleSelectAll = () => {
    const visibleIds = filtered.map(s => s._id);
    if (selectedIds.length === visibleIds.length && visibleIds.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(visibleIds);
    }
  }

  // ── Filter ──
  const filtered = (() => {
    let list = shops;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        (s.shopName || '').toLowerCase().includes(q) ||
        (s.contactName || '').toLowerCase().includes(q) ||
        (s.phone || '').includes(q) ||
        (s.lakalaShopNo || '').includes(q) ||
        (s.address || '').toLowerCase().includes(q)
      );
    }
    if (tagFilter) {
      list = list.filter(s => Array.isArray(s.tags) && s.tags.includes(tagFilter));
    }
    return list;
  })();

  const allVisibleSelected = filtered.length > 0 && filtered.every(s => selectedIds.includes(s._id));

  return (
    <div style={{ padding: 20, maxWidth: '100vw', overflowX: 'auto' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, gap: 12, flexWrap: 'wrap'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>🏪 店铺管理</h2>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 搜索店铺/联系人/手机/地址..."
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #d0d0d0', fontSize: 13, width: 260, outline: 'none' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#666' }}>共 {filtered.length} 条{selectedIds.length > 0 ? `, 已选 ${selectedIds.length}` : ''}</span>
          {selectedIds.length > 0 && (
            <>
              <button onClick={() => setShowBatchTag(true)} style={{ ...btnStyle.primary, background: '#722ed1', borderColor: '#722ed1' }}>🏷️ 批量打标签 ({selectedIds.length})</button>
              <button onClick={batchDelete} style={{ ...btnStyle.danger, background: '#cf1322', borderColor: '#cf1322', color: '#fff' }}>🗑 批量删除 ({selectedIds.length})</button>
              <button onClick={() => setSelectedIds([])} style={btnStyle.secondary}>取消选择</button>
            </>
          )}
          <button onClick={() => setShowTagMgr(true)} style={{ ...btnStyle.secondary, background: '#f9f0ff', color: '#722ed1', borderColor: '#d3adf7' }}>🏷️ 标签管理</button>
          <button onClick={loadShops} style={btnStyle.secondary}>🔄 刷新</button>
          <button onClick={addRow} style={btnStyle.primary}>＋ 新增店铺</button>
        </div>
      </div>

      {/* Tag filter chips */}
      {tagPool.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fafafa', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#666', fontWeight: 600 }}>🏷️ 标签筛选：</span>
          <span onClick={() => setTagFilter('')}
            style={{ cursor: 'pointer', padding: '2px 10px', borderRadius: 12, fontSize: 12, background: tagFilter === '' ? '#722ed1' : '#fff', color: tagFilter === '' ? '#fff' : '#722ed1', border: '1px solid #d3adf7', fontWeight: tagFilter === '' ? 600 : 400 }}>
            全部
          </span>
          {tagPool.map(t => (
            <span key={t.name} onClick={() => setTagFilter(tagFilter === t.name ? '' : t.name)}
              style={{ cursor: 'pointer', padding: '2px 10px', borderRadius: 12, fontSize: 12, background: tagFilter === t.name ? '#722ed1' : '#fff', color: tagFilter === t.name ? '#fff' : '#722ed1', border: '1px solid #d3adf7', fontWeight: tagFilter === t.name ? 600 : 400 }}>
              {t.name} <span style={{ color: tagFilter === t.name ? 'rgba(255,255,255,0.85)' : '#999', marginLeft: 4 }}>({t.count})</span>
            </span>
          ))}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>加载中...</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e0e0e0', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 2700 }}>
            <thead>
              <tr style={{ background: '#f5f3ff' }}>
                <Th style={{ width: 30 }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} />
                </Th>
                <Th style={{ width: 30 }}>#</Th>
                <Th>店铺名称</Th>
                <Th>拉卡拉店铺号</Th>
                <Th>终端号</Th>
                <Th>微信商户号</Th>
                <Th>支付宝商户号</Th>
                <Th>手机</Th>
                <Th>联系人姓名</Th>
                <Th>日期</Th>
                <Th>身份证号</Th>
                <Th style={{ minWidth: 220 }}>地址</Th>
                <Th style={{ minWidth: 160 }}>身份证正反面</Th>
                <Th style={{ minWidth: 160 }}>银行卡正反面</Th>
                <Th style={{ minWidth: 160 }}>线下收款码</Th>
                <Th>经营类目</Th>
                <Th style={{ minWidth: 110 }}>平台</Th>
                <Th style={{ minWidth: 180 }}>标签</Th>
                <Th style={{ minWidth: 180 }}>Token</Th>
                <Th style={{ minWidth: 220 }}>Cookie</Th>
                <Th style={{ minWidth: 110 }}>平台ID</Th>
                <Th style={{ minWidth: 200 }}>运费设置</Th>

              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={23} style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                  暂无数据，点击「＋ 新增店铺」添加
                </td></tr>
              ) : (
                filtered.map((shop, idx) => (
                  <tr key={shop._id} style={{ borderBottom: '1px solid #eee', background: selectedIds.includes(shop._id) ? '#f0f5ff' : 'transparent' }}>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <input type="checkbox" checked={selectedIds.includes(shop._id)} onChange={() => toggleSelect(shop._id)} />
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{idx + 1}</td>
                    <td style={tdStyle}>
                      <EditableCell value={shop.shopName} onChange={v => updateField(shop._id, 'shopName', v)} placeholder="输入店铺名称" />
                    </td>
                    <td style={tdStyle}>
                      <EditableCell value={shop.lakalaShopNo} onChange={v => updateField(shop._id, 'lakalaShopNo', v)} placeholder="拉卡拉店铺号" />
                    </td>
                    <td style={tdStyle}>
                      <EditableCell value={shop.terminalNo} onChange={v => updateField(shop._id, 'terminalNo', v)} placeholder="终端号" />
                    </td>
                    <td style={tdStyle}>
                      <EditableCell value={shop.wechatMerchantNo} onChange={v => updateField(shop._id, 'wechatMerchantNo', v)} placeholder="微信商户号" />
                    </td>
                    <td style={tdStyle}>
                      <EditableCell value={shop.alipayMerchantNo} onChange={v => updateField(shop._id, 'alipayMerchantNo', v)} placeholder="支付宝商户号" />
                    </td>
                    <td style={tdStyle}>
                      <EditableCell value={shop.phone} onChange={v => updateField(shop._id, 'phone', v)} placeholder="手机号" />
                    </td>
                    <td style={tdStyle}>
                      <EditableCell value={shop.contactName} onChange={v => updateField(shop._id, 'contactName', v)} placeholder="联系人" />
                    </td>
                    <td style={tdStyle}>
                      <EditableCell value={shop.date} type="date" onChange={v => updateField(shop._id, 'date', v)} />
                    </td>
                    <td style={tdStyle}>
                      <EditableCell value={shop.idNumber} onChange={v => updateField(shop._id, 'idNumber', v)} placeholder="身份证号" />
                    </td>
                    <td style={{ ...tdStyle, minWidth: 220 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            value={editingAddr[shop._id] !== undefined ? editingAddr[shop._id] : (shop.address || '')}
                            onChange={e => setEditingAddr(p => ({ ...p, [shop._id]: e.target.value }))}
                            placeholder="输入地址"
                            style={{
                              flex: 1, padding: '3px 6px', borderRadius: 4,
                              border: '1px solid #d0c8f0', fontSize: 12, outline: 'none',
                              background: editingAddr[shop._id] !== undefined ? '#f8f6ff' : 'transparent'
                            }}
                          />
                          {editingAddr[shop._id] !== undefined && editingAddr[shop._id] !== (shop.address || '') && (
                            <button
                              onClick={() => saveAddress(shop._id)}
                              style={{
                                padding: '2px 8px', border: '1px solid #7c5cfc',
                                background: '#7c5cfc', color: '#fff', borderRadius: 4,
                                cursor: 'pointer', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap'
                              }}>💾</button>
                          )}
                          {editingAddr[shop._id] !== undefined && (
                            <button
                              onClick={() => setEditingAddr(p => { const n = { ...p }; delete n[shop._id]; return n })}
                              style={{
                                padding: '2px 6px', border: '1px solid #ccc',
                                background: '#f5f5f5', color: '#666', borderRadius: 4,
                                cursor: 'pointer', fontSize: 10
                              }}>✕</button>
                          )}
                        </div>
                        {geocoding[shop._id] ? (
                          <span style={{ fontSize: 10, color: '#ef6c00', padding: '2px 4px' }}>解析中...</span>
                        ) : shop.longitude != null && shop.latitude != null ? (
                          <span style={{
                            fontSize: 10, color: '#2e7d32', fontFamily: 'monospace',
                            fontWeight: 500, padding: '2px 6px', border: '1px solid #c8e6c9',
                            borderRadius: 4, background: '#e8f5e9', textAlign: 'center',
                            whiteSpace: 'nowrap', cursor: 'pointer'
                          }}
                            title="点击重新解析"
                            onClick={() => handleGeocode(shop._id, shop.address)}
                          >
                            📍 {shop.longitude.toFixed(6)}, {shop.latitude.toFixed(6)}
                          </span>
                        ) : shop.address ? (
                          <span
                            style={{
                              fontSize: 10, color: '#1565c0', cursor: 'pointer',
                              padding: '2px 4px', textDecoration: 'underline'
                            }}
                            onClick={() => handleGeocode(shop._id, shop.address)}
                          >
                            点击解析经纬度
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, color: '#999', padding: '2px 4px' }}>保存地址后解析经纬度</span>
                        )}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <ImageCell images={shop.idCardImages || []} maxCount={2}
                        onPaste={(base64, name) => handleImagePaste(shop._id, 'idCardImages', base64, name)}
                        onRemove={i => removeImage(shop._id, 'idCardImages', i)} />
                    </td>
                    <td style={tdStyle}>
                      <ImageCell images={shop.bankCardImages || []} maxCount={2}
                        onPaste={(base64, name) => handleImagePaste(shop._id, 'bankCardImages', base64, name)}
                        onRemove={i => removeImage(shop._id, 'bankCardImages', i)} />
                    </td>
                    <td style={tdStyle}>
                      <ImageCell images={shop.qrCodeImages || []} maxCount={2}
                        onPaste={(base64, name) => handleImagePaste(shop._id, 'qrCodeImages', base64, name)}
                        onRemove={i => removeImage(shop._id, 'qrCodeImages', i)} />
                    </td>
                    <td style={tdStyle}>
                      <EditableCell value={shop.businessCategory} onChange={v => updateField(shop._id, 'businessCategory', v)} placeholder="经营类目" />
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={shop.platform || ''}
                        onChange={e => updateField(shop._id, 'platform', e.target.value)}
                        style={{
                          width: '100%', padding: '3px 6px', borderRadius: 4,
                          border: shop.platform === 'huaxiang' ? '2px solid #52c41a' : '1px solid #d0c8f0',
                          fontSize: 12, outline: 'none', cursor: 'pointer',
                          background: shop.platform === 'huaxiang' ? '#f6ffed' : '#fff',
                          fontWeight: shop.platform === 'huaxiang' ? 600 : 400
                        }}
                      >
                        <option value="">— 无 —</option>
                        <option value="huaxiang">🌿 花乡花木</option>
                        <option value="wechat">📬 微信小店</option>
                        <option value="douyin">🎵 抖音小店</option>
                        <option value="xiaohongshu">📕 小红书</option>
                        <option value="taobao">🛒 淘宝</option>
                        <option value="jd">🏢 京东</option>
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxWidth: 180 }}>
                        {(shop.tags || []).map(t => (
                          <span key={t} onClick={() => setTagFilter(t)} title="点击筛选此标签"
                            style={{ cursor: 'pointer', padding: '1px 6px', borderRadius: 8, fontSize: 10, background: '#f9f0ff', color: '#722ed1', border: '1px solid #d3adf7' }}>
                            {t}
                          </span>
                        ))}
                        {(shop.tags || []).length === 0 && <span style={{ fontSize: 10, color: '#ccc' }}>—</span>}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <input type="text" value={shop.huaxiangApiToken || ''}
                        onChange={e => setShops(prev => prev.map(s => s._id === shop._id ? { ...s, huaxiangApiToken: e.target.value } : s))}
                        onBlur={e => updateField(shop._id, 'huaxiangApiToken', e.target.value)}
                        style={{ width: '100%', padding: '3px 6px', border: shop.huaxiangApiToken ? '1px solid #52c41a' : '1px solid #ffd591', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', background: shop.huaxiangApiToken ? '#fffbe6' : '#fff', outline: 'none' }} />
                    </td>
                    <td style={tdStyle}>
                      <input type="text" value={shop.huaxiangCookie || ''}
                        onChange={e => setShops(prev => prev.map(s => s._id === shop._id ? { ...s, huaxiangCookie: e.target.value } : s))}
                        onBlur={e => updateField(shop._id, 'huaxiangCookie', e.target.value)}
                        style={{ width: '100%', padding: '3px 6px', border: shop.huaxiangCookie ? '1px solid #52c41a' : '1px solid #ffd591', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', background: shop.huaxiangCookie ? '#fffbe6' : '#fff', outline: 'none' }} />
                    </td>
                    <td style={tdStyle}>
                      <EditableCell value={shop.huaxiangPlatformId} onChange={v => updateField(shop._id, 'huaxiangPlatformId', v)} />
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <select
                          value={shop.freightMode || 'uniform'}
                          onChange={e => updateField(shop._id, 'freightMode', e.target.value)}
                          style={{ width: '100%', padding: '2px 4px', borderRadius: 3, border: '1px solid #d0c8f0', fontSize: 11, cursor: 'pointer', background: '#fff' }}
                        >
                          <option value="uniform">统一运费</option>
                          <option value="template">运费模板</option>
                        </select>
                        {shop.freightMode === 'template' ? (
                          <input
                            type="number" min="1" step="1"
                            value={shop.freightTemplateId ?? 216}
                            onChange={e => setShops(prev => prev.map(s => s._id === shop._id ? { ...s, freightTemplateId: parseInt(e.target.value) || 0 } : s))}
                            onBlur={e => updateField(shop._id, 'freightTemplateId', parseInt(e.target.value) || 0)}
                            style={{ width: '100%', padding: '2px 4px', borderRadius: 3, border: '1px solid #ffd591', fontSize: 11, fontFamily: 'monospace', outline: 'none' }}
                          />
                        ) : (
                          <input
                            type="number" min="0" step="0.01"
                            value={shop.uniformPostage ?? 0}
                            onChange={e => setShops(prev => prev.map(s => s._id === shop._id ? { ...s, uniformPostage: parseFloat(e.target.value) || 0 } : s))}
                            onBlur={e => updateField(shop._id, 'uniformPostage', parseFloat(e.target.value) || 0)}
                            style={{ width: '100%', padding: '2px 4px', borderRadius: 3, border: '1px solid #ffd591', fontSize: 11, fontFamily: 'monospace', outline: 'none' }}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 标签管理 Modal */}
      {showTagMgr && <TagMgrModal tagPool={tagPool} onClose={() => setShowTagMgr(false)} onRefresh={() => { loadTagPool(); loadShops(); }} />}

      {/* 批量打标签 Modal */}
      {showBatchTag && <BatchTagModal count={selectedIds.length} onClose={() => setShowBatchTag(false)} onApply={batchTag} />}
    </div>
  );

  // ── 图片粘贴处理 (保留原逻辑) ──
  async function handleImagePaste(shopId, field, base64, name) {
    setShops(prev => prev.map(s => s._id === shopId ? { ...s, [field]: [...(s[field] || []), { key: 'paste', url: base64, name }] } : s));
    try {
      await api.put('/api/shops/' + shopId, { [field]: [...(shops.find(s => s._id === shopId)?.[field] || []), { key: 'paste', url: base64, name }] });
    } catch (e) { alert('图片保存失败: ' + (e.response?.data?.error || e.message)); }
  }

  function removeImage(shopId, field, idx) {
    setShops(prev => prev.map(s => {
      if (s._id !== shopId) return s;
      const arr = [...(s[field] || [])];
      arr.splice(idx, 1);
      return { ...s, [field]: arr };
    }));
    api.put('/api/shops/' + shopId, { [field]: (shops.find(s => s._id === shopId)?.[field] || []).filter((_, i) => i !== idx) }).catch(() => {});
  }
}

// ============ 标签管理 Modal ============
function TagMgrModal({ tagPool, onClose, onRefresh }) {
  const [newTag, setNewTag] = useState('');
  const addTag = async () => {
    const t = newTag.trim();
    if (!t) return;
    // 加到第一家店铺的 tags (tag pool 本身是聚合, 没有独立存储)
    const allShopsRes = await api.get('/api/shops?limit=1000');
    const firstShop = (allShopsRes.data.shops || [])[0];
    if (!firstShop) { alert('请先创建店铺'); return; }
    const cur = firstShop.tags || [];
    if (cur.includes(t)) { alert('标签已存在'); return; }
    try {
      await api.put('/api/shops/' + firstShop._id + '/tags', { tags: [...cur, t] });
      setNewTag('');
      onRefresh();
    } catch (e) { alert('添加标签失败: ' + (e.response?.data?.error || e.message)); }
  };
  const delTag = async (name) => {
    if (!confirm('从所有店铺上移除标签「' + name + '」？')) return;
    // 从所有店铺移除
    try {
      const res = await api.get('/api/shops?limit=1000');
      const ids = (res.data.shops || []).filter(s => (s.tags || []).includes(name)).map(s => s._id);
      if (!ids.length) return;
      await api.post('/api/shops/batch-tags', { ids, tags: [name], mode: 'remove' });
      onRefresh();
    } catch (e) { alert('删除失败: ' + (e.response?.data?.error || e.message)); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 8, padding: 20, width: 480, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px' }}>🏷️ 标签管理</h3>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <input value={newTag} onChange={e => setNewTag(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTag()}
            placeholder="输入新标签名, Enter 添加"
            style={{ flex: 1, padding: '6px 10px', borderRadius: 4, border: '1px solid #d0d0d0', fontSize: 13 }} />
          <button onClick={addTag} style={{ ...btnStyle.primary, padding: '6px 14px' }}>+ 添加</button>
        </div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>现有标签 ({tagPool.length})：</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
          {tagPool.length === 0 ? <span style={{ fontSize: 12, color: '#ccc' }}>暂无标签</span> :
            tagPool.map(t => (
              <span key={t.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 14, background: '#f9f0ff', border: '1px solid #d3adf7', fontSize: 12 }}>
                <span style={{ color: '#722ed1', fontWeight: 500 }}>{t.name}</span>
                <span style={{ color: '#999', fontSize: 10 }}>×{t.count}</span>
                <button onClick={() => delTag(t.name)} title="从所有店铺移除"
                  style={{ border: 'none', background: 'rgba(0,0,0,0.06)', color: '#666', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 12, lineHeight: '18px', padding: 0 }}>×</button>
              </span>
            ))}
        </div>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button onClick={onClose} style={btnStyle.secondary}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// ============ 批量打标签 Modal ============
function BatchTagModal({ count, onClose, onApply }) {
  const [tagsInput, setTagsInput] = useState('');
  const [mode, setMode] = useState('add');
  const apply = () => {
    const tags = tagsInput.split(/[,，\s]+/).filter(Boolean);
    if (!tags.length) return alert('请输入至少一个标签');
    onApply(tags, mode);
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 8, padding: 20, width: 460, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px' }}>🏷️ 批量打标签 · {count} 家店铺</h3>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>操作：</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ fontSize: 13, cursor: 'pointer' }}><input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} /> ➕ 追加</label>
            <label style={{ fontSize: 13, cursor: 'pointer' }}><input type="radio" checked={mode === 'remove'} onChange={() => setMode('remove')} /> ➖ 移除</label>
            <label style={{ fontSize: 13, cursor: 'pointer' }}><input type="radio" checked={mode === 'set'} onChange={() => setMode('set')} /> 🔄 覆盖</label>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>标签（逗号/空格/换行分隔）：</div>
          <textarea value={tagsInput} onChange={e => setTagsInput(e.target.value)}
            placeholder="例如：VIP, 自营, 北方"
            rows={3}
            style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #d0d0d0', fontSize: 13, resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={btnStyle.secondary}>取消</button>
          <button onClick={apply} style={{ ...btnStyle.primary, background: '#722ed1', borderColor: '#722ed1' }}>应用 ({count})</button>
        </div>
      </div>
    </div>
  );
}
