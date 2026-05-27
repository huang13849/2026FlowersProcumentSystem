import { useState, useEffect } from 'react'
import api from '../api'
import { ImageCell, EditableCell, Th, tdStyle, btnStyle } from '../components/EditableTable'

const EMPTY_SHOP = {
  shopName: '', lakalaShopNo: '', terminalNo: '', wechatMerchantNo: '', alipayMerchantNo: '',
  phone: '', contactName: '', date: '', idNumber: '',
  idCardImages: [], bankCardImages: [], qrCodeImages: [],
  businessCategory: ''
}

export default function ShopList() {
  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

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
      await api.put(`/api/shops/${id}`, { [field]: value })
    } catch (e) {
      console.error('保存失败', e)
      alert('保存失败: ' + (e.response?.data?.error || e.message))
    }
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
    // Optimistic update
    const updatedImages = [...((shops.find(s => s._id === shopId)?.[field]) || []), newImg]
    setShops(prev => prev.map(s => s._id === shopId ? { ...s, [field]: updatedImages } : s))
    try {
      await api.put(`/api/shops/${shopId}`, { [field]: updatedImages })
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
      await api.put(`/api/shops/${shopId}`, { [field]: images })
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
    if (!confirm(`确认删除店铺「${shopName || '未命名'}」？`)) return
    try {
      await api.delete(`/api/shops/${id}`)
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
        (s.lakalaShopNo || '').includes(search)
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
          <h2 style={{ margin: 0, fontSize: 18 }}>🏪 店铺注册管理</h2>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 搜索店铺/联系人/手机..."
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #d0d0d0', fontSize: 13, width: 220, outline: 'none' }} />
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1600 }}>
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
                <Th style={{ minWidth: 160 }}>身份证正反面</Th>
                <Th style={{ minWidth: 160 }}>银行卡正反面</Th>
                <Th style={{ minWidth: 160 }}>线下收款码</Th>
                <Th>经营类目</Th>
                <Th style={{ width: 50 }}>操作</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={15} style={{ textAlign: 'center', padding: 40, color: '#999' }}>
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