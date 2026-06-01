import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'

const STATUS_OPTIONS = ['全部','已完成','待签章','已下发','合同异常','待补资料']
const EDITABLE_STATUSES = ['已完成','待签章','已下发','合同异常','待补资料']
const STATUS_COLORS = {
  '已完成':{bg:'#e6fffb',c:'#13c2c2'}, '待签章':{bg:'#fff7e6',c:'#fa8c16'},
  '已下发':{bg:'#e6f7ff',c:'#1890ff'}, '合同异常':{bg:'#fff2f0',c:'#ff4d4f'},
  '待补资料':{bg:'#fffbe6',c:'#d4b106'},
}
const isImgUrl = (url) => /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(url)

const FileIcon = ({ name, size = 40 }) => {
  const ext = name?.split('.').pop()?.toLowerCase() || ''
  const info = {
    pdf:  { emoji: '\uD83D\uDCC4', label: 'PDF',  bg: '#fff1f0', color: '#ff4d4f' },
    doc:  { emoji: '\uD83D\uDCDD', label: 'DOC',  bg: '#e6f7ff', color: '#1890ff' },
    docx: { emoji: '\uD83D\uDCDD', label: 'DOCX', bg: '#e6f7ff', color: '#1890ff' },
  }[ext] || { emoji: '\uD83D\uDCCE', label: ext.toUpperCase(), bg: '#f5f5f5', color: '#666' }
  return (
    <div style={{ width: size, height: size, borderRadius: 6, background: info.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontWeight: 600, color: info.color, lineHeight: 1.2, border: '1px solid #e8e8e8', transition: 'transform 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
      <span style={{fontSize: size * 0.45}}>{info.emoji}</span>
      <span style={{fontSize: size * 0.22}}>{info.label}</span>
    </div>
  )
}

const truncate = (s, n) => s && s.length > n ? s.slice(0, n) + '...' : s

export default function SupplierList() {
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingIds, setSavingIds] = useState({})
  const [uploadingId, setUploadingId] = useState(null)
  const [pasteHoverId, setPasteHoverId] = useState(null)
  const [supplierFilter, setSupplierFilter] = useState('')
  const [supplierSuggestions, setSupplierSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [allSupplierNames, setAllSupplierNames] = useState([])
  const [productCounts, setProductCounts] = useState({})
  const supplierInputRef = useRef(null)
  const suggestionsRef = useRef(null)
  const [dragIndex, setDragIndex] = useState(null)
  const [dropTargetIndex, setDropTargetIndex] = useState(null)
  const [isSavingOrder, setIsSavingOrder] = useState(false)
  const [exporting, setExporting] = useState(false)
  const nav = useNavigate()
  const timer = useRef()
  const debounceTimers = useRef({})

  /* ========== 全屏图片预览模态框 ========== */
  const [previewModal, setPreviewModal] = useState(null)

  useEffect(() => {
    const handleKey = e => {
      if (!previewModal) return
      if (e.key === 'Escape') { setPreviewModal(null); return }
      if (e.key === 'ArrowLeft') goPrevModal()
      if (e.key === 'ArrowRight') goNextModal()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [previewModal])

  const goPrevModal = () => {
    setPreviewModal(p => p ? { ...p, index: (p.index - 1 + p.files.length) % p.files.length } : null)
  }
  const goNextModal = () => {
    setPreviewModal(p => p ? { ...p, index: (p.index + 1) % p.files.length } : null)
  }

  useEffect(() => {
    const handleGlobalPaste = (e) => {
      if (!pasteHoverId) return
      const { id, type: fileType } = pasteHoverId
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        const file = item.getAsFile()
        if (!file) continue
        const fileName = file.name || 'pasted_file'
        if (!/\.(pdf|doc|docx|xls|xlsx)$/i.test(fileName)) continue
        e.preventDefault()
        handleFileUpload(id, rf, fileType)
        break
      }
    }
    document.addEventListener('paste', handleGlobalPaste)
    return () => document.removeEventListener('paste', handleGlobalPaste)
  }, [pasteHoverId])

  const pasteFileName = (fileType) => {
    const now = new Date()
    const ts = String(now.getFullYear()) + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + '_' + String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0') + String(now.getSeconds()).padStart(2,'0')
    const names = { license: '营业执照', contract: '合同电子版', dispatch: '下发文件' }
    return (names[fileType] || '文件') + '_' + ts + '.png'
  }

  const load = async () => {
    setLoading(true)
    try {
      const p = {}; if (search) p.search = search; if (status) p.status = status
      const r = await api.get('/api/suppliers', { params: p })
      const data = r.data.suppliers || []; setItems(data)
      setAllSupplierNames([...new Set(data.map(s => s.name).filter(Boolean))])
    } catch (e) { console.error(e) }
    setLoading(false)
  }
  const loadProductCounts = async () => {
    try {
      const r = await api.get('/api/suppliers/product-stats');
      if (r.data && typeof r.data === 'object') setProductCounts(r.data);
      // Also store product-to-supplier lookup for unmatched shop_names
      // Create a map of supplier_name -> shop_name from items
      const items_ = items;
      if (items_.length > 0) {
        const missing = {};
        items_.forEach(sup => {
          if (sup.shop_name && r.data && r.data[sup.shop_name] !== undefined) return;
          if (sup.name && r.data && r.data[sup.name] !== undefined) {
            missing[sup.shop_name || sup.name] = r.data[sup.name];
          }
          // Also try partial match: check if any sellerName contains shop_name
          if (r.data && sup.shop_name) {
            for (const sellerName of Object.keys(r.data)) {
              if (sellerName.includes(sup.shop_name) || sup.shop_name.includes(sellerName)) {
                missing[sup.shop_name] = r.data[sellerName];
                break;
              }
            }
          }
        });
        if (Object.keys(missing).length > 0) {
          setProductCounts(prev => ({ ...prev, ...missing }));
        }
      }
    } catch (e) { console.error(e) }
  }

  useEffect(() => { load(); loadProductCounts() }, [])
  useEffect(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 300); return () => clearTimeout(timer.current) }, [search, status])

  const handleSupplierFilterChange = (value) => {
    setSupplierFilter(value)
    if (value.trim()) {
      const f = allSupplierNames.filter(n => n.toLowerCase().includes(value.toLowerCase()))
      setSupplierSuggestions(f); setShowSuggestions(f.length > 0)
    } else { setSupplierSuggestions([]); setShowSuggestions(false) }
  }
  const selectSupplier = (name) => { setSupplierFilter(name); setShowSuggestions(false) }
  useEffect(() => {
    const h = (e) => { if (suggestionsRef.current && !suggestionsRef.current.contains(e.target) && supplierInputRef.current && !supplierInputRef.current.contains(e.target)) setShowSuggestions(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const filteredItems = supplierFilter.trim() ? items.filter(item => (item.name && item.name.toLowerCase().includes(supplierFilter.toLowerCase())) || (item.shop_name && item.shop_name.toLowerCase().includes(supplierFilter.toLowerCase()))) : items

  const handleExport = async () => {
    setExporting(true)
    try {
      const X = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
      const d = filteredItems.map((r, i) => ({ '序号': i+1, '主体名称': r.name||'', '商家名称': r.shop_name||'', '状态': r.status||'', '联系人': r.contact?.name||'', '联系电话': r.contact?.phone||'', '微信号': r.contact?.wechat||'', '统一社会信用代码': r.company_info?.tax_id||'', '地址': r.company_info?.address||'', '主营业务': r.company_info?.main_business||'', '商品数': productCounts[r.shop_name] ?? productCounts[r.name] ?? r.product_count ?? 0, '营业执照': (r.license_files||[]).length, '合同电子版': (r.contract_files||[]).length, '下发文件': (r.dispatch_files||[]).length, '备注': r.notes||'', '更新时间': r.updatedAt?new Date(r.updatedAt).toLocaleDateString('zh-CN'):'' }))
      const ws = X.utils.json_to_sheet(d); ws['!cols'] = [{ wch:6 },{ wch:20 },{ wch:14 },{ wch:10 },{ wch:12 },{ wch:14 },{ wch:14 },{ wch:22 },{ wch:30 },{ wch:20 },{ wch:8 },{ wch:10 },{ wch:10 },{ wch:10 },{ wch:20 },{ wch:14 }]
      const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, '供应商列表'); X.writeFile(wb, '供应商列表_' + new Date().toISOString().slice(0,10) + '.xlsx')
    } catch (e) { console.error(e); alert('导出失败: ' + e.message) }
    setExporting(false)
  }
  const goProducts = (s) => { window.open('http://100.96.54.109:3001/#/?supplier_id=' + s._id, '_blank') }
  const handleDelete = async (e, id) => { e.stopPropagation(); if (!confirm('确认删除？')) return; await api.delete('/api/suppliers/' + id); load() }

  const updateItem = (rowId, field, value, extraFields) => {
    const sk = rowId + '_' + field; setSavingIds(p => ({ ...p, [sk]: true }))
    const item = items.find(x => x._id === rowId); if (!item) return
    let ud = {}
    if (field === 'name') ud = { name: value }
    else if (field === 'shop_name') ud = { shop_name: value, ...extraFields }
    else if (field === 'status') ud = { status: value }
    else if (field === 'notes') ud = { notes: value }
    else if (field === 'contact_name') ud = { contact: { ...item.contact, name: value } }
    else if (field === 'contact_phone') ud = { contact: { ...item.contact, phone: value } }
    else if (field === 'tax_id') ud = { company_info: { ...item.company_info, tax_id: value } }
    const now = new Date().toISOString()
    setItems(p => p.map(x => {
      if (x._id !== rowId) return x
      if (field === 'contact_name') return { ...x, contact: { ...x.contact, name: value }, updatedAt: now }
      else if (field === 'contact_phone') return { ...x, contact: { ...x.contact, phone: value }, updatedAt: now }
      else if (field === 'tax_id') return { ...x, company_info: { ...x.company_info, tax_id: value }, updatedAt: now }
      else if (field === 'shop_name') return { ...x, shop_name: value, ...extraFields, updatedAt: now }
      else return { ...x, [field]: value, updatedAt: now }
    }))
    clearTimeout(debounceTimers.current[sk])
    debounceTimers.current[sk] = setTimeout(() => { api.put('/api/suppliers/' + rowId, ud).catch(e => console.error(e)).finally(() => { setSavingIds(p => { const n = { ...p }; delete n[sk]; return n }) }) }, 500)
  }

  const handleShopNameChange = (rowId, newName) => {
    updateItem(rowId, 'shop_name', newName, {})
    if (newName.trim()) {
      clearTimeout(debounceTimers.current[rowId + '_shop'])
      debounceTimers.current[rowId + '_shop'] = setTimeout(async () => {
        try {
          const r = await api.get('/api/suppliers/product-stats', { params: { names: newName } })
          if (r.data && typeof r.data === 'object') {
            setProductCounts(prev => ({ ...prev, ...r.data }))
          }
        } catch (e) { console.error(e) }
      }, 600)
    }
  }

  /* 图片压缩：限制 4MB 以内 */
  const compressImage = async (file) => {
    if (!file.type.startsWith('image/')) return file
    const limit = 4 * 1024 * 1024
    if (file.size <= limit) return file
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let { width, height } = img
        if (width > 1920) { height = height * 1920 / width; width = 1920 }
        canvas.width = width; canvas.height = height
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height)
        const tryCompress = (q) => {
          canvas.toBlob((blob) => {
            if (blob.size <= limit || q <= 0.15) resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
            else tryCompress(q - 0.1)
          }, 'image/jpeg', q)
        }
        tryCompress(0.8)
      }
      img.src = URL.createObjectURL(file)
    })
  }

  /* 删除已上传文件 */
  const handleFileRemove = async (supplierId, fileType, index) => {
    const fm = { license: 'license_files', contract: 'contract_files', dispatch: 'dispatch_files' }
    const field = fm[fileType]
    const newFiles = [...(items.find(x => x._id === supplierId)?.[field] || [])]
    newFiles.splice(index, 1)
    setItems(p => p.map(x => x._id !== supplierId ? x : { ...x, [field]: newFiles, updatedAt: new Date().toISOString() }))
    try { await api.put('/api/suppliers/' + supplierId, { [field]: newFiles }) } catch (e) { console.error(e) }
  }

  const handleFileUpload = async (supplierId, file, fileType) => {
    setUploadingId(supplierId)
    try {
      const compressed = await compressImage(file)
      const fd = new FormData(); fd.append('file', compressed); fd.append('supplier_id', supplierId); fd.append('type', fileType)
      const res = await api.post('/api/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const nf = { name: file.name, url: res.data.url || res.data.file_url }
      const fm = { license: 'license_files', contract: 'contract_files', dispatch: 'dispatch_files' }
      const field = fm[fileType]
      const newFiles = [...((items.find(x => x._id === supplierId)?.[field]) || []), nf]
      setItems(p => p.map(x => x._id !== supplierId ? x : { ...x, [field]: newFiles, updatedAt: new Date().toISOString() }))
      await api.put('/api/suppliers/' + supplierId, { [field]: newFiles })
    } catch (e) { console.error(e); alert('上传失败: ' + (e.response?.data?.error || e.message)) }
    setUploadingId(null)
  }
  const triggerUpload = (supplierId, fileType) => {
    const inp = document.createElement('input'); inp.type = 'file'
    inp.accept = fileType === 'license' ? '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.bmp' : '.pdf,.doc,.docx,.xls,.xlsx'
    inp.onchange = async (e) => { if (e.target.files?.[0]) { const c = await compressImage(e.target.files[0]); handleFileUpload(supplierId, c, fileType) } }; inp.click()
  }

  /* ── 拖拽排序 ── */
  const handleDragStart = (e, index) => { setDragIndex(index); setDropTargetIndex(index); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.style.opacity = '0.4' }
  const handleDragEnd = (e) => { e.currentTarget.style.opacity = '1'; if (dragIndex !== null && dropTargetIndex !== null && dragIndex !== dropTargetIndex) { const newItems = [...items]; const [m] = newItems.splice(dragIndex, 1); newItems.splice(dropTargetIndex, 0, m); setItems(newItems); saveOrder(newItems) }; setDragIndex(null); setDropTargetIndex(null) }
  const handleDragOver = (e, index) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropTargetIndex !== index) setDropTargetIndex(index) }
  const saveOrder = async (orderedItems) => { setIsSavingOrder(true); try { const orders = orderedItems.map((item, i) => ({ id: item._id, sortOrder: (i + 1) * 10 })); await api.post('/api/suppliers/reorder', { orders }) } catch (e) { console.error(e); alert('排序保存失败，请重试'); load() }; setIsSavingOrder(false) }

  /* ========== renderFiles - 文件预览 + 上传按钮（统一风格） ========== */
  const renderFiles = (files, fileType, r) => {
    const isActive = pasteHoverId && pasteHoverId.id === r._id && pasteHoverId.type === fileType
    const uploading = uploadingId === r._id
    const label = { license: '营业执照', contract: '合同电子版', dispatch: '下发文件' }[fileType]
    const safeFiles = files || []
    const sz = 44

    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', minWidth: 120, padding: '2px 0', overflow: 'visible' }}>
        {/* 已有文件展示 */}
        {safeFiles.map((f, i) => (
          <div key={i} style={{ position: 'relative', flexShrink: 0 }}
            title={f.name + ' (点击打开)'} style={{position:'relative',flexShrink:0,zIndex:1}}>
            <a href={f.url} target='_blank' rel='noreferrer'
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'inline-flex', textDecoration: 'none' }}>
              {isImgUrl(f.url) ? (
                <img src={f.url} alt={f.name}
                  style={{ width: sz, height: sz, objectFit: 'contain', borderRadius: 4, border: '1px solid #d9d9d9', display: 'block', background: '#fff' }}
                  onError={(e) => { e.target.src = ''; e.target.style.background = '#f5f5f5'; e.target.style.display = 'block'; e.target.style.border = '2px dashed #ff4d4f'; }} />
              ) : (
                <FileIcon name={f.name} size={sz} />
              )}
            </a>
            <button
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleFileRemove(r._id, fileType, i) }}
              style={{
                position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%',
                border: 'none', background: '#e74c3c', color: '#fff', fontSize: 10, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0, zIndex: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
              }}>×</button>
          </div>
        ))}
        {/* + 上传框 - 始终显示 */}
        <div onMouseEnter={() => setPasteHoverId({ id: r._id, type: fileType })}
             onMouseLeave={() => setPasteHoverId(null)}
             onClick={(e) => { e.stopPropagation();
               const inp = document.createElement('input'); inp.type = 'file';
               inp.accept = fileType === 'license' ? '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.bmp' : '.pdf,.doc,.docx,.xls,.xlsx';
               inp.onchange = (ev) => { if (ev.target.files?.[0]) handleFileUpload(r._id, ev.target.files[0], fileType); };
               inp.click();
             }}
             onMouseDown={(e) => e.stopPropagation()}
          style={{
            width: sz, height: sz, border: isActive ? '2px dashed #1890ff' : '2px dashed #999',
            borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', fontSize: 9, color: isActive ? '#1890ff' : '#999',
            cursor: 'pointer', transition: 'all 0.15s', userSelect: 'none', flexShrink: 0,
            background: isActive ? '#e6f7ff' : 'transparent', lineHeight: 1.2
          }}
          onMouseEnter={e => { if (!isActive) { e.currentTarget.style.borderColor = '#1890ff'; e.currentTarget.style.color = '#1890ff'; e.currentTarget.style.background = '#f0f7ff' } }}
          onMouseLeave={e => { if (!isActive) { e.currentTarget.style.borderColor = '#999'; e.currentTarget.style.color = '#999'; e.currentTarget.style.background = 'transparent' } }}>
          {uploading ? (
            <span style={{ fontSize: 11, color: '#fa8c16' }}>⏳</span>
          ) : (
            <>
              <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
              <span>{isActive ? '粘贴' : '上传'}</span>
            </>
          )}
        </div>
      </div>
    )
  }

  const fmt = (d) => d ? new Date(d).toLocaleDateString('zh-CN') : '-'
  const stats = [
    { label: '总供应商', value: filteredItems.length, color: '#1890ff' },
    { label: '已完成', value: filteredItems.filter(x => x.status === '已完成').length, color: '#13c2c2' },
    { label: '待签章', value: filteredItems.filter(x => x.status === '待签章').length, color: '#fa8c16' },
    { label: '合同异常', value: filteredItems.filter(x => x.status === '合同异常').length, color: '#ff4d4f' },
  ]

  const inputStyle = { width: '100%', padding: '4px 6px', border: '1px solid #e8e8e8', borderRadius: 4, fontSize: 12, background: '#fff', outline: 'none' }

  return (
    <div style={{padding:12,background:'#f5f5f5',minHeight:'calc(100vh - 48px)'}}>
      <div style={{display:'flex',gap:12,marginBottom:12}}>{stats.map((s, i) => (
        <div key={i} style={{flex:1,background:'#fff',borderRadius:8,padding:'12px 20px',boxShadow:'0 1px 4px rgba(0,0,0,0.05)'}}>
          <div style={{fontSize:12,color:'#888'}}>{s.label}</div>
          <div style={{fontSize:24,fontWeight:700,color:s.color}}>{s.value}</div>
        </div>
      ))}</div>

      <div style={{display:'flex',gap:8,marginBottom:8,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{position:'relative'}}>
          <input ref={supplierInputRef} value={supplierFilter} onChange={e => handleSupplierFilterChange(e.target.value)}
            onFocus={() => { if (supplierFilter.trim()) { const f = allSupplierNames.filter(n => n.toLowerCase().includes(supplierFilter.toLowerCase())); if (f.length > 0) { setSupplierSuggestions(f); setShowSuggestions(true) } }}}
            placeholder='筛选主体/商家名称' style={{padding:'6px 10px',border:'1px solid #d9d9d9',borderRadius:4,width:220,fontSize:13}} />
          {supplierFilter && <button onClick={() => { setSupplierFilter(''); setSupplierSuggestions([]); setShowSuggestions(false) }} style={{position:'absolute',right:6,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',fontSize:14,color:'#999',padding:0,lineHeight:1}}>x</button>}
          {showSuggestions && <div ref={suggestionsRef} style={{position:'absolute',top:'100%',left:0,zIndex:1000,background:'#fff',border:'1px solid #d9d9d9',borderRadius:4,maxHeight:200,overflowY:'auto',width:280,boxShadow:'0 4px 12px rgba(0,0,0,0.15)'}}>
            {supplierSuggestions.map((name, i) => <div key={i} onClick={() => selectSupplier(name)} onMouseDown={e=>e.preventDefault()}
              style={{padding:'6px 10px',fontSize:12,cursor:'pointer',borderBottom:'1px solid #f0f0f0',background:'#fff'}}
              onMouseEnter={e=>e.currentTarget.style.background='#e6f7ff'} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>{name}</div>)}
          </div>}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder='搜索联系人 / 税号 / 备注' style={{padding:'6px 10px',border:'1px solid #d9d9d9',borderRadius:4,width:220,fontSize:13}} />
        <select value={status} onChange={e => setStatus(e.target.value)} style={{padding:'5px 8px',border:'1px solid #d9d9d9',borderRadius:4,fontSize:12}}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s === '全部' ? '' : s}>{s === '全部' ? '全部状态' : s}</option>)}
        </select>
        <span style={{fontSize:12,color:'#888'}}>共 {filteredItems.length} 家{(supplierFilter || search || status) ? '（已筛选）' : ''}</span>
        {isSavingOrder && <span style={{fontSize:12,color:'#fa8c16'}}>排序中...</span>}
        <div style={{flex:1}} />
        <button onClick={handleExport} disabled={exporting || filteredItems.length === 0}
          style={{padding:'5px 14px',background:exporting?'#d9d9d9':'#52c41a',color:'#fff',border:'none',borderRadius:4,cursor:exporting?'not-allowed':'pointer',fontSize:12,fontWeight:500}}>
          {exporting ? '导出中...' : '导出Excel'}
        </button>
        <button onClick={() => nav('/suppliers/new')} style={{padding:'5px 12px',background:'#1a1a2e',color:'#fff',border:'none',borderRadius:4,cursor:'pointer',fontSize:12}}>+ 新增供应商</button>
      </div>

      <div style={{overflow:'auto',background:'#fff',borderRadius:8,boxShadow:'0 1px 4px rgba(0,0,0,0.05)',maxHeight:'calc(100vh - 260px)'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr style={{background:'#f7f7f7',position:'sticky',top:0,zIndex:1}}>
            <th style={{...th,width:36,textAlign:'center'}}>{String.fromCharCode(0x2630)}</th>
            <th style={th}>主体名称</th>
            <th style={{...th,width:120}}>商家名称</th>
            <th style={{...th,width:90}}>状态</th>
            <th style={{...th,width:90}}>联系人</th>
            <th style={{...th,width:110}}>联系电话</th>
            <th style={{...th,width:150}}>社会统一识别码</th>
            <th style={{...th,width:140}}>营业执照</th>
            <th style={{...th,width:140}}>合同电子版</th>
            <th style={{...th,width:120}}>下发文件</th>
            <th style={{...th,width:60}}>商品数</th>
            <th style={{...th,width:130}}>备注</th>
            <th style={{...th,width:110}}>更新时间</th>
            <th style={{...th,width:70}}>操作</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={14} style={{textAlign:'center',padding:24,color:'#888'}}>加载中...</td></tr>
            : filteredItems.length === 0 ? <tr><td colSpan={14} style={{textAlign:'center',padding:24,color:'#888'}}>{(supplierFilter || search || status) ? '没有匹配的供应商' : '暂无数据'}</td></tr>
            : filteredItems.map((r, i) => {
              const sc = STATUS_COLORS[r.status] || STATUS_COLORS['待签章']
              const saving = (field) => savingIds[r._id + '_' + field]
              const isDragging = dragIndex === i
              const isDropTarget = dropTargetIndex === i && dragIndex !== i
              let rowBg = i%2===0?'#fff':'#fafcff'
              if (isDragging) rowBg = '#e6f7ff'
              if (isDropTarget) rowBg = '#fffbe6'
              return (
                <tr key={r._id} draggable onDragStart={(e) => handleDragStart(e, i)} onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, i)} onDrop={(e) => { e.preventDefault() }}
                  style={{borderBottom:'1px solid #f0f0f0',background:rowBg,height:44,cursor:'grab',opacity:isDragging?0.5:1,boxShadow:isDropTarget?'0 -2px 0 0 #1890ff inset':'none'}}
                  onMouseEnter={e => { if(!isDragging) e.currentTarget.style.background='#f0f7ff' }}
                  onMouseLeave={e => { if(!isDragging) e.currentTarget.style.background=i%2===0?'#fff':'#fafcff' }}>
                  <td style={{...td,textAlign:'center',padding:'2px 4px',color:'#bbb',fontSize:16,cursor:'grab'}} title='拖拽调整排序'>{String.fromCharCode(0x2630)}</td>
                  <td style={td}><strong>{saving('name') && ' '}<input value={r.name} onChange={e => updateItem(r._id,'name',e.target.value)} style={inputStyle} onClick={e=>e.stopPropagation()} /></strong></td>
                  <td style={td}>{saving('shop_name') && ' '}<input value={r.shop_name||''} onChange={e => { handleShopNameChange(r._id, e.target.value) }} style={inputStyle} placeholder='手动输入商家名称' onClick={e=>e.stopPropagation()} /></td>
                  <td style={td}>{saving('status') && ' '}<select value={r.status} onChange={e => updateItem(r._id,'status',e.target.value)} onClick={e=>e.stopPropagation()} style={{width:'100%',padding:'3px 6px',border:'none',borderRadius:10,fontSize:11,background:sc.bg,color:sc.c,cursor:'pointer',outline:'none'}}>{EDITABLE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></td>
                  <td style={{...td,fontSize:11}}>{saving('contact_name') && ' '}<input value={r.contact?.name||''} onChange={e => updateItem(r._id,'contact_name',e.target.value)} style={{...inputStyle,fontSize:11}} onClick={e=>e.stopPropagation()} /></td>
                  <td style={{...td,fontSize:11,color:'#666'}}>{saving('contact_phone') && ' '}<input value={r.contact?.phone||''} onChange={e => updateItem(r._id,'contact_phone',e.target.value)} style={{...inputStyle,fontSize:11}} onClick={e=>e.stopPropagation()} /></td>
                  <td style={{...td,fontSize:11}}>{saving('tax_id') && ' '}<input value={r.company_info?.tax_id||''} onChange={e => updateItem(r._id,'tax_id',e.target.value)} style={{...inputStyle,fontSize:11,fontFamily:'monospace'}} placeholder='统一识别码' onClick={e=>e.stopPropagation()} /></td>
                  <td style={td}>{renderFiles(r.license_files||[],'license',r)}</td>
                  <td style={td}>{renderFiles(r.contract_files||[],'contract',r)}</td>
                  <td style={td}>{renderFiles(r.dispatch_files||[],'dispatch',r)}</td>
                  <td style={{...td,textAlign:'center',fontWeight:600,fontSize:13}}>{productCounts[r.shop_name] ?? productCounts[r.name] ?? r.product_count ?? 0}</td>
                  <td style={td}>{saving('notes') && ' '}<input value={r.notes||''} onChange={e => updateItem(r._id,'notes',e.target.value)} style={inputStyle} placeholder='备注' onClick={e=>e.stopPropagation()} /></td>
                  <td style={{...td,fontSize:11,color:'#999'}}>{fmt(r.updatedAt)}</td>
                  <td style={td}>
                    <button onClick={e=>{e.stopPropagation();window.open("http://100.96.54.109:3006/"+"?supplierId="+r._id+"&name="+encodeURIComponent(r.name),"_blank")}} style={{padding:"3px 8px",border:"1px solid #52c41a",background:"#f6ffed",color:"#52c41a",borderRadius:4,cursor:"pointer",fontSize:11,marginRight:4}}>合同</button><button onClick={e=>{e.stopPropagation();goProducts(r)}} onMouseDown={e=>e.stopPropagation()} style={{padding:'3px 8px',border:'1px solid #1890ff',background:'#e6f7ff',color:'#1890ff',borderRadius:4,cursor:'pointer',fontSize:11,marginRight:4}}>商品</button>
                    <button onClick={e=>handleDelete(e,r._id)} onMouseDown={e=>e.stopPropagation()} style={{padding:'2px 6px',border:'none',borderRadius:4,cursor:'pointer',fontSize:14,background:'transparent'}}>{String.fromCharCode(0x1f5d1)}</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:8,fontSize:11,color:'#999',textAlign:'center'}}>直接在输入框中修改自动保存 | {String.fromCharCode(0x2630)} 拖拽排序 | 导出Excel | 商家名称手动输入后自动查询商品数</div>

      {/* ── 全屏预览模态框 ── */}
      {previewModal && (
        <div onClick={() => setPreviewModal(null)}
          style={{ position:'fixed', top:0, left:0, right:0, bottom:0, zIndex:9999, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          {previewModal.files.length > 1 && (
            <span onClick={e => { e.stopPropagation(); goPrevModal(); }}
              style={{ position:'absolute', left:20, top:'50%', transform:'translateY(-50%)', width:44, height:44, borderRadius:'50%', background:'rgba(255,255,255,0.2)', color:'#fff', fontSize:22, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', userSelect:'none', zIndex:10000 }}>&lsaquo;</span>
          )}
          {previewModal.files[previewModal.index] && (
            <img src={previewModal.files[previewModal.index].url} alt=""
              onClick={e => e.stopPropagation()}
              style={{ maxWidth:'80vw', maxHeight:'85vh', borderRadius:8, objectFit:'contain', boxShadow:'0 4px 40px rgba(0,0,0,0.5)' }} />
          )}
          {previewModal.files.length > 1 && (
            <span onClick={e => { e.stopPropagation(); goNextModal(); }}
              style={{ position:'absolute', right:20, top:'50%', transform:'translateY(-50%)', width:44, height:44, borderRadius:'50%', background:'rgba(255,255,255,0.2)', color:'#fff', fontSize:22, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', userSelect:'none', zIndex:10000 }}>&rsaquo;</span>
          )}
          <span onClick={() => setPreviewModal(null)}
            style={{ position:'absolute', top:16, right:20, color:'#fff', fontSize:26, cursor:'pointer', lineHeight:1, zIndex:10000 }}>&#x2715;</span>
          <div style={{ position:'absolute', bottom:20, left:'50%', transform:'translateX(-50%)', color:'rgba(255,255,255,0.7)', fontSize:13, background:'rgba(0,0,0,0.5)', padding:'4px 14px', borderRadius:20 }}>
            {previewModal.title} &middot; {previewModal.index + 1} / {previewModal.files.length}
          </div>
        </div>
      )}
    </div>
  )
}
const th = {padding:'6px 8px',borderBottom:'2px solid #e8e8e8',fontWeight:600,fontSize:11,color:'#555',whiteSpace:'nowrap',position:'sticky',top:0,background:'#f7f7f7',userSelect:'none',textAlign:'left'}
const td = {padding:'4px 6px',borderBottom:'1px solid #f0f0f0',fontSize:12,verticalAlign:'middle',overflow:'visible',height:66,minHeight:66}