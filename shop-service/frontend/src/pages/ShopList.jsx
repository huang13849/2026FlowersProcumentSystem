import { useState, useEffect } from 'react'
import api from '../api'
import { ImageCell, EditableCell, Th, tdStyle, btnStyle } from '../components/EditableTable'

const EMPTY_SHOP = {
  shopName: '', lakalaShopNo: '', terminalNo: '', wechatMerchantNo: '', alipayMerchantNo: '',
  phone: '', contactName: '', date: '', idNumber: '',
  address: '', longitude: null, latitude: null,
  idCardImages: [], bankCardImages: [], qrCodeImages: [],
  businessCategory: '',
  huaxiangApiBase: 'http://adminapi.huaxianghuamu.cn/', huaxiangApiToken: '', huaxiangPlatformId: ''
}

export default function ShopList() {
  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [geocoding, setGeocoding] = useState({})
  const [editingAddr, setEditingAddr] = useState({})

  useEffect(() => { loadShops() }, [])

  const loadShops = async () => {
    try {
      setLoading(true)
      const res = await api.get('/api/shops')
      setShops(res.data.shops || [])
    } catch (e) {
      console.error('加载店铺失败', e)
      alert('加载店铺列表失败: ' + (e.response?.data?.error || e.message))
    } finally { setLoading(false) }
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
      setShops(prev => prev.map(s => s._id !== id ? s : { ...s, longitude, latitude }))
      await api.put('/api/shops/' + id, { longitude, latitude })
    } catch (e) {
      console.error('Geocode failed:', e)
      alert('地址解析失败: ' + (e.response?.data?.error || e.message))
    }
    setGeocoding(p => ({ ...p, [id]: false }))
  }

  // ── 保存地址并触发经纬度解析 ──
  const saveAddress = async (id) => {
    const addr = editingAddr[id]?.trim()
    if (!addr) { alert('请输入地址'); return }
    await updateField(id, 'address', addr)
    setEditingAddr(p => { const n = { ...p }; delete n[id]; return n })
    handleGeocode(id, addr)
  }

  // ── Image paste: upload base64 to MinIO, then save URL ──
  const handleImagePaste = async (shopId, field, base64, filename) => {
    let uploadResult
    try {
      const res = await api.post('/api/upload/base64', { base64, name: filename, folder: 'shops' })
      uploadResult = res.data
    } catch (e) {
      alert('图片上传失败: ' + (e.response?.data?.error || e.message))
      return
    }
    const newImg = { url: uploadResult.url, key: uploadResult.key, name: uploadResult.name }
    const updatedImages = [...((shops.find(s => s._id === shopId)?.[field]) || []), newImg]
    setShops(prev => prev.map(s => s._id === shopId ? { ...s, [field]: updatedImages } : s))
    try {
      await api.put('/api/shops/' + shopId, { [field]: updatedImages })
    } catch (e) {
      console.error('保存图片失败', e)
    }
  }

  // ── Remove image from array field ──
  const removeImage = async (shopId, field, index) => {
    const shop = shops.find(s => s._id === shopId)
    if (!shop) return
    const images = [...(shop[field] || [])]
    images.splice(index, 1)
    setShops(prev => prev.map(s => s._id === shopId ? { ...s, [field]: images } : s))
    try {
      await api.put('/api/shops/' + shopId, { [field]: images })
    } catch (e) {
      console.error('删除图片失败', e)
    }
  }

  // ── Add new row ──
  const addRow = async () => {
    try {
      const res = await api.post('/api/shops', { ...EMPTY_SHOP })
      setShops(prev => [...prev, res.data])
    } catch (e) {
      alert('新增失败: ' + (e.response?.data?.error || e.message))
    }
  }

  // ── Delete row ──
  const deleteRow = async (id, shopName) => {
    if (!confirm('确认删除店铺「' + (shopName || '未命名') + '」？')) return
    try {
      await api.delete('/api/shops/' + id)
      setShops(prev => prev.filter(s => s._id !== id))
    } catch (e) {
      alert('删除失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const filtered = search
    ? shops.filter(s =>
        (s.shopName || '').includes(search) ||
        (s.contactName || '').includes(search) ||
        (s.phone || '').includes(search) ||
        (s.lakalaShopNo || '').includes(search) ||
        (s.address || '').includes(search)
      )
    : shops

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
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#666', alignSelf: 'center' }}>共 {filtered.length} 条</span>
          <button onClick={loadShops} style={btnStyle.secondary}>🔄 刷新</button>
          <button onClick={addRow} style={btnStyle.primary}>＋ 新增店铺</button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>加载中...</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e0e0e0', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 2200 }}>
            <thead>
              <tr style={{ background: '#f5f3ff' }}>
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
                <Th style={{ minWidth: 240 }}>花像花木 同步设置 (API / Token / 平台ID)</Th>
                <Th style={{ width: 50 }}>操作</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={17} style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                  暂无数据，点击「＋ 新增店铺」添加
                </td></tr>
              ) : (
                filtered.map((shop, idx) => (
                  <tr key={shop._id} style={{ borderBottom: '1px solid #eee' }}>
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
                    {/* 地址列：输入 + 保存 + 经纬度解析展示 */}
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
                              }}
                            >💾</button>
                          )}
                          {editingAddr[shop._id] !== undefined && (
                            <button
                              onClick={() => setEditingAddr(p => { const n = { ...p }; delete n[shop._id]; return n })}
                              style={{
                                padding: '2px 6px', border: '1px solid #ccc',
                                background: '#f5f5f5', color: '#666', borderRadius: 4,
                                cursor: 'pointer', fontSize: 10
                              }}
                            >✕</button>
                          )}
                        </div>
                        {/* 经纬度展示 */}
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 10, color: '#666', width: 48, flexShrink: 0 }}>API</span>
                          <EditableCell value={shop.huaxiangApiBase} onChange={v => updateField(shop._id, 'huaxiangApiBase', v)} placeholder="http://adminapi.huaxianghuamu.cn/" />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 10, color: '#666', width: 48, flexShrink: 0 }}>Token</span>
                          <input type="password" value={shop.huaxiangApiToken || ''}
                            onChange={e => setShops(prev => prev.map(s => s._id === shop._id ? { ...s, huaxiangApiToken: e.target.value } : s))}
                            onBlur={e => updateField(shop._id, 'huaxiangApiToken', e.target.value)}
                            placeholder="admin 页面 cookie ajaxtoken"
                            autoComplete="off"
                            style={{ flex: 1, padding: '3px 6px', border: '1px solid #ffd591', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', background: shop.huaxiangApiToken ? '#fffbe6' : '#fff', outline: 'none' }} />
                          {shop.huaxiangApiToken ? <span style={{ fontSize: 10, color: '#52c41a', fontWeight: 600 }}>✓已配</span> : <span style={{ fontSize: 10, color: '#999' }}>未配</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 10, color: '#666', width: 48, flexShrink: 0 }}>平台ID</span>
                          <EditableCell value={shop.huaxiangPlatformId} onChange={v => updateField(shop._id, 'huaxiangPlatformId', v)} placeholder="platformId (pfid)" />
                        </div>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <button onClick={() => deleteRow(shop._id, shop.shopName)} style={btnStyle.danger}>🗑</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
