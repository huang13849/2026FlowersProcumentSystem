import { useState, useEffect, useRef } from 'react'
import api from '../api'
import axios from 'axios'
import { gatewayApi } from '../api'

const shopApi = axios.create({ baseURL: 'http://100.96.54.109:3004' })

// ============ 状态枚举 ============
const STATUS_OPTIONS = ['全部', '已完成', '待整理', '合同异常']
const EDITABLE_STATUSES = ['已完成', '待整理', '合同异常']
const STATUS_COLORS = {
  '已完成': { bg: '#e8f5e9', c: '#2e7d32', icon: '✅', label: '已完成' },
  '待整理': { bg: '#fff3e0', c: '#ef6c00', icon: '⏳', label: '待整理' },
  '合同异常': { bg: '#ffebee', c: '#c62828', icon: '⚠️', label: '异常' },
}
const STATUS_ICON = {
  '已完成': '✅', '待整理': '⏳', '合同异常': '⚠️'
}

const isImgUrl = (url) => /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(url)

const FileIcon = ({ name, size = 40 }) => {
  const ext = name?.split('.').pop()?.toLowerCase() || ''
  const info = {
    pdf:  { emoji: '📄', label: 'PDF',  bg: '#ffebee', color: '#c62828' },
    doc:  { emoji: '📝', label: 'DOC',  bg: '#e3f2fd', color: '#1565c0' },
    docx: { emoji: '📝', label: 'DOCX', bg: '#e3f2fd', color: '#1565c0' },
    xls:  { emoji: '📊', label: 'XLS',  bg: '#e8f5e9', color: '#2e7d32' },
    xlsx: { emoji: '📊', label: 'XLSX', bg: '#e8f5e9', color: '#2e7d32' },
  }[ext] || { emoji: '📎', label: ext.toUpperCase(), bg: '#f5f5f5', color: '#666' }
  return (
    <div style={{ width: size, height: size, borderRadius: 6, background: info.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontWeight: 600, color: info.color, lineHeight: 1.2, border: '1px solid #e0e0e0', transition: 'transform 0.15s', fontSize: size * 0.22 }}
      onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
      <span style={{fontSize: size * 0.45}}>{info.emoji}</span>
      <span style={{fontSize: size * 0.22}}>{info.label}</span>
    </div>
  )
}

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

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('zh-CN') : '-'

// ============ 样式常量 ============
const INPUT_BASE = {
  width: '100%', padding: '6px 8px', border: '1px solid #d0d0d0',
  borderRadius: 6, fontSize: 13, background: '#fff', color: '#333',
  outline: 'none', transition: 'all .15s', fontFamily: "'Microsoft YaHei','微软雅黑',sans-serif"
}
const INPUT_FOCUS = { borderColor: '#3E7B5B', boxShadow: '0 0 0 2px rgba(62,123,91,0.15)' }
const SMALL_INPUT = { ...INPUT_BASE, padding: '4px 6px', fontSize: 12, borderColor: '#ddd' }
const STATUS_BTN = (color, bg) => ({
  padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
  border: 'none', cursor: 'pointer', color, background: bg,
  display: 'inline-flex', alignItems: 'center', gap: 4
})

export default function SupplierList() {
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingIds, setSavingIds] = useState({})
  const [uploadingId, setUploadingId] = useState(null)
  const [pasteHoverId, setPasteHoverId] = useState(null)
  const [supplierFilter, setSupplierFilter] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [salesPeriodFilter, setSalesPeriodFilter] = useState('')
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
  const [geocoding, setGeocoding] = useState({})
  const [editingAddr, setEditingAddr] = useState({})  // 临时编辑公司地址 {rowId: value}

  /* ========== 地址转经纬度 ========== */
  const handleGeocode = async (rowId, address) => {
    if (!address || !address.trim()) return
    setGeocoding(p => ({ ...p, [rowId]: true }))
    try {
      const res = await api.post('/api/suppliers/geocode', { address: address.trim() })
      const { longitude, latitude } = res.data
      // Update local state
      setItems(p => p.map(x => x._id !== rowId ? x : { ...x, longitude, latitude, updatedAt: new Date().toISOString() }))
      // Save to backend
      await api.put('/api/suppliers/' + rowId, { longitude, latitude })
    } catch (e) {
      console.error('Geocode failed:', e)
      alert('地址解析失败: ' + (e.response?.data?.error || e.message))
    }
    setGeocoding(p => ({ ...p, [rowId]: false }))
  }

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
      const next = new Set(prev)
      if (isAllSelected) {
        allFilteredIds.forEach(id => next.delete(id))
      } else {
        allFilteredIds.forEach(id => next.add(id))
      }
      return next
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

  /* ========== 批量导出（选中项或全部） ========== */
  const handleBatchExport = async () => {
    const exportItems = selectedIds.size > 0 ? items.filter(r => selectedIds.has(r._id)) : items
    if (exportItems.length === 0) { alert('没有可导出的数据'); return }
    setExporting(true)
    try {
      const X = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
      const d = exportItems.map((r, i) => ({
        '序号': i + 1,
        '供应商名称': r.name || '',
        '商家名称': r.shop_name || '',
        '状态': r.status || '',
        '联系人': (r.contacts && r.contacts.length ? r.contacts : [r.contact || {}]).map(c => [c.name, c.phone].filter(Boolean).join('/')).filter(Boolean).join('; '),
        '联系电话': (r.contacts && r.contacts.length ? r.contacts : [r.contact || {}]).map(c => c.phone).filter(Boolean).join('; '),
        '税号': r.company_info?.tax_id || '',
        '公司地址': r.company_info?.address || '',
        '主营业务': (r.business_items || []).map(x => x.main_business).filter(Boolean).join('; '),
        '栽培地址': (r.business_items || []).map(x => x.address).filter(Boolean).join('; '),
        '面积(亩)': (r.business_items || []).map(x => x.planting_area ?? '').filter(x => x !== '').join('; '),
        '库存': (r.business_items || []).map(x => x.estimated_inventory ?? '').filter(x => x !== '').join('; '),
        '销售期': (r.business_items || []).map(x => x.sales_period).filter(Boolean).join('; '),
        '商品数': productCounts[r.shop_name] ?? productCounts[r.name] ?? r.product_count ?? 0,
        '营业执照数': (r.license_files || []).length,
        '合同数': (r.contract_files || []).length,
        '下发文件数': (r.dispatch_files || []).length,
        '备注': r.notes || '',
        '更新时间': r.updatedAt ? new Date(r.updatedAt).toLocaleDateString('zh-CN') : ''
      }))
      const ws = X.utils.json_to_sheet(d)
      ws['!cols'] = [
        {wch:6},{wch:20},{wch:14},{wch:10},{wch:20},{wch:14},{wch:22},{wch:30},
        {wch:20},{wch:20},{wch:12},{wch:12},{wch:16},{wch:8},{wch:10},{wch:10},{wch:10},{wch:20},{wch:14}
      ]
      const wb = X.utils.book_new()
      X.utils.book_append_sheet(wb, ws, '供应商列表')
      const label = selectedIds.size > 0 ? '供应商列表_选中' : '供应商列表'
      X.writeFile(wb, label + '_' + new Date().toISOString().slice(0, 10) + '.xlsx')
    } catch (e) { console.error(e); alert('导出失败: ' + e.message) }
    setExporting(false)
  }

  /* ========== 新增行 ========== */
  const [showNewRow, setShowNewRow] = useState(false)
  const [newRowSaving, setNewRowSaving] = useState(false)
  const [newRow, setNewRow] = useState({
    name: '', shop_name: '', status: '待整理',
    contact_name: '', contact_phone: '',
    tax_id: '', company_address: '',
    business_items: [emptyBusinessItem()],
    notes: ''
  })

  const handleNewRowSave = async () => {
    if (!newRow.name.trim()) { alert('供应商名称不能为空'); return }
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
        notes: newRow.notes.trim() || undefined,
        sortOrder: -Math.abs(Date.now())
      }
      const r = await api.post('/api/suppliers', payload)
      setItems(prev => [r.data, ...prev])
      setShowNewRow(false)
      setNewRow({ name: '', shop_name: '', status: '待整理', contact_name: '', contact_phone: '', tax_id: '', company_address: '', business_items: [emptyBusinessItem()], notes: '' })
      load()
    } catch (e) { alert('创建失败: ' + (e.response?.data?.error || e.message)) }
    setNewRowSaving(false)
  }
  const handleNewRowCancel = () => {
    setShowNewRow(false)
    setNewRow({ name: '', shop_name: '', status: '待整理', contact_name: '', contact_phone: '', tax_id: '', company_address: '', business_items: [emptyBusinessItem()], notes: '' })
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
      const p = {}
      if (search) p.search = search
      if (status) p.status = status
      const r = await api.get('/api/suppliers', { params: p })
      const data = r.data.suppliers || []
      setItems(data)
      setAllSupplierNames([...new Set(data.map(s => s.name).filter(Boolean))])
    } catch (e) { console.error(e) }
    setLoading(false)
  }
  const loadProductCounts = async () => {
    try {
      const r = await api.get('/api/suppliers/product-stats')
      if (r.data && typeof r.data === 'object') setProductCounts(r.data)
    } catch (e) { console.error(e) }
  }

  useEffect(() => { load(); loadProductCounts() }, [])
  useEffect(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 300); return () => clearTimeout(timer.current) }, [search, status])

  const handleSupplierFilterChange = (value) => {
    setSupplierFilter(value)
    if (value.trim()) {
      const f = allSupplierNames.filter(n => n.toLowerCase().includes(value.toLowerCase()))
      setShowSuggestions(f.length > 0)
    } else { setShowSuggestions(false) }
  }

  useEffect(() => {
    const h = (e) => { if (suggestionsRef.current && !suggestionsRef.current.contains(e.target) && supplierInputRef.current && !supplierInputRef.current.contains(e.target)) setShowSuggestions(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const filteredItems = items.filter(item => {
    const matchName = !supplierFilter.trim() || (item.name && item.name.toLowerCase().includes(supplierFilter.toLowerCase())) || (item.shop_name && item.shop_name.toLowerCase().includes(supplierFilter.toLowerCase()))
    const matchRegion = !regionFilter.trim() || ((item.company_info?.address || item.address || '') + ' ' + (item.business_items || []).map(b => b.address).join(' ')).toLowerCase().includes(regionFilter.toLowerCase())
    const matchCategory = !categoryFilter.trim() || (item.business_items || []).some(b => (b.main_business || '').toLowerCase().includes(categoryFilter.toLowerCase())) || (item.company_info?.main_business || '').toLowerCase().includes(categoryFilter.toLowerCase())
    const matchPeriod = !salesPeriodFilter.trim() || (item.business_items || []).some(b => (b.sales_period || '').toLowerCase().includes(salesPeriodFilter.toLowerCase())) || (Array.isArray(item.sales_period) ? item.sales_period.join(' ') : (item.sales_period || '')).toLowerCase().includes(salesPeriodFilter.toLowerCase())
    return matchName && matchRegion && matchCategory && matchPeriod
  })

  const goProducts = (s) => { const name = s.shop_name || s.name; window.open('http://100.96.54.109:3001/#/?sellerName=' + encodeURIComponent(name), '_blank') }

  const handleDelete = async (e, id) => { e.stopPropagation(); if (!confirm('确认删除？')) return; await api.delete('/api/suppliers/' + id); load() }

  const goShop = async (r) => {
    const shopName = r.shop_name || r.name
    if (!shopName) { alert('商家名称为空，无法关联店铺'); return }
    try {
      const res = await shopApi.get('/api/shops', { params: { search: shopName } })
      const shops = res.data.shops || []
      const match = shops.find(s => s.shopName === shopName)
      if (match) { window.open('http://100.96.54.109:3004/', '_blank') }
      else { await shopApi.post('/api/shops', { shopName, contactName: r.contact?.name || '', phone: r.contact?.phone || '' }); window.open('http://100.96.54.109:3004/', '_blank') }
    } catch (e) { alert('店铺操作失败: ' + (e.response?.data?.error || e.message)) }
  }

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
    else if (field === 'company_address') { ud = { company_info: { ...item.company_info, address: value } } }
    else if (field === 'main_business') ud = { company_info: { ...item.company_info, main_business: value } }
    else if (field === 'address') ud = { address: value }
    else if (field === 'planting_area') ud = { planting_area: value ? Number(value) : null }
    else if (field === 'estimated_inventory') ud = { estimated_inventory: value ? Number(value) : null }
    else if (field === 'sales_period') ud = { sales_period: value }
    const now = new Date().toISOString()
    setItems(p => p.map(x => {
      if (x._id !== rowId) return x
      if (field === 'contact_name') return { ...x, contact: { ...x.contact, name: value }, updatedAt: now }
      if (field === 'contact_phone') return { ...x, contact: { ...x.contact, phone: value }, updatedAt: now }
      if (field === 'tax_id') return { ...x, company_info: { ...x.company_info, tax_id: value }, updatedAt: now }
      if (field === 'company_address') return { ...x, company_info: { ...x.company_info, address: value }, updatedAt: now }
      if (field === 'main_business') return { ...x, company_info: { ...x.company_info, main_business: value }, updatedAt: now }
      if (field === 'shop_name') return { ...x, shop_name: value, ...extraFields, updatedAt: now }
      if (['address', 'planting_area', 'estimated_inventory', 'sales_period'].includes(field)) return { ...x, [field]: value, updatedAt: now }
      return { ...x, [field]: value, updatedAt: now }
    }))
    clearTimeout(debounceTimers.current[sk])
    debounceTimers.current[sk] = setTimeout(() => {
      api.put('/api/suppliers/' + rowId, ud).catch(e => console.error(e)).finally(() => {
        setSavingIds(p => { const n = { ...p }; delete n[sk]; return n })
      })
    }, 500)
  }

  const handleShopNameChange = (rowId, newName) => {
    updateItem(rowId, 'shop_name', newName, {})
    if (newName.trim()) {
      clearTimeout(debounceTimers.current[rowId + '_shop'])
      debounceTimers.current[rowId + '_shop'] = setTimeout(async () => {
        try {
          const r = await api.get('/api/suppliers/product-stats', { params: { names: newName } })
          if (r.data && typeof r.data === 'object') setProductCounts(prev => ({ ...prev, ...r.data }))
        } catch (e) { console.error(e) }
      }, 600)
    }
  }

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
      const fd = new FormData(); fd.append('file', compressed); fd.append('folder', fileType === 'contract' ? 'contracts' : fileType === 'license' ? 'licenses' : 'dispatches')
      const res = await gatewayApi.post('/api/minio/upload', fd)
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

  /* ── 渲染文件 ── */
  const renderFiles = (files, fileType, r) => {
    const isActive = pasteHoverId && pasteHoverId.id === r._id && pasteHoverId.type === fileType
    const uploading = uploadingId === r._id
    const safeFiles = files || []
    const sz = 44
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', minWidth: 120, padding: '2px 0' }}>
        {safeFiles.map((f, i) => (
          <div key={i} style={{ position: 'relative', flexShrink: 0, zIndex: 1 }} title={f.name}>
            <a href={f.url} target='_blank' rel='noreferrer' onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', textDecoration: 'none' }}>
              {isImgUrl(f.url) ? (
                <img src={f.url} alt={f.name} style={{ width: sz, height: sz, objectFit: 'contain', borderRadius: 4, border: '1px solid #d9d9d9', display: 'block', background: '#fff' }} />
              ) : (<FileIcon name={f.name} size={sz} />)}
            </a>
            <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleFileRemove(r._id, fileType, i) }}
              style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', border: 'none', background: '#e53935', color: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0, zIndex: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>×</button>
          </div>
        ))}
        <div
          onMouseEnter={e => { setPasteHoverId({ id: r._id, type: fileType }); if (!isActive) { e.currentTarget.style.borderColor = '#1976d2'; e.currentTarget.style.color = '#1976d2'; e.currentTarget.style.background = '#e3f2fd' } }}
          onMouseLeave={e => { setPasteHoverId(null); if (!isActive) { e.currentTarget.style.borderColor = '#999'; e.currentTarget.style.color = '#999'; e.currentTarget.style.background = 'transparent' } }}
          onClick={(e) => { e.stopPropagation(); const inp = document.createElement('input'); inp.type = 'file'; inp.accept = fileType === 'license' ? '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.bmp' : '.pdf,.doc,.docx,.xls,.xlsx'; inp.onchange = (ev) => { if (ev.target.files?.[0]) handleFileUpload(r._id, ev.target.files[0], fileType); }; inp.click(); }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ width: sz, height: sz, border: isActive ? '2px dashed #1976d2' : '2px dashed #999', borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: isActive ? '#1976d2' : '#999', cursor: 'pointer', transition: 'all 0.15s', userSelect: 'none', flexShrink: 0, background: isActive ? '#e3f2fd' : 'transparent', lineHeight: 1.2 }}>
          {uploading ? (<span style={{ fontSize: 11, color: '#ef6c00' }}>⏳</span>) : (<><span style={{ fontSize: 14, lineHeight: 1 }}>+</span><span>{isActive ? '粘贴' : '上传'}</span></>)}
        </div>
      </div>
    )
  }

  /* ── 联系人 ── */
  const getContacts = (r) => {
    const arr = (r.contacts && r.contacts.length) ? r.contacts : (r.contact?.name || r.contact?.phone ? [{ name: r.contact?.name || '', phone: r.contact?.phone || '', title: '', gender: '' }] : [])
    return arr.length ? arr : [{ name: '', phone: '', title: '', gender: '' }]
  }
  const updateContacts = (rowId, contacts) => {
    const clean = contacts.map(c => ({ name: c.name || '', phone: c.phone || '', title: c.title || '', gender: c.gender || '' }))
    const primary = clean.find(c => c.name || c.phone) || { name: '', phone: '' }
    const now = new Date().toISOString()
    setItems(p => p.map(x => x._id !== rowId ? x : { ...x, contacts: clean, contact: { ...x.contact, name: primary.name || '', phone: primary.phone || '' }, updatedAt: now }))
    const sk = rowId + '_contacts'
    setSavingIds(p => ({ ...p, [sk]: true }))
    clearTimeout(debounceTimers.current[sk])
    debounceTimers.current[sk] = setTimeout(() => {
      api.put('/api/suppliers/' + rowId, { contacts: clean, contact: { name: primary.name || '', phone: primary.phone || '' } })
        .catch(e => console.error(e))
        .finally(() => setSavingIds(p => { const n = { ...p }; delete n[sk]; return n }))
    }, 500)
  }
  const updateContactField = (r, idx, field, value) => {
    const contacts = getContacts(r)
    contacts[idx] = { ...contacts[idx], [field]: value }
    updateContacts(r._id, contacts)
  }
  const addContact = (r) => updateContacts(r._id, [...getContacts(r), { name: '', phone: '', title: '', gender: '' }])
  const removeContact = (r, idx) => {
    const contacts = getContacts(r).filter((_, i) => i !== idx)
    updateContacts(r._id, contacts.length ? contacts : [{ name: '', phone: '', title: '', gender: '' }])
  }
  const renderContacts = (r) => {
    const contacts = getContacts(r)
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 260 }}>
      {contacts.map((c, idx) => <div key={idx} style={{ display: 'grid', gridTemplateColumns: '70px 100px 70px 26px', gap: 4, alignItems: 'center', padding: '5px 6px', border: '1px solid #e0e0e0', borderRadius: 8, background: '#fafafa' }}>
        <input value={c.name || ''} placeholder='姓名' onChange={e => updateContactField(r, idx, 'name', e.target.value)} onClick={e => e.stopPropagation()} style={{ ...SMALL_INPUT, fontWeight: 600, borderColor: '#bbdefb' }} />
        <input value={c.phone || ''} placeholder='电话' onChange={e => updateContactField(r, idx, 'phone', e.target.value)} onClick={e => e.stopPropagation()} style={{ ...SMALL_INPUT, fontFamily: 'monospace', borderColor: '#bbdefb' }} />
        <input value={c.title || ''} placeholder='职务' onChange={e => updateContactField(r, idx, 'title', e.target.value)} onClick={e => e.stopPropagation()} style={SMALL_INPUT} />
        <button title='删除联系人' onClick={e => { e.stopPropagation(); removeContact(r, idx) }} style={{ width: 24, height: 24, border: 'none', borderRadius: 6, background: '#ffebee', color: '#c62828', cursor: 'pointer', fontSize: 13 }}>×</button>
      </div>)}
      <button onClick={e => { e.stopPropagation(); addContact(r) }} style={{ alignSelf: 'flex-start', padding: '3px 9px', border: '1px dashed #64b5f6', background: '#e3f2fd', color: '#1565c0', borderRadius: 999, cursor: 'pointer', fontSize: 11 }}>+ 联系人</button>
    </div>
  }

  /* ── 主营业务 / 栽培信息 ── */
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
        .finally(() => setSavingIds(p => { const n = { ...p }; delete n[sk]; return n }))
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
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 560 }}>
      {savingIds[r._id + '_business_items'] && <span style={{ color: '#ef6c00', fontSize: 11 }}>保存中...</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: '1px solid #ffe082', borderRadius: 8, background: '#fffde7' }}>
        <span style={{ fontSize: 10, color: '#1565c0', fontWeight: 600, whiteSpace: 'nowrap' }}>公司地址:</span>
        {savingIds[r._id + '_company_address'] && <span style={{ color: '#ef6c00', fontSize: 10 }}>保存中</span>}
        <input value={editingAddr[r._id] !== undefined ? editingAddr[r._id] : (r.company_info?.address || '')} onChange={e => setEditingAddr(p => ({ ...p, [r._id]: e.target.value }))} style={{ ...SMALL_INPUT, flex: 1, borderColor: '#ffe082' }} placeholder='公司注册地址' onClick={e => e.stopPropagation()} />
        {editingAddr[r._id] !== undefined && editingAddr[r._id] !== (r.company_info?.address || '') && (
          <button onClick={e => { e.stopPropagation(); const addr = editingAddr[r._id]?.trim(); if (!addr) { alert('请输入公司地址'); return }; updateItem(r._id, 'company_address', addr); setEditingAddr(p => { const n = {...p}; delete n[r._id]; return n }); handleGeocode(r._id, addr) }} style={{ padding: '2px 8px', border: '1px solid #3E7B5B', background: '#3E7B5B', color: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>💾 保存</button>
        )}
        {editingAddr[r._id] !== undefined && (
          <button onClick={e => { e.stopPropagation(); setEditingAddr(p => { const n = {...p}; delete n[r._id]; return n }) }} style={{ padding: '2px 6px', border: '1px solid #ccc', background: '#f5f5f5', color: '#666', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>✕</button>
        )}
      </div>
      {list.map((b, idx) => <div key={idx} style={{ display: 'grid', gridTemplateColumns: '110px 150px 70px 80px 110px 26px', gap: 4, alignItems: 'center', padding: '5px 6px', border: '1px solid #e0e0e0', borderRadius: 8, background: '#fafafa' }}>
        <input value={b.main_business || ''} placeholder='主营业务' onChange={e => updateBusinessItemField(r, idx, 'main_business', e.target.value)} onClick={e => e.stopPropagation()} style={{ ...SMALL_INPUT, fontWeight: 600, borderColor: '#bbdefb' }} />
        {(r.longitude != null && r.latitude != null) ? (
          <span style={{ fontSize: 10, color: '#2e7d32', fontFamily: 'monospace', fontWeight: 500, padding: '4px 6px', border: '1px solid #c8e6c9', borderRadius: 4, background: '#e8f5e9', textAlign: 'center', whiteSpace: 'nowrap' }}>
            {r.longitude.toFixed(6)}, {r.latitude.toFixed(6)}
          </span>
        ) : (
          <span style={{ fontSize: 10, color: '#999', padding: '4px 6px', border: '1px solid #e0e0e0', borderRadius: 4, background: '#fafafa', textAlign: 'center' }}>待生成</span>
        )}
        <input value={b.planting_area ?? ''} placeholder='面积(亩)' onChange={e => updateBusinessItemField(r, idx, 'planting_area', e.target.value)} onClick={e => e.stopPropagation()} style={{ ...SMALL_INPUT, textAlign: 'center' }} />
        <input value={b.estimated_inventory ?? ''} placeholder='库存' onChange={e => updateBusinessItemField(r, idx, 'estimated_inventory', e.target.value)} onClick={e => e.stopPropagation()} style={{ ...SMALL_INPUT, textAlign: 'center' }} />
        <input value={b.sales_period || ''} placeholder='销售期，如3-5月' onChange={e => updateBusinessItemField(r, idx, 'sales_period', e.target.value)} onClick={e => e.stopPropagation()} style={SMALL_INPUT} />
        <button title='删除业务行' onClick={e => { e.stopPropagation(); removeBusinessItem(r, idx) }} style={{ width: 24, height: 24, border: 'none', borderRadius: 6, background: '#ffebee', color: '#c62828', cursor: 'pointer', fontSize: 13 }}>×</button>
      </div>)}
      <button onClick={e => { e.stopPropagation(); addBusinessItem(r) }} style={{ alignSelf: 'flex-start', padding: '3px 9px', border: '1px dashed #64b5f6', background: '#e3f2fd', color: '#1565c0', borderRadius: 999, cursor: 'pointer', fontSize: 11 }}>+ 主营/种植信息</button>
    </div>
  }

  /* ── 新增行业务项 ── */
  const updateNewBusinessItemField = (idx, field, value) => setNewRow(p => {
    const next = [...(p.business_items || [emptyBusinessItem()])]
    next[idx] = { ...(next[idx] || emptyBusinessItem()), [field]: value }
    return { ...p, business_items: next }
  })
  const renderNewBusinessItems = () => <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 560 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: '1px solid #ffe082', borderRadius: 8, background: '#fffde7' }}>
      <span style={{ fontSize: 10, color: '#1565c0', fontWeight: 600, whiteSpace: 'nowrap' }}>公司地址:</span>
      <input value={newRow.company_address} onChange={e => setNewRow(p => ({ ...p, company_address: e.target.value }))} style={{ ...SMALL_INPUT, flex: 1, borderColor: '#ffe082' }} placeholder='公司注册地址' onClick={e => e.stopPropagation()} />
      <span style={{ fontSize: 10, color: '#999' }}>经纬度: 保存后生成</span>
    </div>
    {(newRow.business_items || [emptyBusinessItem()]).map((b, idx) => <div key={idx} style={{ display: 'grid', gridTemplateColumns: '110px 150px 70px 80px 110px 26px', gap: 4, alignItems: 'center' }}>
      <input value={b.main_business || ''} onChange={e => updateNewBusinessItemField(idx, 'main_business', e.target.value)} placeholder='主营业务' style={SMALL_INPUT} />
      <span style={{ fontSize: 10, color: '#999', padding: '4px 6px', border: '1px solid #e0e0e0', borderRadius: 4, background: '#fafafa', textAlign: 'center' }}>保存后生成</span>
      <input value={b.planting_area ?? ''} onChange={e => updateNewBusinessItemField(idx, 'planting_area', e.target.value)} placeholder='面积' style={SMALL_INPUT} />
      <input value={b.estimated_inventory ?? ''} onChange={e => updateNewBusinessItemField(idx, 'estimated_inventory', e.target.value)} placeholder='库存' style={SMALL_INPUT} />
      <input value={b.sales_period || ''} onChange={e => updateNewBusinessItemField(idx, 'sales_period', e.target.value)} placeholder='销售期' style={SMALL_INPUT} />
      <button onClick={() => setNewRow(p => ({ ...p, business_items: (p.business_items || []).filter((_, i) => i !== idx).length ? (p.business_items || []).filter((_, i) => i !== idx) : [emptyBusinessItem()] }))} style={{ width: 24, height: 24, border: 'none', borderRadius: 6, background: '#ffebee', color: '#c62828', cursor: 'pointer' }}>×</button>
    </div>)}
    <button onClick={() => setNewRow(p => ({ ...p, business_items: [...(p.business_items || []), emptyBusinessItem()] }))} style={{ alignSelf: 'flex-start', padding: '3px 9px', border: '1px dashed #64b5f6', background: '#e3f2fd', color: '#1565c0', borderRadius: 999, cursor: 'pointer', fontSize: 11 }}>+ 主营/种植信息</button>
  </div>

  /* ── 统计 ── */
  const stats = [
    { label: '总供应商', value: filteredItems.length, color: '#1976d2', icon: '🏢' },
    { label: '已完成', value: filteredItems.filter(x => x.status === '已完成').length, color: '#2e7d32', icon: '✅' },
    { label: '待整理', value: filteredItems.filter(x => x.status === '待整理').length, color: '#ef6c00', icon: '⏳' },
    { label: '合同异常', value: filteredItems.filter(x => x.status === '合同异常').length, color: '#c62828', icon: '⚠️' },
  ]

  /* ── 表格样式 ── */
  const thBase = { padding: '10px 10px', borderBottom: '2px solid #3E7B5B', fontWeight: 700, fontSize: 12, color: '#2e5230', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#f1f8e9', userSelect: 'none', textAlign: 'left', letterSpacing: 0.2, fontFamily: "'Microsoft YaHei','微软雅黑',sans-serif" }
  const tdBase = { padding: '8px 10px', borderBottom: '1px solid #e0e0e0', fontSize: 13, verticalAlign: 'middle', overflow: 'visible', color: '#333', fontFamily: "'Microsoft YaHei','微软雅黑',sans-serif" }

  return (
    <div style={{ padding: 16, background: '#F5F7F4', minHeight: 'calc(100vh - 48px)', fontFamily: "'Microsoft YaHei','微软雅黑',sans-serif", fontSize: 14 }}>

      {/* ============ 顶部统计条 ============ */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        {stats.map((s, i) => (
          <div key={i} style={{ flex: 1, background: '#fff', borderRadius: 12, padding: '14px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: s.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: 12, color: '#888' }}>{s.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ============ 快速筛选 + 操作栏 ============ */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap', background: '#fff', padding: 12, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #e0e0e0' }}>
        <div style={{ position: 'relative' }}>
          <input ref={supplierInputRef} value={supplierFilter} onChange={e => handleSupplierFilterChange(e.target.value)}
            onFocus={() => { if (supplierFilter.trim()) setShowSuggestions(true) }}
            placeholder='搜索供应商/商家名称' style={{ ...INPUT_BASE, width: 200, fontSize: 12, padding: '5px 8px' }} />
          {supplierFilter && <button onClick={() => { setSupplierFilter(''); setShowSuggestions(false) }} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#999', padding: 0, lineHeight: 1 }}>×</button>}
          {showSuggestions && <div ref={suggestionsRef} style={{ position: 'absolute', top: '100%', left: 0, zIndex: 1000, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, maxHeight: 200, overflowY: 'auto', width: 260, boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
            {allSupplierNames.filter(n => n.toLowerCase().includes(supplierFilter.toLowerCase())).map((name, i) => <div key={i} onClick={() => { setSupplierFilter(name); setShowSuggestions(false) }} onMouseDown={e => e.preventDefault()} style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }} onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'} onMouseLeave={e => e.currentTarget.style.background = '#fff'}>{name}</div>)}
          </div>}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder='搜索联系人/税号/备注' style={{ ...INPUT_BASE, width: 200, fontSize: 12, padding: '5px 8px' }} />
        <input value={regionFilter} onChange={e => setRegionFilter(e.target.value)} placeholder='按地区筛选' style={{ ...INPUT_BASE, width: 140, fontSize: 12, padding: '5px 8px' }} />
        <input value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} placeholder='主营品类' style={{ ...INPUT_BASE, width: 140, fontSize: 12, padding: '5px 8px' }} />
        <input value={salesPeriodFilter} onChange={e => setSalesPeriodFilter(e.target.value)} placeholder='销售期' style={{ ...INPUT_BASE, width: 120, fontSize: 12, padding: '5px 8px' }} />
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...INPUT_BASE, width: 110, fontSize: 12, padding: '5px 8px', cursor: 'pointer' }}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s === '全部' ? '' : s}>{s === '全部' ? '全部状态' : s}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#666' }}>共 {filteredItems.length} 家</span>
        {isSavingOrder && <span style={{ fontSize: 12, color: '#ef6c00' }}>排序中...</span>}
        <div style={{ flex: 1 }} />

        {/* 导出 */}
        <button onClick={handleBatchExport} disabled={exporting}
          style={{ padding: '5px 14px', background: exporting ? '#ccc' : '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, cursor: exporting ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 500 }}>
          {exporting ? '导出中...' : (selectedIds.size > 0 ? `📤 导出选中(${selectedIds.size})` : '📤 导出Excel')}
        </button>
        {/* 删除 */}
        <button onClick={handleBatchDelete} disabled={batchDeleting || selectedIds.size === 0}
          style={{ padding: '5px 14px', background: (batchDeleting || selectedIds.size === 0) ? '#ccc' : '#c62828', color: '#fff', border: 'none', borderRadius: 6, cursor: (batchDeleting || selectedIds.size === 0) ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 500 }}>
          {batchDeleting ? '删除中...' : (selectedIds.size > 0 ? `🗑️ 删除选中(${selectedIds.size})` : '🗑️ 删除选中')}
        </button>
        {/* 新增 */}
        <button onClick={() => setShowNewRow(true)} disabled={showNewRow} style={{ padding: '5px 14px', background: showNewRow ? '#ccc' : '#3E7B5B', color: '#fff', border: 'none', borderRadius: 6, cursor: showNewRow ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 500 }}>
          {showNewRow ? '编辑中...' : '➕ 新增供应商'}
        </button>
      </div>

      {/* 选中提示 */}
      {selectedIds.size > 0 && (
        <div style={{ marginBottom: 8, padding: '5px 12px', background: '#fff', borderRadius: 6, border: '1px solid #bbdefb', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#333' }}>
          <span style={{ color: '#1565c0', fontWeight: 600 }}>已选中 {selectedIds.size} 条</span>
          <button onClick={clearSelection} style={{ fontSize: 11, padding: '2px 8px', border: '1px solid #ccc', borderRadius: 4, background: '#f5f5f5', cursor: 'pointer', color: '#666' }}>取消选择</button>
        </div>
      )}

      {/* ============ 表格区域 ============ */}
      <div style={{ overflow: 'auto', background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid #e0e0e0', maxHeight: 'calc(100vh - 310px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>{[
            { w: 32, t: <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} style={{ cursor: 'pointer' }} /> },
            { w: 36, t: '☰' },
            { w: 300, t: '供应商名称 / 商家名称' },
            { w: 100, t: '状态' },
            { w: 280, t: '联系人' },
            { w: 150, t: '税号' },
            { w: 560, t: '主营业务 / 经纬度 / 面积 / 库存 / 销售期' },
            { w: 140, t: '营业执照' },
            { w: 140, t: '合同电子版' },
            { w: 120, t: '下发文件' },
            { w: 60, t: '商品数' },
            { w: 240, t: '备注' },
            { w: 110, t: '更新时间' },
            { w: 90, t: '操作' },
          ].map((h, i) => <th key={i} style={{ ...thBase, width: h.w, minWidth: h.w }}>{h.t}</th>)}</tr></thead>
          <tbody>
            {(() => {
              if (loading) return <tr><td colSpan={14} style={{ textAlign: 'center', padding: 30, color: '#888' }}>加载中...</td></tr>
              const rows = []
              if (showNewRow) {
                rows.push(
                  <tr key="__new" style={{ background: '#fffde7', borderBottom: '1px solid #ffe082' }}>
                    <td style={{ ...tdBase, textAlign: 'center' }}><span style={{ color: '#ef6c00', fontSize: 12, fontWeight: 600 }}>新</span></td>
                    <td style={{ ...tdBase, textAlign: 'center', color: '#ef6c00', fontSize: 16 }}>➕</td>
                    <td style={{ ...tdBase, minWidth: 300 }}>
                      <textarea value={newRow.name} onChange={e => setNewRow(p => ({ ...p, name: e.target.value }))} placeholder='供应商名称 *' style={{ ...INPUT_BASE, minWidth: 280, resize: 'vertical', fontWeight: 700, color: '#2e5230' }} autoFocus rows={2} onClick={e => e.stopPropagation()} />
                      <input value={newRow.shop_name} onChange={e => setNewRow(p => ({ ...p, shop_name: e.target.value }))} placeholder='商家名称' style={{ ...SMALL_INPUT, marginTop: 4, fontWeight: 500, borderColor: '#c5e1a5' }} onClick={e => e.stopPropagation()} />
                    </td>
                    <td style={tdBase}>
                      <select value={newRow.status} onChange={e => setNewRow(p => ({ ...p, status: e.target.value }))} style={{ ...SMALL_INPUT, borderRadius: 999, background: STATUS_COLORS['待整理'].bg, color: STATUS_COLORS['待整理'].c, fontWeight: 600, cursor: 'pointer', outline: 'none' }}>
                        {EDITABLE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={{ ...tdBase, fontSize: 11 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '70px 100px 70px', gap: 4 }}>
                        <input value={newRow.contact_name} onChange={e => setNewRow(p => ({ ...p, contact_name: e.target.value }))} placeholder='姓名' style={SMALL_INPUT} />
                        <input value={newRow.contact_phone} onChange={e => setNewRow(p => ({ ...p, contact_phone: e.target.value }))} placeholder='电话' style={{ ...SMALL_INPUT, fontFamily: 'monospace' }} />
                        <input placeholder='职务' style={SMALL_INPUT} disabled />
                      </div>
                    </td>
                    <td style={{ ...tdBase, fontSize: 11 }}><input value={newRow.tax_id} onChange={e => setNewRow(p => ({ ...p, tax_id: e.target.value }))} placeholder='税号' style={SMALL_INPUT} /></td>
                    <td style={{ ...tdBase, fontSize: 11 }}>{renderNewBusinessItems()}</td>
                    <td style={tdBase} colSpan={3}><span style={{ fontSize: 11, color: '#999' }}>创建后再上传文件</span></td>
                    <td style={{ ...tdBase, textAlign: 'center', fontSize: 13, color: '#999' }}>—</td>
                    <td style={{ ...tdBase, minWidth: 240 }}><textarea value={newRow.notes} onChange={e => setNewRow(p => ({ ...p, notes: e.target.value }))} placeholder='备注' style={{ ...INPUT_BASE, minWidth: 220, resize: 'vertical' }} rows={2} onClick={e => e.stopPropagation()} /></td>
                    <td style={{ ...tdBase, fontSize: 11, color: '#999' }}>新建</td>
                    <td style={tdBase}>
                      <div style={{ display: 'flex', gap: 4, flexDirection: 'column' }}>
                        <button onClick={handleNewRowSave} disabled={newRowSaving || !newRow.name.trim()} style={{ padding: '4px 10px', background: newRowSaving ? '#ccc' : '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, cursor: newRowSaving ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 600 }}>{newRowSaving ? '保存...' : '💾 保存'}</button>
                        <button onClick={handleNewRowCancel} disabled={newRowSaving} style={{ padding: '4px 10px', background: '#f5f5f5', color: '#666', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>❌ 取消</button>
                      </div>
                    </td>
                  </tr>
                )
              }
              if (filteredItems.length === 0 && !showNewRow) {
                rows.push(<tr key="__empty"><td colSpan={14} style={{ textAlign: 'center', padding: 30, color: '#888' }}>{(supplierFilter || search || status || regionFilter || categoryFilter || salesPeriodFilter) ? '没有匹配的供应商' : '暂无数据'}</td></tr>)
                return rows
              }
              filteredItems.map((r, i) => {
                const sc = STATUS_COLORS[r.status] || STATUS_COLORS['待整理']
                const saving = (field) => savingIds[r._id + '_' + field]
                const isDragging = dragIndex === i
                const isDropTarget = dropTargetIndex === i && dragIndex !== i
                const isAbnormal = r.status === '合同异常'
                let rowBg = i % 2 === 0 ? '#fff' : '#fafafa'
                if (isAbnormal) rowBg = '#FFECEC'
                if (isDragging) rowBg = '#e8f5e9'
                if (isDropTarget) rowBg = '#fffde7'
                const selected = selectedIds.has(r._id)
                if (selected) rowBg = '#e8f5e9'
                rows.push(
                  <tr key={r._id} draggable onDragStart={(e) => handleDragStart(e, i)} onDragEnd={handleDragEnd} onDragOver={(e) => handleDragOver(e, i)} onDrop={(e) => { e.preventDefault() }}
                    style={{ borderBottom: '1px solid #e0e0e0', background: rowBg, cursor: 'grab', opacity: isDragging ? 0.5 : 1, boxShadow: isDropTarget ? '0 -2px 0 0 #3E7B5B inset' : 'none' }}
                    onMouseEnter={e => { if (!isDragging) e.currentTarget.style.background = '#f1f8e9' }}
                    onMouseLeave={e => { if (!isDragging) e.currentTarget.style.background = selected ? '#e8f5e9' : (isAbnormal ? '#FFECEC' : (i % 2 === 0 ? '#fff' : '#fafafa')) }}>
                    <td style={{ ...tdBase, textAlign: 'center', padding: '4px 6px' }}>
                      <input type="checkbox" checked={selected} onChange={() => toggleSelect(r._id)} onClick={e => e.stopPropagation()} style={{ cursor: 'pointer' }} />
                    </td>
                    <td style={{ ...tdBase, textAlign: 'center', padding: '4px 6px', color: '#bbb', fontSize: 16, cursor: 'grab' }} title='拖拽调整排序'>☰</td>
                    <td style={{ ...tdBase, minWidth: 300, maxWidth: 340 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <textarea title={r.name} value={r.name || ''} onChange={e => updateItem(r._id, 'name', e.target.value)} style={{ ...INPUT_BASE, minWidth: 280, resize: 'vertical', fontWeight: 700, color: '#2e5230', fontSize: 14 }} rows={2} onClick={e => e.stopPropagation()} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 10, color: '#888', fontWeight: 500, whiteSpace: 'nowrap' }}>商家:</span>
                          {saving('shop_name') && <span style={{ color: '#ef6c00', fontSize: 10 }}>...</span>}
                          <input value={r.shop_name || ''} onChange={e => handleShopNameChange(r._id, e.target.value)} style={{ ...SMALL_INPUT, fontWeight: 500, borderColor: '#c5e1a5', flex: 1 }} placeholder='商家名称' onClick={e => e.stopPropagation()} />
                        </div>
                      </div>
                    </td>
                    <td style={tdBase}>
                      {saving('status') && <span style={{ color: '#ef6c00', fontSize: 10 }}>...</span>}
                      <select value={r.status || '待整理'} onChange={e => updateItem(r._id, 'status', e.target.value)} onClick={e => e.stopPropagation()}
                        style={{ width: '100%', padding: '4px 6px', border: 'none', borderRadius: 999, fontSize: 12, background: sc.bg, color: sc.c, cursor: 'pointer', outline: 'none', fontWeight: 600 }}>
                        {EDITABLE_STATUSES.map(s => <option key={s} value={s}>{STATUS_ICON[s]} {s}</option>)}
                      </select>
                    </td>
                    <td style={{ ...tdBase, fontSize: 11 }}>
                      {savingIds[r._id + '_contacts'] && <span style={{ color: '#ef6c00', fontSize: 10 }}>保存中 </span>}
                      {renderContacts(r)}
                    </td>
                    <td style={{ ...tdBase, fontSize: 11 }}>
                      {saving('tax_id') && <span style={{ color: '#ef6c00', fontSize: 10 }}>...</span>}
                      <input value={r.company_info?.tax_id || ''} onChange={e => updateItem(r._id, 'tax_id', e.target.value)} style={{ ...SMALL_INPUT, fontFamily: 'monospace' }} placeholder='税号' onClick={e => e.stopPropagation()} />
                    </td>
                    <td style={{ ...tdBase, fontSize: 11 }}>{renderBusinessItems(r)}</td>
                    <td style={tdBase}>{renderFiles(r.license_files || [], 'license', r)}</td>
                    <td style={tdBase}>{renderFiles(r.contract_files || [], 'contract', r)}</td>
                    <td style={tdBase}>{renderFiles(r.dispatch_files || [], 'dispatch', r)}</td>
                    <td style={{ ...tdBase, textAlign: 'center', fontWeight: 600, fontSize: 13, color: '#1565c0' }}>{productCounts[r.shop_name] ?? productCounts[r.name] ?? r.product_count ?? 0}</td>
                    <td style={{ ...tdBase, minWidth: 240, maxWidth: 300 }}>
                      {saving('notes') && <span style={{ color: '#ef6c00', fontSize: 10 }}>...</span>}
                      <textarea value={r.notes || ''} onChange={e => updateItem(r._id, 'notes', e.target.value)} style={{ ...INPUT_BASE, minWidth: 220, resize: 'vertical' }} placeholder='备注' rows={2} onClick={e => e.stopPropagation()} />
                    </td>
                    <td style={{ ...tdBase, fontSize: 11, color: '#999' }}>{fmtDate(r.updatedAt)}</td>
                    <td style={tdBase}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <button onClick={e => { e.stopPropagation(); goShop(r) }} onMouseDown={e => e.stopPropagation()} style={{ padding: '3px 0', border: '1px solid #7e57c2', background: '#f3e5f5', color: '#7e57c2', borderRadius: 4, cursor: 'pointer', fontSize: 11, textAlign: 'center', width: '100%' }}>🏪 店铺</button>
                        <button onClick={e => { e.stopPropagation(); window.open('http://100.96.54.109:3006/' + '?supplierId=' + r._id + '&name=' + encodeURIComponent(r.name), '_blank') }} style={{ padding: '3px 0', border: '1px solid #2e7d32', background: '#e8f5e9', color: '#2e7d32', borderRadius: 4, cursor: 'pointer', fontSize: 11, textAlign: 'center', width: '100%' }}>📄 合同</button>
                        <button onClick={e => { e.stopPropagation(); goProducts(r) }} onMouseDown={e => e.stopPropagation()} style={{ padding: '3px 0', border: '1px solid #1565c0', background: '#e3f2fd', color: '#1565c0', borderRadius: 4, cursor: 'pointer', fontSize: 11, textAlign: 'center', width: '100%' }}>🛒 商品</button>
                        <button onClick={e => handleDelete(e, r._id)} style={{ padding: '3px 0', border: '1px solid #c62828', background: '#ffebee', color: '#c62828', borderRadius: 4, cursor: 'pointer', fontSize: 11, textAlign: 'center', width: '100%' }}>🗑️ 删除</button>
                      </div>
                    </td>
                  </tr>
                )
              })
              return rows
            })()}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: '#888', textAlign: 'center' }}>
        直接在输入框中修改，自动保存 | ☰ 拖拽排序 | 勾选后批量删除/导出 | 合同异常行标红背景
      </div>
    </div>
  )
}
