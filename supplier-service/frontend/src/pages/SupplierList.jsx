import { useState, useEffect, useRef } from 'react'
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
const emptyBusinessItem = () => ({ main_business: '', address: '', planting_area: '', estimated_inventory: '', sales_period: '' })
const normalizeBusinessItems = (supplier = {}) => {
  const arr = Array.isArray(supplier.business_items) ? supplier.business_items : []
  const normalized = arr.map(item => ({
    main_business: item?.main_business || '',
    address: item?.address || '',
    planting_area: item?.planting_area ?? '',
    estimated_inventory: item?.estimated_inventory ?? '',
    sales_period: Array.isArray(item?.sales_period) ? item.sales_period.join('、') : (item?.sales_period || ''),
  }))
  const hasLegacy = supplier.company_info?.main_business || supplier.address || supplier.planting_area || supplier.estimated_inventory || (supplier.sales_period || []).length
  if (!normalized.length && hasLegacy) {
    normalized.push({
      main_business: supplier.company_info?.main_business || '',
      address: supplier.address || '',
      planting_area: supplier.planting_area ?? '',
      estimated_inventory: supplier.estimated_inventory ?? '',
      sales_period: Array.isArray(supplier.sales_period) ? supplier.sales_period.join('、') : (supplier.sales_period || ''),
    })
  }
  return normalized.length ? normalized : [emptyBusinessItem()]
}
const cleanBusinessItems = (items) => (items || [])
  .map(item => ({
    main_business: (item.main_business || '').trim(),
    address: (item.address || '').trim(),
    planting_area: item.planting_area === '' || item.planting_area === null || item.planting_area === undefined || !Number.isFinite(Number(item.planting_area)) ? null : Number(item.planting_area),
    estimated_inventory: item.estimated_inventory === '' || item.estimated_inventory === null || item.estimated_inventory === undefined || !Number.isFinite(Number(item.estimated_inventory)) ? null : Number(item.estimated_inventory),
    sales_period: (item.sales_period || '').trim(),
  }))
  .filter(item => item.main_business || item.address || item.planting_area !== null || item.estimated_inventory !== null || item.sales_period)
const businessSummary = (supplier) => cleanBusinessItems(normalizeBusinessItems(supplier))

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
  const timer = useRef()
  const debounceTimers = useRef({})

  /* ========== 选择状态 ========== */
  const [selectedIds, setSelectedIds] = useState(new Set())
  const allFilteredIds = items.map(r => r._id)
  const isAllSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.has(id))

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      if (isAllSelected) {
        // 取消全选
        const next = new Set(prev)
        allFilteredIds.forEach(id => next.delete(id))
        return next
      } else {
        // 全选
        const next = new Set(prev)
        allFilteredIds.forEach(id => next.add(id))
        return next
      }
    })
  }
  const clearSelection = () => setSelectedIds(new Set())

  /* ========== 批量删除 ========== */
  const [batchDeleting, setBatchDeleting] = useState(false)
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) { alert('请先选择要删除的记录'); return }
    if (!confirm(`确认删除选中的 ${selectedIds.size} 条记录？此操作不可恢复。`)) return
    setBatchDeleting(true)
    try {
      await api.post('/api/suppliers/batch-delete', { ids: Array.from(selectedIds) })
      setSelectedIds(new Set())
      load()
    } catch (e) { alert('批量删除失败: ' + (e.response?.data?.error || e.message)) }
    setBatchDeleting(false)
  }

  /* ========== 批量导出（仅选中项） ========== */
  const handleBatchExport = async () => {
    const exportItems = selectedIds.size > 0
      ? items.filter(r => selectedIds.has(r._id))
      : items
    if (exportItems.length === 0) { alert('没有可导出的数据'); return }
    setExporting(true)
    try {
      const X = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
      const d = exportItems.map((r, i) => ({
        '序号': i+1,
        '主体名称': r.name||'',
        '商家名称': r.shop_name||'',
        '状态': r.status||'',
        '联系人': (r.contacts&&r.contacts.length?r.contacts:[r.contact||{}]).map(c=>[c.name,c.title,c.phone].filter(Boolean).join('/')).filter(Boolean).join('; '),
        '联系电话': (r.contacts&&r.contacts.length?r.contacts:[r.contact||{}]).map(c=>c.phone).filter(Boolean).join('; '),
        '微信号': r.contact?.wechat||'',
        '税号': r.company_info?.tax_id||'',
        '公司地址': r.company_info?.address||'',
        '主营业务': businessSummary(r).map(x => x.main_business).filter(Boolean).join('; '),
        '经营/种植地址': businessSummary(r).map(x => x.address).filter(Boolean).join('; '),
        '种植面积(亩)': businessSummary(r).map(x => x.planting_area ?? '').filter(x => x !== '').join('; '),
        '预估总库存(株/棵)': businessSummary(r).map(x => x.estimated_inventory ?? '').filter(x => x !== '').join('; '),
        '销售期': businessSummary(r).map(x => x.sales_period).filter(Boolean).join('; '),
        '经度': r.longitude || '',
        '纬度': r.latitude || '',
        '商品数': productCounts[r.shop_name] ?? productCounts[r.name] ?? r.product_count ?? 0,
        '营业执照': (r.license_files||[]).length,
        '合同电子版': (r.contract_files||[]).length,
        '下发文件': (r.dispatch_files||[]).length,
        '备注': r.notes||'',
        '更新时间': r.updatedAt ? new Date(r.updatedAt).toLocaleDateString('zh-CN') : ''
      }))
      const ws = X.utils.json_to_sheet(d)
      ws['!cols'] = [
        {wch:6},{wch:20},{wch:14},{wch:10},{wch:12},{wch:14},{wch:14},
        {wch:22},{wch:30},{wch:20},{wch:20},{wch:12},{wch:16},{wch:16},
        {wch:10},{wch:10},{wch:8},{wch:10},{wch:10},{wch:10},{wch:20},{wch:14}
      ]
      const wb = X.utils.book_new()
      X.utils.book_append_sheet(wb, ws, '供应商列表')
      const label = selectedIds.size > 0 ? '供应商列表_选中' : '供应商列表'
      X.writeFile(wb, label + '_' + new Date().toISOString().slice(0,10) + '.xlsx')
    } catch (e) { console.error(e); alert('导出失败: ' + e.message) }
    setExporting(false)
  }

  /* ========== 新增行 ========== */
  const [showNewRow, setShowNewRow] = useState(false)
  const [newRowSaving, setNewRowSaving] = useState(false)
  const [newRow, setNewRow] = useState({
    name: '', shop_name: '', status: '待签章',
    contact_name: '', contact_phone: '',
    tax_id: '', company_address: '',
    business_items: [emptyBusinessItem()],
    longitude: '', latitude: '', notes: ''
  })

  const handleNewRowSave = async () => {
    if (!newRow.name.trim()) { alert('主体名称不能为空'); return }
    setNewRowSaving(true)
    try {
      const payload = {
        name: newRow.name.trim(),
        status: newRow.status,
        shop_name: newRow.shop_name.trim() || undefined,
        contact: { name: newRow.contact_name.trim(), phone: newRow.contact_phone.trim() },
        contacts: newRow.contact_name.trim() ? [{ name: newRow.contact_name.trim(), phone: newRow.contact_phone.trim(), title: '', gender: '' }] : [],
        company_info: {
          tax_id: newRow.tax_id.trim(),
          address: newRow.company_address.trim(),
          main_business: cleanBusinessItems(newRow.business_items).map(x => x.main_business).filter(Boolean).join('；')
        },
        business_items: cleanBusinessItems(newRow.business_items),
        address: cleanBusinessItems(newRow.business_items)[0]?.address || '',
        planting_area: cleanBusinessItems(newRow.business_items)[0]?.planting_area ?? null,
        estimated_inventory: cleanBusinessItems(newRow.business_items)[0]?.estimated_inventory ?? null,
        sales_period: cleanBusinessItems(newRow.business_items).map(x => x.sales_period).filter(Boolean),
        longitude: newRow.longitude ? Number(newRow.longitude) : null,
        latitude: newRow.latitude ? Number(newRow.latitude) : null,
        notes: newRow.notes.trim() || undefined,
        sortOrder: -Math.abs(Date.now())
      }
      const r = await api.post('/api/suppliers', payload)
      setItems(prev => [r.data, ...prev])
      setShowNewRow(false)
      setNewRow({
        name: '', shop_name: '', status: '待签章',
        contact_name: '', contact_phone: '',
        tax_id: '', company_address: '',
        business_items: [emptyBusinessItem()],
        longitude: '', latitude: '', notes: ''
      })
      load()
    } catch (e) { alert('创建失败: ' + (e.response?.data?.error || e.message)) }
    setNewRowSaving(false)
  }

  const handleNewRowCancel = () => {
    setShowNewRow(false)
    setNewRow({
      name: '', shop_name: '', status: '待签章',
      contact_name: '', contact_phone: '',
      tax_id: '', company_address: '',
      business_items: [emptyBusinessItem()],
      longitude: '', latitude: '', notes: ''
    })
  }

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
      const cItems = e.clipboardData?.items
      if (!cItems) return
      for (const item of cItems) {
        const file = item.getAsFile()
        if (!file) continue
        const fileName = file.name || 'pasted_file'
        if (!/\.(pdf|doc|docx|xls|xlsx)$/i.test(fileName)) continue
        e.preventDefault()
        handleFileUpload(id, file, fileType)
        break
      }
    }
    document.addEventListener('paste', handleGlobalPaste)
    return () => document.removeEventListener('paste', handleGlobalPaste)
  }, [pasteHoverId])

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
    else if (field === 'company_address') ud = { company_info: { ...item.company_info, address: value } }
    else if (field === 'main_business') ud = { company_info: { ...item.company_info, main_business: value } }
    else if (field === 'address') ud = { address: value }
    else if (field === 'planting_area') ud = { planting_area: value ? Number(value) : null }
    else if (field === 'estimated_inventory') ud = { estimated_inventory: value ? Number(value) : null }
    else if (field === 'sales_period') ud = { sales_period: value }
    else if (field === 'longitude') ud = { longitude: value ? Number(value) : null }
    else if (field === 'latitude') ud = { latitude: value ? Number(value) : null }
    const now = new Date().toISOString()
    setItems(p => p.map(x => {
      if (x._id !== rowId) return x
      if (field === 'contact_name') return { ...x, contact: { ...x.contact, name: value }, updatedAt: now }
      if (field === 'contact_phone') return { ...x, contact: { ...x.contact, phone: value }, updatedAt: now }
      if (field === 'tax_id') return { ...x, company_info: { ...x.company_info, tax_id: value }, updatedAt: now }
      if (field === 'company_address') return { ...x, company_info: { ...x.company_info, address: value }, updatedAt: now }
      if (field === 'main_business') return { ...x, company_info: { ...x.company_info, main_business: value }, updatedAt: now }
      if (field === 'shop_name') return { ...x, shop_name: value, ...extraFields, updatedAt: now }
      if (['address','planting_area','estimated_inventory','longitude','latitude'].includes(field)) return { ...x, [field]: value, updatedAt: now }
      if (field === 'sales_period') return { ...x, sales_period: value, updatedAt: now }
      return { ...x, [field]: value, updatedAt: now }
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

  /* ── 拖拽排序 ── */
  const handleDragStart = (e, index) => { setDragIndex(index); setDropTargetIndex(index); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.style.opacity = '0.4' }
  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1'
    if (dragIndex !== null && dropTargetIndex !== null && dragIndex !== dropTargetIndex) {
      const newItems = [...items]; const [m] = newItems.splice(dragIndex, 1); newItems.splice(dropTargetIndex, 0, m)
      setItems(newItems); saveOrder(newItems)
    }
    setDragIndex(null); setDropTargetIndex(null)
  }
  const handleDragOver = (e, index) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropTargetIndex !== index) setDropTargetIndex(index) }
  const saveOrder = async (orderedItems) => {
    setIsSavingOrder(true)
    try {
      const orders = orderedItems.map((item, i) => ({ id: item._id, sortOrder: (i + 1) * 10 }))
      await api.post('/api/suppliers/reorder', { orders })
    } catch (e) { console.error(e); alert('排序保存失败，请重试'); load() }
    setIsSavingOrder(false)
  }

  /* ========== renderFiles - 文件预览 + 上传按钮 ========== */
  const renderFiles = (files, fileType, r) => {
    const isActive = pasteHoverId && pasteHoverId.id === r._id && pasteHoverId.type === fileType
    const uploading = uploadingId === r._id
    const safeFiles = files || []
    const sz = 44
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', minWidth: 120, padding: '2px 0', overflow: 'visible' }}>
        {safeFiles.map((f, i) => (
          <div key={i} style={{position:'relative',flexShrink:0,zIndex:1}} title={f.name + ' (点击打开)'}>
            <a href={f.url} target='_blank' rel='noreferrer' onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', textDecoration: 'none' }}>
              {isImgUrl(f.url) ? (
                <img src={f.url} alt={f.name} style={{ width: sz, height: sz, objectFit: 'contain', borderRadius: 4, border: '1px solid #d9d9d9', display: 'block', background: '#fff' }} onError={(e) => { e.target.src = ''; e.target.style.background = '#f5f5f5'; e.target.style.display = 'block'; e.target.style.border = '2px dashed #ff4d4f'; }} />
              ) : (<FileIcon name={f.name} size={sz} />)}
            </a>
            <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleFileRemove(r._id, fileType, i) }}
              style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', border: 'none', background: '#e74c3c', color: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0, zIndex: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>×</button>
          </div>
        ))}
        <div
          onMouseEnter={e => { setPasteHoverId({ id: r._id, type: fileType }); if (!isActive) { e.currentTarget.style.borderColor = '#1890ff'; e.currentTarget.style.color = '#1890ff'; e.currentTarget.style.background = '#f0f7ff' } }}
          onMouseLeave={e => { setPasteHoverId(null); if (!isActive) { e.currentTarget.style.borderColor = '#999'; e.currentTarget.style.color = '#999'; e.currentTarget.style.background = 'transparent' } }}
          onClick={(e) => { e.stopPropagation(); const inp = document.createElement('input'); inp.type = 'file'; inp.accept = fileType === 'license' ? '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.bmp' : '.pdf,.doc,.docx,.xls,.xlsx'; inp.onchange = (ev) => { if (ev.target.files?.[0]) handleFileUpload(r._id, ev.target.files[0], fileType); }; inp.click(); }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ width: sz, height: sz, border: isActive ? '2px dashed #1890ff' : '2px dashed #999', borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: isActive ? '#1890ff' : '#999', cursor: 'pointer', transition: 'all 0.15s', userSelect: 'none', flexShrink: 0, background: isActive ? '#e6f7ff' : 'transparent', lineHeight: 1.2 }}>
          {uploading ? (<span style={{ fontSize: 11, color: '#fa8c16' }}>⏳</span>) : (<><span style={{ fontSize: 14, lineHeight: 1 }}>+</span><span>{isActive ? '粘贴' : '上传'}</span></>)}
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

  const inputStyle = { width: '100%', padding: '4px 6px', border: '1px solid #e8e8e8', borderRadius: 4, fontSize: 12, background: '#fff', outline: 'none', transition:'all .15s' }
  const smallInputStyle = { width: '100%', padding: '2px 4px', border: '1px solid #e8e8e8', borderRadius: 4, fontSize: 11, background: '#fff', outline: 'none', transition:'all .15s' }

  const getContacts = (r) => {
    const arr = (r.contacts && r.contacts.length) ? r.contacts : (r.contact?.name || r.contact?.phone ? [{ name:r.contact?.name||'', phone:r.contact?.phone||'', title:'', gender:'' }] : [])
    return arr.length ? arr : [{ name:'', phone:'', title:'', gender:'' }]
  }
  const updateContacts = (rowId, contacts) => {
    const clean = contacts.map(c => ({ name:c.name||'', phone:c.phone||'', title:c.title||'', gender:c.gender||'' }))
    const primary = clean.find(c => c.name || c.phone) || { name:'', phone:'' }
    const now = new Date().toISOString()
    setItems(p => p.map(x => x._id !== rowId ? x : { ...x, contacts: clean, contact: { ...x.contact, name: primary.name || '', phone: primary.phone || '' }, updatedAt: now }))
    const sk = rowId + '_contacts'
    setSavingIds(p => ({ ...p, [sk]: true }))
    clearTimeout(debounceTimers.current[sk])
    debounceTimers.current[sk] = setTimeout(() => {
      api.put('/api/suppliers/' + rowId, { contacts: clean, contact: { name: primary.name || '', phone: primary.phone || '' } })
        .catch(e => console.error(e))
        .finally(() => setSavingIds(p => { const n={...p}; delete n[sk]; return n }))
    }, 500)
  }
  const updateContactField = (r, idx, field, value) => {
    const contacts = getContacts(r)
    contacts[idx] = { ...contacts[idx], [field]: value }
    updateContacts(r._id, contacts)
  }
  const addContact = (r) => updateContacts(r._id, [...getContacts(r), { name:'', phone:'', title:'', gender:'' }])
  const removeContact = (r, idx) => {
    const contacts = getContacts(r).filter((_, i) => i !== idx)
    updateContacts(r._id, contacts.length ? contacts : [{ name:'', phone:'', title:'', gender:'' }])
  }
  const renderContacts = (r) => {
    const contacts = getContacts(r)
    return <div style={{display:'flex',flexDirection:'column',gap:6,minWidth:260}}>
      {contacts.map((c, idx) => <div key={idx} style={{display:'grid',gridTemplateColumns:'58px 92px 72px 26px',gap:4,alignItems:'center',padding:'5px 6px',border:'1px solid #eaf0f6',borderRadius:8,background:'#fbfdff',boxShadow:'0 1px 2px rgba(15,23,42,.04)'}}>
        <input value={c.name||''} placeholder='姓名' onChange={e=>updateContactField(r,idx,'name',e.target.value)} onClick={e=>e.stopPropagation()} style={{...smallInputStyle,fontWeight:600,borderColor:'#dbeafe',background:'#fff'}} />
        <input value={c.phone||''} placeholder='电话' onChange={e=>updateContactField(r,idx,'phone',e.target.value)} onClick={e=>e.stopPropagation()} style={{...smallInputStyle,color:'#2563eb',borderColor:'#dbeafe',fontFamily:'monospace'}} />
        <input value={c.title||''} placeholder='职务' onChange={e=>updateContactField(r,idx,'title',e.target.value)} onClick={e=>e.stopPropagation()} style={{...smallInputStyle,borderColor:'#e2e8f0'}} />
        <button title='删除联系人' onClick={e=>{e.stopPropagation(); removeContact(r,idx)}} style={{width:24,height:24,border:'none',borderRadius:6,background:'#fff1f2',color:'#e11d48',cursor:'pointer',fontSize:13}}>×</button>
      </div>)}
      <button onClick={e=>{e.stopPropagation(); addContact(r)}} style={{alignSelf:'flex-start',padding:'3px 9px',border:'1px dashed #60a5fa',background:'#eff6ff',color:'#2563eb',borderRadius:999,cursor:'pointer',fontSize:11}}>+ 联系人</button>
    </div>
  }

  const updateBusinessItems = (rowId, nextItems) => {
    const normalized = nextItems.length ? nextItems : [emptyBusinessItem()]
    const clean = cleanBusinessItems(normalized)
    const first = clean[0] || {}
    const item = items.find(x => x._id === rowId) || {}
    const legacyMainBusiness = clean.map(x => x.main_business).filter(Boolean).join('；')
    const payload = {
      business_items: clean,
      company_info: { ...(item.company_info || {}), main_business: legacyMainBusiness },
      address: first.address || '',
      planting_area: first.planting_area ?? null,
      estimated_inventory: first.estimated_inventory ?? null,
      sales_period: clean.map(x => x.sales_period).filter(Boolean),
    }
    const now = new Date().toISOString()
    setItems(p => p.map(x => x._id !== rowId ? x : { ...x, ...payload, business_items: normalized, updatedAt: now }))
    const sk = rowId + '_business_items'
    setSavingIds(p => ({ ...p, [sk]: true }))
    clearTimeout(debounceTimers.current[sk])
    debounceTimers.current[sk] = setTimeout(() => {
      api.put('/api/suppliers/' + rowId, payload)
        .catch(e => console.error(e))
        .finally(() => setSavingIds(p => { const n={...p}; delete n[sk]; return n }))
    }, 600)
  }
  const updateBusinessItemField = (r, idx, field, value) => {
    const next = normalizeBusinessItems(r)
    next[idx] = { ...next[idx], [field]: value }
    updateBusinessItems(r._id, next)
  }
  const addBusinessItem = (r) => updateBusinessItems(r._id, [...normalizeBusinessItems(r), emptyBusinessItem()])
  const removeBusinessItem = (r, idx) => {
    const next = normalizeBusinessItems(r).filter((_, i) => i !== idx)
    updateBusinessItems(r._id, next.length ? next : [emptyBusinessItem()])
  }
  const renderBusinessItems = (r) => {
    const list = normalizeBusinessItems(r)
    return <div style={{display:'flex',flexDirection:'column',gap:6,minWidth:560}}>
      {savingIds[r._id + '_business_items'] && <span style={{color:'#fa8c16',fontSize:11}}>保存中...</span>}
      {list.map((b, idx) => <div key={idx} style={{display:'grid',gridTemplateColumns:'120px 170px 74px 84px 118px 26px',gap:4,alignItems:'center',padding:'5px 6px',border:'1px solid #eaf0f6',borderRadius:8,background:'#fbfdff',boxShadow:'0 1px 2px rgba(15,23,42,.04)'}}>
        <input value={b.main_business||''} placeholder='主营业务' onChange={e=>updateBusinessItemField(r,idx,'main_business',e.target.value)} onClick={e=>e.stopPropagation()} style={{...smallInputStyle,fontWeight:600,borderColor:'#dbeafe'}} />
        <input value={b.address||''} placeholder='种植/经营地址' onChange={e=>updateBusinessItemField(r,idx,'address',e.target.value)} onClick={e=>e.stopPropagation()} style={smallInputStyle} />
        <input value={b.planting_area??''} placeholder='面积(亩)' onChange={e=>updateBusinessItemField(r,idx,'planting_area',e.target.value)} onClick={e=>e.stopPropagation()} style={{...smallInputStyle,textAlign:'center'}} />
        <input value={b.estimated_inventory??''} placeholder='库存' onChange={e=>updateBusinessItemField(r,idx,'estimated_inventory',e.target.value)} onClick={e=>e.stopPropagation()} style={{...smallInputStyle,textAlign:'center'}} />
        <input value={b.sales_period||''} placeholder='销售期，如3-5月' onChange={e=>updateBusinessItemField(r,idx,'sales_period',e.target.value)} onClick={e=>e.stopPropagation()} style={smallInputStyle} />
        <button title='删除业务行' onClick={e=>{e.stopPropagation(); removeBusinessItem(r,idx)}} style={{width:24,height:24,border:'none',borderRadius:6,background:'#fff1f2',color:'#e11d48',cursor:'pointer',fontSize:13}}>×</button>
      </div>)}
      <button onClick={e=>{e.stopPropagation(); addBusinessItem(r)}} style={{alignSelf:'flex-start',padding:'3px 9px',border:'1px dashed #60a5fa',background:'#eff6ff',color:'#2563eb',borderRadius:999,cursor:'pointer',fontSize:11}}>+ 主营/种植信息</button>
    </div>
  }
  const updateNewBusinessItemField = (idx, field, value) => setNewRow(p => {
    const next = [...(p.business_items || [emptyBusinessItem()])]
    next[idx] = { ...(next[idx] || emptyBusinessItem()), [field]: value }
    return { ...p, business_items: next }
  })
  const renderNewBusinessItems = () => <div style={{display:'flex',flexDirection:'column',gap:6,minWidth:560}}>
    {(newRow.business_items || [emptyBusinessItem()]).map((b, idx) => <div key={idx} style={{display:'grid',gridTemplateColumns:'120px 170px 74px 84px 118px 26px',gap:4,alignItems:'center'}}>
      <input value={b.main_business||''} onChange={e=>updateNewBusinessItemField(idx,'main_business',e.target.value)} placeholder='主营业务' style={smallInputStyle} />
      <input value={b.address||''} onChange={e=>updateNewBusinessItemField(idx,'address',e.target.value)} placeholder='种植/经营地址' style={smallInputStyle} />
      <input value={b.planting_area??''} onChange={e=>updateNewBusinessItemField(idx,'planting_area',e.target.value)} placeholder='面积' style={smallInputStyle} />
      <input value={b.estimated_inventory??''} onChange={e=>updateNewBusinessItemField(idx,'estimated_inventory',e.target.value)} placeholder='库存' style={smallInputStyle} />
      <input value={b.sales_period||''} onChange={e=>updateNewBusinessItemField(idx,'sales_period',e.target.value)} placeholder='销售期' style={smallInputStyle} />
      <button onClick={() => setNewRow(p => ({...p, business_items: (p.business_items || []).filter((_, i) => i !== idx).length ? (p.business_items || []).filter((_, i) => i !== idx) : [emptyBusinessItem()]}))} style={{width:24,height:24,border:'none',borderRadius:6,background:'#fff1f2',color:'#e11d48',cursor:'pointer'}}>×</button>
    </div>)}
    <button onClick={() => setNewRow(p => ({...p, business_items: [...(p.business_items || []), emptyBusinessItem()]}))} style={{alignSelf:'flex-start',padding:'3px 9px',border:'1px dashed #60a5fa',background:'#eff6ff',color:'#2563eb',borderRadius:999,cursor:'pointer',fontSize:11}}>+ 主营/种植信息</button>
  </div>

  return (
    <div style={{padding:16,background:'linear-gradient(135deg,#f8fbff 0%,#eef6ff 42%,#f7fff7 100%)',minHeight:'calc(100vh - 48px)'}}>
      <div style={{display:'flex',gap:12,marginBottom:12}}>{stats.map((s, i) => (
        <div key={i} style={{flex:1,background:'rgba(255,255,255,.92)',borderRadius:14,padding:'14px 20px',boxShadow:'0 10px 30px rgba(30,64,175,.08)',border:'1px solid rgba(148,163,184,.18)'}}>
          <div style={{fontSize:12,color:'#888'}}>{s.label}</div>
          <div style={{fontSize:24,fontWeight:700,color:s.color}}>{s.value}</div>
        </div>
      ))}</div>

      <div style={{display:'flex',gap:10,marginBottom:12,alignItems:'center',flexWrap:'wrap',background:'rgba(255,255,255,.82)',padding:12,borderRadius:14,boxShadow:'0 8px 24px rgba(15,23,42,.06)',border:'1px solid rgba(148,163,184,.18)'}}>
        <div style={{position:'relative'}}>
          <input ref={supplierInputRef} value={supplierFilter} onChange={e => handleSupplierFilterChange(e.target.value)}
            onFocus={() => { if (supplierFilter.trim()) { const f = allSupplierNames.filter(n => n.toLowerCase().includes(supplierFilter.toLowerCase())); if (f.length > 0) { setSupplierSuggestions(f); setShowSuggestions(true) } }}}
            placeholder='筛选主体/商家名称' style={{padding:'6px 10px',border:'1px solid #d9d9d9',borderRadius:4,width:220,fontSize:13}} />
          {supplierFilter && <button onClick={() => { setSupplierFilter(''); setSupplierSuggestions([]); setShowSuggestions(false) }} style={{position:'absolute',right:6,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',fontSize:14,color:'#999',padding:0,lineHeight:1}}>×</button>}
          {showSuggestions && <div ref={suggestionsRef} style={{position:'absolute',top:'100%',left:0,zIndex:1000,background:'#fff',border:'1px solid #d9d9d9',borderRadius:4,maxHeight:200,overflowY:'auto',width:280,boxShadow:'0 4px 12px rgba(0,0,0,0.15)'}}>
            {supplierSuggestions.map((name, i) => <div key={i} onClick={() => selectSupplier(name)} onMouseDown={e=>e.preventDefault()} style={{padding:'6px 10px',fontSize:12,cursor:'pointer',borderBottom:'1px solid #f0f0f0',background:'#fff'}} onMouseEnter={e=>e.currentTarget.style.background='#e6f7ff'} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>{name}</div>)}
          </div>}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder='搜索联系人 / 税号 / 备注' style={{padding:'6px 10px',border:'1px solid #d9d9d9',borderRadius:4,width:220,fontSize:13}} />
        <select value={status} onChange={e => setStatus(e.target.value)} style={{padding:'5px 8px',border:'1px solid #d9d9d9',borderRadius:4,fontSize:12}}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s === '全部' ? '' : s}>{s === '全部' ? '全部状态' : s}</option>)}
        </select>
        <span style={{fontSize:12,color:'#888'}}>共 {filteredItems.length} 家{(supplierFilter || search || status) ? '（已筛选）' : ''}</span>
        {isSavingOrder && <span style={{fontSize:12,color:'#fa8c16'}}>排序中...</span>}
        <div style={{flex:1}} />
        <button onClick={handleBatchExport} disabled={exporting}
          style={{padding:'5px 14px',background:exporting?'#d9d9d9':'#52c41a',color:'#fff',border:'none',borderRadius:4,cursor:exporting?'not-allowed':'pointer',fontSize:12,fontWeight:500}}>
          {exporting ? '导出中...' : (selectedIds.size > 0 ? `导出选中(${selectedIds.size})` : '导出Excel')}
        </button>
        <button onClick={handleBatchDelete} disabled={batchDeleting || selectedIds.size === 0}
          style={{padding:'5px 14px',background:(batchDeleting || selectedIds.size === 0)?'#d9d9d9':'#ff4d4f',color:'#fff',border:'none',borderRadius:4,cursor:(batchDeleting || selectedIds.size === 0)?'not-allowed':'pointer',fontSize:12,fontWeight:500}}>
          {batchDeleting ? '删除中...' : (selectedIds.size > 0 ? `删除选中(${selectedIds.size})` : '删除选中')}
        </button>
        <button onClick={() => setShowNewRow(true)} disabled={showNewRow} style={{padding:'5px 12px',background:showNewRow?'#d9d9d9':'#1a1a2e',color:'#fff',border:'none',borderRadius:4,cursor:showNewRow?'not-allowed':'pointer',fontSize:12}}>{showNewRow ? '编辑中...' : '+ 新增供应商'}</button>
      </div>

      {selectedIds.size > 0 && (
        <div style={{ marginBottom: 8, padding: '4px 10px', background: '#fff', borderRadius: 4, border: '1px solid #d9d9d9', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ color: '#1890ff', fontWeight: 600 }}>已选中 {selectedIds.size} 条</span>
          <button onClick={clearSelection} style={{ fontSize: 11, padding: '2px 8px', border: '1px solid #d9d9d9', borderRadius: 3, background: '#fff', cursor: 'pointer', color: '#666' }}>取消选择</button>
        </div>
      )}

      <div style={{overflow:'auto',background:'rgba(255,255,255,.96)',borderRadius:16,boxShadow:'0 16px 40px rgba(15,23,42,.10)',border:'1px solid rgba(148,163,184,.18)',maxHeight:'calc(100vh - 270px)'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr style={{background:'#f7f7f7',position:'sticky',top:0,zIndex:1}}>
            <th style={{...th,width:32,textAlign:'center'}}>
              <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} style={{ cursor: 'pointer' }} />
            </th>
            <th style={{...th,width:36,textAlign:'center'}}>{String.fromCharCode(0x2630)}</th>
            <th style={th}>主体名称</th>
            <th style={{...th,width:120}}>商家名称</th>
            <th style={{...th,width:90}}>状态</th>
            <th style={{...th,width:280}}>联系人</th>
            <th style={{...th,width:140}}>税号</th>
            <th style={{...th,width:160}}>公司地址</th>
            <th style={{...th,width:590}}>主营业务 / 种植地址 / 面积 / 库存 / 销售期</th>
            <th style={{...th,width:140}}>营业执照</th>
            <th style={{...th,width:140}}>合同电子版</th>
            <th style={{...th,width:120}}>下发文件</th>
            <th style={{...th,width:60}}>商品数</th>
            <th style={{...th,width:130}}>备注</th>
            <th style={{...th,width:110}}>更新时间</th>
            <th style={{...th,width:70}}>操作</th>
          </tr></thead>
          <tbody>
            {(() => {
              if (loading) return <tr><td colSpan={16} style={{textAlign:'center',padding:24,color:'#888'}}>加载中...</td></tr>
              const rows = []
              if (showNewRow) {
                rows.push(
                  <tr key="__new" style={{background:'#fffbe6',borderBottom:'1px solid #ffe58f'}}>
                    <td style={{...td,textAlign:'center'}}><span style={{color:'#d4b106',fontSize:12}}>新</span></td>
                    <td style={{...td,textAlign:'center',color:'#d4b106',fontSize:16}}>{String.fromCharCode(0x2795)}</td>
                    <td style={td}><input value={newRow.name} onChange={e => setNewRow(p => ({...p, name: e.target.value}))} placeholder='主体名称 *' style={inputStyle} autoFocus /></td>
                    <td style={td}><input value={newRow.shop_name} onChange={e => setNewRow(p => ({...p, shop_name: e.target.value}))} placeholder='商家名称' style={inputStyle} /></td>
                    <td style={td}>
                      <select value={newRow.status} onChange={e => setNewRow(p => ({...p, status: e.target.value}))} style={{width:'100%',padding:'3px 6px',border:'none',borderRadius:10,fontSize:11,background:STATUS_COLORS['待签章'].bg,color:STATUS_COLORS['待签章'].c,cursor:'pointer',outline:'none'}}>
                        {EDITABLE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={{...td,fontSize:11}}><div style={{display:'grid',gridTemplateColumns:'70px 110px 70px',gap:4}}><input value={newRow.contact_name} onChange={e => setNewRow(p => ({...p, contact_name: e.target.value}))} placeholder='联系人' style={smallInputStyle} /><input value={newRow.contact_phone} onChange={e => setNewRow(p => ({...p, contact_phone: e.target.value}))} placeholder='电话' style={smallInputStyle} /><input placeholder='职务' style={smallInputStyle} disabled /></div></td>
                    <td style={{...td,fontSize:11}}><input value={newRow.tax_id} onChange={e => setNewRow(p => ({...p, tax_id: e.target.value}))} placeholder='税号' style={smallInputStyle} /></td>
                    <td style={{...td,fontSize:11}}><input value={newRow.company_address} onChange={e => setNewRow(p => ({...p, company_address: e.target.value}))} placeholder='公司地址' style={smallInputStyle} /></td>
                    <td style={{...td,fontSize:11}}>{renderNewBusinessItems()}</td>
                    <td style={td} colSpan={3}><span style={{fontSize:11,color:'#999'}}>创建后再上传文件</span></td>
                    <td style={{...td,textAlign:'center',fontSize:13,color:'#d4b106'}}>—</td>
                    <td style={td}><input value={newRow.notes} onChange={e => setNewRow(p => ({...p, notes: e.target.value}))} placeholder='备注' style={smallInputStyle} /></td>
                    <td style={{...td,fontSize:11,color:'#999'}}>新建</td>
                    <td style={td}>
                      <div style={{display:'flex',gap:4}}>
                        <button onClick={handleNewRowSave} disabled={newRowSaving || !newRow.name.trim()} style={{padding:'3px 8px',background:newRowSaving?'#d9d9d9':'#52c41a',color:'#fff',border:'none',borderRadius:4,cursor:newRowSaving?'not-allowed':'pointer',fontSize:11,whiteSpace:'nowrap'}}>{newRowSaving ? '保存...' : '保存'}</button>
                        <button onClick={handleNewRowCancel} disabled={newRowSaving} style={{padding:'3px 8px',background:'#fff',color:'#999',border:'1px solid #d9d9d9',borderRadius:4,cursor:'pointer',fontSize:11,whiteSpace:'nowrap'}}>取消</button>
                      </div>
                    </td>
                  </tr>
                )
              }
              if (filteredItems.length === 0 && !showNewRow) {
                rows.push(<tr key="__empty"><td colSpan={16} style={{textAlign:'center',padding:24,color:'#888'}}>{(supplierFilter || search || status) ? '没有匹配的供应商' : '暂无数据'}</td></tr>)
                return rows
              }
              filteredItems.map((r, i) => {
                const sc = STATUS_COLORS[r.status] || STATUS_COLORS['待签章']
                const saving = (field) => savingIds[r._id + '_' + field]
                const isDragging = dragIndex === i
                const isDropTarget = dropTargetIndex === i && dragIndex !== i
                let rowBg = i%2===0?'#fff':'#fafcff'
                if (isDragging) rowBg = '#e6f7ff'
                if (isDropTarget) rowBg = '#fffbe6'
                const selected = selectedIds.has(r._id)
                if (selected) rowBg = '#e6fffb'
                rows.push(
                  <tr key={r._id} draggable onDragStart={(e) => handleDragStart(e, i)} onDragEnd={handleDragEnd} onDragOver={(e) => handleDragOver(e, i)} onDrop={(e) => { e.preventDefault() }} style={{borderBottom:'1px solid #f0f0f0',background:rowBg,height:44,cursor:'grab',opacity:isDragging?0.5:1,boxShadow:isDropTarget?'0 -2px 0 0 #1890ff inset':'none'}} onMouseEnter={e => { if(!isDragging) e.currentTarget.style.background='#f0f7ff' }} onMouseLeave={e => { if(!isDragging) e.currentTarget.style.background=selected?'#e6fffb':(i%2===0?'#fff':'#fafcff') }}>
                    <td style={{...td,textAlign:'center',padding:'2px 4px'}}>
                      <input type="checkbox" checked={selected} onChange={() => toggleSelect(r._id)} onClick={e => e.stopPropagation()} style={{ cursor: 'pointer' }} />
                    </td>
                    <td style={{...td,textAlign:'center',padding:'2px 4px',color:'#bbb',fontSize:16,cursor:'grab'}} title='拖拽调整排序'>{String.fromCharCode(0x2630)}</td>
                    <td style={{...td,maxWidth:220}} title={r.name}><strong>{saving('name') && ' '}<input title={r.name} value={r.name} onChange={e => updateItem(r._id,'name',e.target.value)} style={{...inputStyle,fontWeight:700,color:'#0f172a',border:'1px solid transparent',background:'transparent',textOverflow:'ellipsis'}} onClick={e=>e.stopPropagation()} /></strong></td>
                    <td style={td}>{saving('shop_name') && ' '}<input value={r.shop_name||''} onChange={e => { handleShopNameChange(r._id, e.target.value) }} style={inputStyle} placeholder='商家名称' onClick={e=>e.stopPropagation()} /></td>
                    <td style={td}>{saving('status') && ' '}<select value={r.status} onChange={e => updateItem(r._id,'status',e.target.value)} onClick={e=>e.stopPropagation()} style={{width:'100%',padding:'3px 6px',border:'none',borderRadius:10,fontSize:11,background:sc.bg,color:sc.c,cursor:'pointer',outline:'none'}}>{EDITABLE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></td>
                    <td style={{...td,fontSize:11}}>{savingIds[r._id + '_contacts'] && <span style={{color:'#fa8c16'}}>保存中 </span>}{renderContacts(r)}</td>
                    <td style={{...td,fontSize:11}}>{saving('tax_id') && ' '}<input value={r.company_info?.tax_id||''} onChange={e => updateItem(r._id,'tax_id',e.target.value)} style={{...smallInputStyle,fontFamily:'monospace'}} placeholder='税号' onClick={e=>e.stopPropagation()} /></td>
                    <td style={{...td,fontSize:11}}>{saving('company_address') && ' '}<input value={r.company_info?.address||''} onChange={e => updateItem(r._id,'company_address',e.target.value)} style={smallInputStyle} placeholder='公司地址' onClick={e=>e.stopPropagation()} /></td>
                    <td style={{...td,fontSize:11}}>{renderBusinessItems(r)}</td>
                    <td style={td}>{renderFiles(r.license_files||[],'license',r)}</td>
                    <td style={td}>{renderFiles(r.contract_files||[],'contract',r)}</td>
                    <td style={td}>{renderFiles(r.dispatch_files||[],'dispatch',r)}</td>
                    <td style={{...td,textAlign:'center',fontWeight:600,fontSize:13}}>{productCounts[r.shop_name] ?? productCounts[r.name] ?? r.product_count ?? 0}</td>
                    <td style={td}>{saving('notes') && ' '}<input value={r.notes||''} onChange={e => updateItem(r._id,'notes',e.target.value)} style={smallInputStyle} placeholder='备注' onClick={e=>e.stopPropagation()} /></td>
                    <td style={{...td,fontSize:11,color:'#999'}}>{fmt(r.updatedAt)}</td>
                    <td style={td}>
                      <button onClick={e=>{e.stopPropagation();window.open("http://100.96.54.109:3006/"+"?supplierId="+r._id+"&name="+encodeURIComponent(r.name),"_blank")}} style={{padding:"3px 8px",border:"1px solid #52c41a",background:"#f6ffed",color:"#52c41a",borderRadius:4,cursor:"pointer",fontSize:11,marginRight:4}}>合同</button>
                      <button onClick={e=>{e.stopPropagation();goProducts(r)}} onMouseDown={e=>e.stopPropagation()} style={{padding:'3px 8px',border:'1px solid #1890ff',background:'#e6f7ff',color:'#1890ff',borderRadius:4,cursor:'pointer',fontSize:11,marginRight:4}}>商品</button>
                      <button onClick={e=>handleDelete(e,r._id)} onMouseDown={e=>e.stopPropagation()} style={{padding:'2px 6px',border:'none',borderRadius:4,cursor:'pointer',fontSize:14,background:'transparent'}}>{String.fromCharCode(0x1f5d1)}</button>
                    </td>
                  </tr>
                )
              })
              return rows
            })()}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:8,fontSize:11,color:'#999',textAlign:'center'}}>
        直接在输入框中修改自动保存 | {String.fromCharCode(0x2630)} 拖拽排序 | 勾选后批量删除/导出 | 商家名称手动输入后自动查询商品数
      </div>

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
const th = {padding:'10px 10px',borderBottom:'1px solid #e2e8f0',fontWeight:700,fontSize:11,color:'#334155',whiteSpace:'nowrap',position:'sticky',top:0,background:'linear-gradient(180deg,#f8fafc,#eef6ff)',userSelect:'none',textAlign:'left',letterSpacing:.2}
const td = {padding:'7px 8px',borderBottom:'1px solid #edf2f7',fontSize:12,verticalAlign:'middle',overflow:'visible',height:66,minHeight:66}
