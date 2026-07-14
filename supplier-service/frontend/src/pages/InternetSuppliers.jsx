import { useState, useEffect, useRef } from 'react'
import api from '../api'

const STATUS_MAP = { '1': '启用', '0': '停用' }
const STATUS_COLORS = { '1': { bg: '#e8f5e9', c: '#2e7d32' }, '0': { bg: '#ffebee', c: '#c62828' } }

export default function InternetSuppliers() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [limit] = useState(50)
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(0)
  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState('')
  const [province, setProvince] = useState('')
  const [platforms, setPlatforms] = useState([])
  const [provinces, setProvinces] = useState([])
  const [detail, setDetail] = useState(null)
  const timer = useRef()
  const [tagPool, setTagPool] = useState([])
  const [sourceLabels, setSourceLabels] = useState({})
  const [tagEdit, setTagEdit] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const params = { page, limit }
      if (search) params.search = search
      if (platform) params.website_name = platform
      if (province) params.province = province
      const r = await api.get('/api/internet-suppliers', { params })
      setItems(r.data.data || [])
      setTotal(r.data.total)
      setPages(r.data.pages)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const loadFilters = async () => {
    try {
      const r = await api.get('/api/internet-suppliers/platforms')
      setPlatforms(r.data.platforms || [])
      setProvinces(r.data.provinces || [])
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    loadFilters()
    fetch('http://100.96.54.109:8088/api/tags?scope=supplier', { headers: { 'x-api-key': '***REMOVED_API_KEY***' }})
      .then(r => r.json()).then(d => { if (d.success) setTagPool(d.data || []) }).catch(() => {})
    fetch('/api/internet-suppliers/source-labels').then(r => r.json()).then(setSourceLabels).catch(() => {})
  }, [])
  useEffect(() => { load() }, [page])
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { setPage(1); load() }, 400)
    return () => clearTimeout(timer.current)
  }, [search, platform, province])

  // 统计
  const stats = [
    { label: '总店铺', value: total, color: '#1976d2', icon: '🏪' },
    { label: '启用', value: items.filter(x => String(x.is_used) === '1').length, color: '#2e7d32', icon: '✅' },
    { label: '停用', value: items.filter(x => String(x.is_used) === '0').length, color: '#c62828', icon: '⏸️' },
    { label: '当前页', value: items.length, color: '#7e57c2', icon: '📄' },
  ]

  const th = { padding: '8px 10px', borderBottom: '2px solid #3E7B5B', fontWeight: 700, fontSize: 12, color: '#2e5230', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#f1f8e9', textAlign: 'left', fontFamily: "'Microsoft YaHei',sans-serif" }
  const td = { padding: '6px 10px', borderBottom: '1px solid #e0e0e0', fontSize: 12, verticalAlign: 'middle', color: '#333', fontFamily: "'Microsoft YaHei',sans-serif" }
  const inputS = { width: '100%', padding: '4px 6px', border: '1px solid #d0d0d0', borderRadius: 4, fontSize: 12, outline: 'none', fontFamily: "'Microsoft YaHei',sans-serif" }

  return (
    <div style={{ padding: 16, background: '#F5F7F4', minHeight: 'calc(100vh - 48px)', fontFamily: "'Microsoft YaHei',sans-serif" }}>
      {/* 统计条 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        {stats.map((s, i) => (
          <div key={i} style={{ flex: 1, background: '#fff', borderRadius: 10, padding: '10px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: s.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: 11, color: '#888' }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 筛选栏 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap', background: '#fff', padding: 10, borderRadius: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #e0e0e0' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder='搜索店铺名/店主/电话/描述' style={{ ...inputS, width: 240 }} />
        <select value={platform} onChange={e => setPlatform(e.target.value)} style={{ ...inputS, width: 120, cursor: 'pointer' }}>
          <option value=''>全部平台</option>
          {platforms.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={province} onChange={e => setProvince(e.target.value)} style={{ ...inputS, width: 120, cursor: 'pointer' }}>
          <option value=''>全部省份</option>
          {provinces.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#666' }}>共 {total.toLocaleString()} 家</span>
      </div>

      {/* 表格 */}
      <div style={{ overflow: 'auto', background: '#fff', borderRadius: 10, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid #e0e0e0', maxHeight: 'calc(100vh - 280px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{[
            { w: 50, t: 'ID' },
            { w: 80, t: '平台' },
            { w: 160, t: '店铺名称' },
            { w: 80, t: '店主' },
            { w: 100, t: '联系电话' },
            { w: 80, t: '省份' },
            { w: 80, t: '城市' },
            { w: 100, t: '区县' },
            { w: 120, t: '地址' },
            { w: 60, t: '等级' },
            { w: 150, t: '主营业务' },
            { w: 60, t: '状态' },
            { w: 100, t: '来源' },
            { w: 180, t: '标签' },
            { w: 100, t: '创建日期' },
          ].map((h, i) => <th key={i} style={{ ...th, width: h.w, minWidth: h.w }}>{h.t}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={15} style={{ textAlign: 'center', padding: 30, color: '#888' }}>加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={15} style={{ textAlign: 'center', padding: 30, color: '#888' }}>暂无数据</td></tr>
            ) : items.map((r, i) => {
              const sc = STATUS_COLORS[String(r.is_used)] || STATUS_COLORS['0']
              const bg = i % 2 === 0 ? '#fff' : '#fafafa'
              return (
                <tr key={r.siteshop_id || i} style={{ background: bg, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f1f8e9'}
                  onMouseLeave={e => e.currentTarget.style.background = bg}
                  onClick={() => setDetail(r)}>
                  <td style={td}>{r.siteshop_id}</td>
                  <td style={{ ...td, fontWeight: 600, color: '#1565c0' }}>{r.website_name}</td>
                  <td style={{ ...td, fontWeight: 600, color: '#2e5230' }}>{r.shop_name}</td>
                  <td style={td}>{r.shop_owner}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.owner_tell}</td>
                  <td style={td}>{r.province}</td>
                  <td style={td}>{r.city}</td>
                  <td style={td}>{r.country}</td>
                  <td style={{ ...td, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.address}>{r.address}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <span style={{ padding: '2px 6px', borderRadius: 4, background: '#e3f2fd', color: '#1565c0', fontWeight: 600, fontSize: 11 }}>{r.shop_level}</span>
                  </td>
                  <td style={{ ...td, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>{r.description || '-'}</td>
                  <td style={td}>
                    <span style={{ padding: '2px 8px', borderRadius: 999, background: sc.bg, color: sc.c, fontWeight: 600, fontSize: 11 }}>{STATUS_MAP[String(r.is_used)] || '未知'}</span>
                  </td>
                  <td style={{ ...td, fontSize: 11 }}>
                    {r.source_project === 'self-operated' || !r.source_project
                      ? <span style={{ padding: '2px 8px', borderRadius: 10, background: '#fffbe6', color: '#faad14', border: '1px solid #ffe58f', fontSize: 10 }}>自营录入</span>
                      : <span style={{ padding: '2px 8px', borderRadius: 10, background: '#e6fffb', color: '#13c2c2', border: '1px solid #87e8de', fontSize: 10 }}>{sourceLabels[r.source_project] || r.source_project}</span>}
                  </td>
                  <td style={td} onClick={e => { e.stopPropagation(); setTagEdit(r) }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', cursor: 'pointer', minHeight: 22 }}>
                      {(r.tags || []).map((t, ti) => {
                        const meta = tagPool.find(x => x.name === t) || { color: '#722ed1', bg: '#f9f0ff', border: '#d3adf7' }
                        return <span key={ti} style={{ padding: '1px 8px', borderRadius: 10, background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`, fontSize: 10 }}>{t}</span>
                      })}
                      <span style={{ padding: '1px 6px', borderRadius: 10, border: '1px dashed #bbb', color: '#888', fontSize: 10 }}>+ 编辑</span>
                    </div>
                  </td>
                  <td style={{ ...td, fontSize: 11, color: '#999' }}>{r.create_date ? new Date(r.create_date).toLocaleDateString('zh-CN') : '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <button onClick={() => setPage(1)} disabled={page === 1} style={{ padding: '4px 10px', border: '1px solid #ddd', borderRadius: 4, background: page === 1 ? '#f5f5f5' : '#fff', cursor: page === 1 ? 'not-allowed' : 'pointer', fontSize: 12 }}>首页</button>
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: '4px 10px', border: '1px solid #ddd', borderRadius: 4, background: page === 1 ? '#f5f5f5' : '#fff', cursor: page === 1 ? 'not-allowed' : 'pointer', fontSize: 12 }}>上一页</button>
        <span style={{ fontSize: 12, color: '#666' }}>第 {page} / {pages} 页</span>
        <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages} style={{ padding: '4px 10px', border: '1px solid #ddd', borderRadius: 4, background: page === pages ? '#f5f5f5' : '#fff', cursor: page === pages ? 'not-allowed' : 'pointer', fontSize: 12 }}>下一页</button>
        <button onClick={() => setPage(pages)} disabled={page === pages} style={{ padding: '4px 10px', border: '1px solid #ddd', borderRadius: 4, background: page === pages ? '#f5f5f5' : '#fff', cursor: page === pages ? 'not-allowed' : 'pointer', fontSize: 12 }}>末页</button>
        <select value={page} onChange={e => setPage(parseInt(e.target.value))} style={{ padding: '4px 6px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12 }}>
          {Array.from({ length: Math.min(pages, 100) }, (_, i) => i + 1).map(p => <option key={p} value={p}>第{p}页</option>)}
        </select>
      </div>

      {/* 详情弹窗 */}
      {tagEdit && <TagEditModal row={tagEdit} tagPool={tagPool} onClose={() => setTagEdit(null)} onSaved={() => { setTagEdit(null); load() }} />}
      {detail && (
        <div onClick={() => setDetail(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 600, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, color: '#2e5230' }}>{detail.shop_name}</h3>
              <button onClick={() => setDetail(null)} style={{ border: 'none', background: '#f5f5f5', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', fontSize: 16 }}>×</button>
            </div>
            {detail.shop_pic && <img src={detail.shop_pic} alt="店铺图片" style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 8, marginBottom: 16, border: '1px solid #e0e0e0' }} onError={e => e.target.style.display='none'} />}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13 }}>
              {[
                ['店铺ID', detail.siteshop_id],
                ['平台', detail.website_name],
                ['店铺编码', detail.shop_code],
                ['店主', detail.shop_owner],
                ['电话', detail.owner_tell],
                ['省份', detail.province],
                ['城市', detail.city],
                ['区县', detail.country],
                ['地址', detail.address],
                ['店铺等级', detail.shop_level],
                ['商品质量', detail.product_quality],
                ['物流速度', detail.logistics_speed],
                ['服务保障', detail.service_guarantee],
                ['综合体验', detail.comprehensive_experience],
                ['评论数', detail.comment_num],
                ['店铺类型', detail.shop_type],
                ['状态', STATUS_MAP[String(detail.is_used)] || '未知'],
                ['创建日期', detail.create_date ? new Date(detail.create_date).toLocaleString('zh-CN') : '-'],
              ].map(([k, v], i) => (
                <div key={i} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: '#888', minWidth: 70, fontSize: 12 }}>{k}:</span>
                  <span style={{ fontWeight: 500, fontSize: 12 }}>{v ?? '-'}</span>
                </div>
              ))}
            </div>
            {detail.description && <div style={{ marginTop: 12, padding: 10, background: '#f5f5f5', borderRadius: 8, fontSize: 12, color: '#555' }}><strong>主营业务:</strong> {detail.description}</div>}
          </div>
        </div>
      )}
    </div>
  )
}


function TagEditModal({ row, tagPool, onClose, onSaved }) {
  const initial = Array.isArray(row.tags) ? row.tags : []
  const [selected, setSelected] = useState(new Set(initial))
  const [saving, setSaving] = useState(false)

  const toggle = (name) => {
    const n = new Set(selected)
    if (n.has(name)) n.delete(name); else n.add(name)
    setSelected(n)
  }

  const save = async () => {
    setSaving(true)
    try {
      await fetch('http://100.96.54.109:8088/api/tags/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': '***REMOVED_API_KEY***' },
        body: JSON.stringify({ entity: 'supplier', ids: [row.siteshop_id], tags: [...selected], mode: 'set' })
      })
      onSaved()
    } catch (e) {
      alert('save failed: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 24, width: 480, maxHeight: '75vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: '#2e5230', fontSize: 15 }}>🏷️ 编辑标签 · {row.shop_name || row.siteshop_id}</h3>
          <button onClick={onClose} style={{ border: 'none', background: '#f5f5f5', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {tagPool.map(t => {
            const on = selected.has(t.name)
            return (
              <span key={t.name} onClick={() => toggle(t.name)} style={{ cursor: 'pointer', padding: '4px 10px', borderRadius: 12, fontSize: 12, background: on ? t.bg : '#fff', color: on ? t.color : '#888', border: `1px solid ${on ? t.border : '#ddd'}`, fontWeight: on ? 600 : 400 }}>
                {on ? '✓ ' : ''}{t.name}
              </span>
            )
          })}
          {tagPool.length === 0 && <span style={{ color: '#999', fontSize: 12 }}>标签池为空，请新增</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '6px 14px', border: '1px solid #ddd', background: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>取消</button>
          <button onClick={save} disabled={saving} style={{ padding: '6px 14px', border: 'none', background: '#3E7B5B', color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>{saving ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  )
}
