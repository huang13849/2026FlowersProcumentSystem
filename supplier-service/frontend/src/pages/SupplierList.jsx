import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'

const STATUS_OPTIONS = ['全部','已完成','待签章','已下发','合同异常','待补资料']
const EDITABLE_STATUSES = ['已完成','待签章','已下发','合同异常','待补资料']
const STATUS_COLORS = {
  '已完成':{bg:'#e6fffb',c:'#13c2c2'}, '待签章':{bg:'#fff7e6',c:'#fa8c16'},
  '已下发':{bg:'#e6f7ff',c:'#1890ff'}, '合同异常':{bg:'#fff2f0',c:'#ff4d4f'},
  '待补资料':{bg:'#fffbe6',c:'#d4b106'},
}

export default function SupplierList() {
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingIds, setSavingIds] = useState({})
  const [uploadingId, setUploadingId] = useState(null)
  // 商家名称筛选
  const [supplierFilter, setSupplierFilter] = useState('')
  const [supplierSuggestions, setSupplierSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [allSupplierNames, setAllSupplierNames] = useState([])
  const supplierInputRef = useRef(null)
  const suggestionsRef = useRef(null)
  // drag state
  const [dragIndex, setDragIndex] = useState(null)
  const [dropTargetIndex, setDropTargetIndex] = useState(null)
  const [isSavingOrder, setIsSavingOrder] = useState(false)
  // export state
  const [exporting, setExporting] = useState(false)
  const dragRowRef = useRef(null)

  const nav = useNavigate()
  const timer = useRef()
  const debounceTimers = useRef({})

  const load = async () => {
    setLoading(true)
    try {
      const p = {}
      if (search) p.search = search
      if (status) p.status = status
      const r = await api.get('/api/suppliers', { params: p })
      const data = r.data.suppliers || []
      setItems(data)
      // 提取所有商家名称用于筛选建议
      const names = [...new Set(data.map(s => s.name).filter(Boolean))]
      setAllSupplierNames(names)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(load, 300)
    return () => clearTimeout(timer.current)
  }, [search, status])

  // 商家名称筛选：输入时过滤建议
  const handleSupplierFilterChange = (value) => {
    setSupplierFilter(value)
    if (value.trim()) {
      const filtered = allSupplierNames.filter(name =>
        name.toLowerCase().includes(value.toLowerCase())
      )
      setSupplierSuggestions(filtered)
      setShowSuggestions(filtered.length > 0)
    } else {
      setSupplierSuggestions([])
      setShowSuggestions(false)
    }
  }

  const selectSupplier = (name) => {
    setSupplierFilter(name)
    setShowSuggestions(false)
  }

  // 点击外部关闭建议列表
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target) &&
          supplierInputRef.current && !supplierInputRef.current.contains(e.target)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 根据商家名称筛选过滤后的数据
  const filteredItems = supplierFilter.trim()
    ? items.filter(item => item.name && item.name.toLowerCase().includes(supplierFilter.toLowerCase()))
    : items

  // ── Excel 导出 ──
  const handleExport = async () => {
    setExporting(true)
    try {
      // 动态加载 xlsx 库
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')

      const exportData = filteredItems.map((r, i) => ({
        '序号': i + 1,
        '商家名称': r.name || '',
        '状态': r.status || '',
        '联系人': r.contact?.name || '',
        '联系电话': r.contact?.phone || '',
        '微信号': r.contact?.wechat || '',
        '统一社会信用代码': r.company_info?.tax_id || '',
        '地址': r.company_info?.address || '',
        '主营业务': r.company_info?.main_business || '',
        '商品数': r.product_count || 0,
        '合同文件数': (r.contract_files || []).length,
        '营业执照文件数': (r.license_files || []).length,
        '备注': r.notes || '',
        '更新时间': r.updatedAt ? new Date(r.updatedAt).toLocaleDateString('zh-CN') : '',
      }))

      const ws = XLSX.utils.json_to_sheet(exportData)
      // 设置列宽
      ws['!cols'] = [
        { wch: 6 },   // 序号
        { wch: 24 },  // 商家名称
        { wch: 10 },  // 状态
        { wch: 12 },  // 联系人
        { wch: 14 },  // 联系电话
        { wch: 14 },  // 微信号
        { wch: 22 },  // 统一社会信用代码
        { wch: 30 },  // 地址
        { wch: 20 },  // 主营业务
        { wch: 8 },   // 商品数
        { wch: 10 },  // 合同文件数
        { wch: 12 },  // 营业执照文件数
        { wch: 20 },  // 备注
        { wch: 12 },  // 更新时间
      ]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '供应商列表')
      const filename = `供应商列表_${new Date().toISOString().slice(0,10)}.xlsx`
      XLSX.writeFile(wb, filename)
    } catch (e) {
      console.error('Export failed:', e)
      alert('导出失败: ' + e.message)
    }
    setExporting(false)
  }

  const goProducts = (s) => {
    window.open('http://100.96.54.109:3001/#/?supplier_id=' + s._id, '_blank')
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    if (!confirm('确认删除？')) return
    await api.delete('/api/suppliers/' + id)
    load()
  }

  const updateItem = (rowId, field, value) => {
    const saveKey = rowId + '_' + field
    setSavingIds(prev => ({ ...prev, [saveKey]: true }))

    const item = items.find(x => x._id === rowId)
    if (!item) return

    let updateData = {}
    if (field === 'name') updateData = { name: value }
    else if (field === 'status') updateData = { status: value }
    else if (field === 'product_count') updateData = { product_count: parseInt(value) || 0 }
    else if (field === 'contact_name') updateData = { contact: { ...item.contact, name: value } }
    else if (field === 'contact_phone') updateData = { contact: { ...item.contact, phone: value } }
    else if (field === 'tax_id') updateData = { company_info: { ...item.company_info, tax_id: value } }

    setItems(prev => prev.map(x => {
      if (x._id !== rowId) return x
      if (field === 'contact_name') return { ...x, contact: { ...x.contact, name: value } }
      else if (field === 'contact_phone') return { ...x, contact: { ...x.contact, phone: value } }
      else if (field === 'tax_id') return { ...x, company_info: { ...x.company_info, tax_id: value } }
      else return { ...x, [field]: value }
    }))

    clearTimeout(debounceTimers.current[saveKey])
    debounceTimers.current[saveKey] = setTimeout(() => {
      api.put('/api/suppliers/' + rowId, updateData)
        .catch(e => console.error('Update failed', e))
        .finally(() => {
          setSavingIds(prev => {
            const next = { ...prev }
            delete next[saveKey]
            return next
          })
        })
    }, 500)
  }

  // ── Drag & Drop reorder ──
  const handleDragStart = (e, index) => {
    setDragIndex(index)
    setDropTargetIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.currentTarget.style.opacity = '0.4'
  }

  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1'
    if (dragIndex !== null && dropTargetIndex !== null && dragIndex !== dropTargetIndex) {
      const newItems = [...items]
      const [moved] = newItems.splice(dragIndex, 1)
      newItems.splice(dropTargetIndex, 0, moved)
      setItems(newItems)
      saveOrder(newItems)
    }
    setDragIndex(null)
    setDropTargetIndex(null)
  }

  const handleDragOver = (e, index) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropTargetIndex !== index) {
      setDropTargetIndex(index)
    }
  }

  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      // keep dropTargetIndex as-is
    }
  }

  const saveOrder = async (orderedItems) => {
    setIsSavingOrder(true)
    try {
      const orders = orderedItems.map((item, i) => ({
        id: item._id,
        sortOrder: (i + 1) * 10
      }))
      await api.post('/api/suppliers/reorder', { orders })
    } catch (e) {
      console.error('Reorder save failed', e)
      alert('排序保存失败，请重试')
      load()
    }
    setIsSavingOrder(false)
  }

  const handleLicenseUpload = async (supplierId, file) => {
    setUploadingId(supplierId)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('supplier_id', supplierId)
      formData.append('type', 'license')
      
      const res = await api.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      
      setItems(prev => prev.map(x => {
        if (x._id !== supplierId) return x
        const newFile = { name: file.name, url: res.data.url || res.data.file_url }
        return { ...x, license_files: [...(x.license_files || []), newFile] }
      }))
      
    } catch (e) {
      console.error('Upload failed:', e)
      alert('上传失败: ' + (e.response?.data?.error || e.message))
    }
    setUploadingId(null)
  }

  const triggerUpload = (supplierId) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,.jpg,.jpeg,.png'
    input.onchange = (e) => {
      if (e.target.files?.[0]) {
        handleLicenseUpload(supplierId, e.target.files[0])
      }
    }
    input.click()
  }

  const fmt = (d) => d ? new Date(d).toLocaleDateString('zh-CN') : '-'

  const stats = [
    { label: '总供应商', value: filteredItems.length, color: '#1890ff' },
    { label: '已完成', value: filteredItems.filter(x => x.status === '已完成').length, color: '#13c2c2' },
    { label: '待签章', value: filteredItems.filter(x => x.status === '待签章').length, color: '#fa8c16' },
    { label: '合同异常', value: filteredItems.filter(x => x.status === '合同异常').length, color: '#ff4d4f' },
  ]

  const inputStyle = {
    width: '100%',
    padding: '4px 6px',
    border: '1px solid #e8e8e8',
    borderRadius: 4,
    fontSize: 12,
    background: '#fff',
    outline: 'none',
  }

  const getVisualIndex = (index) => {
    if (dragIndex === null || dropTargetIndex === null) return index
    if (index === dragIndex) return dropTargetIndex
    if (dragIndex < dropTargetIndex) {
      if (index > dragIndex && index <= dropTargetIndex) return index - 1
    } else if (dragIndex > dropTargetIndex) {
      if (index >= dropTargetIndex && index < dragIndex) return index + 1
    }
    return index
  }

  return (
    <div style={{padding:12,background:'#f5f5f5',minHeight:'calc(100vh - 48px)'}}>
      {/* 统计卡片 */}
      <div style={{display:'flex',gap:12,marginBottom:12}}>
        {stats.map((s, i) => (
          <div key={i} style={{flex:1,background:'#fff',borderRadius:8,padding:'12px 20px',boxShadow:'0 1px 4px rgba(0,0,0,0.05)'}}>
            <div style={{fontSize:12,color:'#888'}}>{s.label}</div>
            <div style={{fontSize:24,fontWeight:700,color:s.color}}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* 筛选栏 */}
      <div style={{display:'flex',gap:8,marginBottom:8,alignItems:'center',flexWrap:'wrap'}}>
        {/* 商家名称筛选框 - 带搜索匹配下拉 */}
        <div style={{position:'relative'}}>
          <input 
            ref={supplierInputRef}
            value={supplierFilter} 
            onChange={e => handleSupplierFilterChange(e.target.value)}
            onFocus={() => {
              if (supplierFilter.trim()) {
                const filtered = allSupplierNames.filter(name =>
                  name.toLowerCase().includes(supplierFilter.toLowerCase())
                )
                if (filtered.length > 0) {
                  setSupplierSuggestions(filtered)
                  setShowSuggestions(true)
                }
              }
            }}
            placeholder='🏷️ 筛选商家名称'
            style={{padding:'6px 10px',border:'1px solid #d9d9d9',borderRadius:4,width:220,fontSize:13}} 
          />
          {supplierFilter && (
            <button 
              onClick={() => { setSupplierFilter(''); setSupplierSuggestions([]); setShowSuggestions(false); }}
              style={{position:'absolute',right:6,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',fontSize:14,color:'#999',padding:0,lineHeight:1}}
              title="清除筛选"
            >✕</button>
          )}
          {/* 搜索匹配下拉列表 */}
          {showSuggestions && (
            <div ref={suggestionsRef} style={{
              position:'absolute',top:'100%',left:0,zIndex:1000,
              background:'#fff',border:'1px solid #d9d9d9',borderRadius:4,
              maxHeight:200,overflowY:'auto',width:280,
              boxShadow:'0 4px 12px rgba(0,0,0,0.15)',
            }}>
              {supplierSuggestions.map((name, i) => (
                <div 
                  key={i}
                  onClick={() => selectSupplier(name)}
                  onMouseDown={e => e.preventDefault()}
                  style={{
                    padding:'6px 10px',fontSize:12,cursor:'pointer',
                    borderBottom:'1px solid #f0f0f0',
                    background:'#fff',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background='#e6f7ff'}
                  onMouseLeave={e => e.currentTarget.style.background='#fff'}
                >
                  {name}
                </div>
              ))}
            </div>
          )}
        </div>

        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder='🔍 搜索联系人 / 税号 / 备注'
          style={{padding:'6px 10px',border:'1px solid #d9d9d9',borderRadius:4,width:220,fontSize:13}} />
        <select value={status} onChange={e => setStatus(e.target.value)}
          style={{padding:'5px 8px',border:'1px solid #d9d9d9',borderRadius:4,fontSize:12}}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s === '全部' ? '' : s}>{s === '全部' ? '全部状态' : s}</option>)}
        </select>
        <span style={{fontSize:12,color:'#888'}}>共 {filteredItems.length} 家{(supplierFilter || search || status) ? '（已筛选）' : ''}</span>
        {isSavingOrder && <span style={{fontSize:12,color:'#fa8c16'}}>⏳ 保存排序中...</span>}
        <div style={{flex:1}} />
        
        {/* 导出 Excel 按钮 */}
        <button onClick={handleExport} disabled={exporting || filteredItems.length === 0}
          style={{
            padding:'5px 14px',
            background: exporting ? '#d9d9d9' : '#52c41a',
            color:'#fff',border:'none',borderRadius:4,cursor: exporting ? 'not-allowed' : 'pointer',
            fontSize:12,fontWeight:500,display:'flex',alignItems:'center',gap:4,
          }}>
          {exporting ? '⏳ 导出中...' : '📊 导出Excel'}
        </button>

        <button onClick={() => nav('/suppliers/new')}
          style={{padding:'5px 12px',background:'#1a1a2e',color:'#fff',border:'none',borderRadius:4,cursor:'pointer',fontSize:12}}>+ 新增供应商</button>
      </div>

      {/* 表格 */}
      <div style={{overflow:'auto',background:'#fff',borderRadius:8,boxShadow:'0 1px 4px rgba(0,0,0,0.05)',maxHeight:'calc(100vh - 260px)'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead>
            <tr style={{background:'#f7f7f7',position:'sticky',top:0,zIndex:1}}>
              <th style={{...th,width:40,textAlign:'center'}}>☰</th>
              <th style={th}>商家名称</th>
              <th style={{...th,width:90}}>状态</th>
              <th style={{...th,width:90}}>联系人</th>
              <th style={{...th,width:110}}>联系电话</th>
              <th style={{...th,width:150}}>社会统一识别码</th>
              <th style={{...th,width:60}}>商品数</th>
              <th style={{...th,width:100}}>合同</th>
              <th style={{...th,width:100}}>营业执照</th>
              <th style={{...th,width:80}}>更新时间</th>
              <th style={{...th,width:70}}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} style={{textAlign:'center',padding:24,color:'#888'}}>加载中...</td></tr>
            ) : filteredItems.length === 0 ? (
              <tr><td colSpan={11} style={{textAlign:'center',padding:24,color:'#888'}}>
                {(supplierFilter || search || status) ? '没有匹配的供应商' : '暂无数据'}
              </td></tr>
            ) : filteredItems.map((r, i) => {
              const sc = STATUS_COLORS[r.status] || STATUS_COLORS['待签章']
              const saving = (field) => savingIds[r._id + '_' + field]
              const uploading = uploadingId === r._id
              const isDragging = dragIndex === i
              const isDropTarget = dropTargetIndex === i && dragIndex !== i

              let rowBackground = i%2===0?'#fff':'#fafcff'
              if (isDragging) rowBackground = '#e6f7ff'
              if (isDropTarget) rowBackground = '#fffbe6'

              return (
                <tr key={r._id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, i)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => { e.preventDefault() }}
                  style={{
                    borderBottom: '1px solid #f0f0f0',
                    background: rowBackground,
                    height: 44,
                    transition: 'background 0.15s, transform 0.15s, box-shadow 0.15s',
                    cursor: 'grab',
                    opacity: isDragging ? 0.5 : 1,
                    boxShadow: isDropTarget ? '0 -2px 0 0 #1890ff inset' : 'none',
                  }}
                  onMouseEnter={e => { if (!isDragging) e.currentTarget.style.background='#f0f7ff' }}
                  onMouseLeave={e => { if (!isDragging) e.currentTarget.style.background=i%2===0?'#fff':'#fafcff' }}
                >
                  <td style={{...td,textAlign:'center',padding:'2px 4px',color:'#bbb',fontSize:16,cursor:'grab'}}
                    title="拖拽此行调整排序">
                    ☰
                  </td>
                  <td style={td}>
                    <strong>
                      {saving('name') && '⏳ '}
                      <input value={r.name} onChange={e => updateItem(r._id, 'name', e.target.value)} style={inputStyle}
                        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} />
                    </strong>
                  </td>
                  <td style={td}>
                    {saving('status') && '⏳ '}
                    <select value={r.status} onChange={e => updateItem(r._id, 'status', e.target.value)}
                      onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                      style={{width:'100%',padding:'3px 6px',border:'none',borderRadius:10,fontSize:11,background:sc.bg,color:sc.c,cursor:'pointer',outline:'none'}}>
                      {EDITABLE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{...td,fontSize:11}}>
                    {saving('contact_name') && '⏳ '}
                    <input value={r.contact?.name || ''} onChange={e => updateItem(r._id, 'contact_name', e.target.value)}
                      style={{...inputStyle,fontSize:11}} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} />
                  </td>
                  <td style={{...td,fontSize:11,color:'#666'}}>
                    {saving('contact_phone') && '⏳ '}
                    <input value={r.contact?.phone || ''} onChange={e => updateItem(r._id, 'contact_phone', e.target.value)}
                      style={{...inputStyle,fontSize:11}} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} />
                  </td>
                  <td style={{...td,fontSize:11}}>
                    {saving('tax_id') && '⏳ '}
                    <input value={r.company_info?.tax_id || ''} onChange={e => updateItem(r._id, 'tax_id', e.target.value)}
                      style={{...inputStyle,fontSize:11,fontFamily:'monospace'}} placeholder='输入统一识别码'
                      onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} />
                  </td>
                  <td style={{...td,textAlign:'center',fontWeight:600}}>
                    {saving('product_count') && '⏳ '}
                    <input type='number' min='0' value={r.product_count || 0} onChange={e => updateItem(r._id, 'product_count', e.target.value)}
                      style={{width:60,padding:'3px 6px',border:'1px solid #e8e8e8',borderRadius:4,fontSize:12,textAlign:'center',outline:'none'}}
                      onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} />
                  </td>
                  <td style={td}>
                    {(r.contract_files||[]).length > 0 ? (
                      <div>
                        <span style={{fontSize:11,fontWeight:600,color:'#52c41a'}}>{(r.contract_files||[]).length} 份</span>
                        <div style={{fontSize:10}}>
                          {(r.contract_files||[]).slice(0,2).map((f,i) => (
                            <a key={i} href={f.url} target='_blank' onClick={e=>e.stopPropagation()} style={{color:'#1890ff',textDecoration:'none',display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</a>
                          ))}
                        </div>
                      </div>
                    ) : <span style={{color:'#999',fontSize:11}}>-</span>}
                  </td>
                  <td style={td}>
                    <div>
                      {(r.license_files||[]).length > 0 ? (
                        <div>
                          <span style={{fontSize:11,fontWeight:600,color:'#1890ff'}}>{(r.license_files||[]).length} 份</span>
                          <div style={{fontSize:10}}>
                            {(r.license_files||[]).slice(0,2).map((f,i) => (
                              <a key={i} href={f.url} target='_blank' onClick={e=>e.stopPropagation()} style={{color:'#1890ff',textDecoration:'none',display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</a>
                            ))}
                          </div>
                        </div>
                      ) : <span style={{color:'#999',fontSize:11}}>-</span>}
                    </div>
                    <button onClick={e=>{e.stopPropagation();triggerUpload(r._id)}} disabled={uploading}
                      onMouseDown={e=>e.stopPropagation()}
                      style={{padding:'2px 8px',border:'1px dashed #52c41a',background:'#f6ffed',color:'#52c41a',borderRadius:4,cursor:'pointer',fontSize:10,marginTop:4}}>
                      {uploading ? '上传中...' : '📄 上传'}
                    </button>
                  </td>
                  <td style={{...td,fontSize:11,color:'#999'}}>{fmt(r.updatedAt)}</td>
                  <td style={td}>
                    <button onClick={e=>{e.stopPropagation();goProducts(r)}} onMouseDown={e=>e.stopPropagation()}
                      style={{padding:'3px 8px',border:'1px solid #1890ff',background:'#e6f7ff',color:'#1890ff',borderRadius:4,cursor:'pointer',fontSize:11,marginRight:4}}>
                      商品
                    </button>
                    <button onClick={e=>handleDelete(e,r._id)} onMouseDown={e=>e.stopPropagation()}
                      style={{padding:'2px 6px',border:'none',borderRadius:4,cursor:'pointer',fontSize:14,background:'transparent'}}>🗑️</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:8,fontSize:11,color:'#999',textAlign:'center'}}>
        💡 直接在输入框中修改，自动保存 | ⏳ 表示正在保存 | ☰ 拖拽行可调整排序 | 📊 导出Excel 导出当前筛选结果
      </div>
    </div>
  )
}
const th = {padding:'6px 8px',borderBottom:'2px solid #e8e8e8',fontWeight:600,fontSize:11,color:'#555',whiteSpace:'nowrap',position:'sticky',top:0,background:'#f7f7f7',userSelect:'none',textAlign:'left'}
const td = {padding:'4px 6px',borderBottom:'1px solid #f0f0f0',fontSize:12,verticalAlign:'middle',overflow:'hidden'}
