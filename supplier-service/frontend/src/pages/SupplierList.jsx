import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'

const STATUS_OPTIONS = ['全部','已完成','待签章','已下发','合同异常','待补资料']
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
  const nav = useNavigate()
  const timer = useRef()

  const load = async () => {
    setLoading(true)
    try {
      const p = {}
      if (search) p.search = search
      if (status) p.status = status
      const r = await api.get('/api/suppliers', { params: p })
      setItems(r.data.suppliers || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(load, 300)
    return () => clearTimeout(timer.current)
  }, [search, status])

  const goProducts = (s) => {
    window.open('http://100.96.54.109:3001/#/?supplier_id=' + s._id, '_blank')
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    if (!confirm('确认删除？')) return
    await api.delete('/api/suppliers/' + id)
    load()
  }

  const fmt = (d) => d ? new Date(d).toLocaleDateString('zh-CN') : '\u2014'

  const stats = [
    { label: '总供应商', value: items.length, color: '#1890ff' },
    { label: '已完成', value: items.filter(x => x.status === '已完成').length, color: '#13c2c2' },
    { label: '待签章', value: items.filter(x => x.status === '待签章').length, color: '#fa8c16' },
    { label: '合同异常', value: items.filter(x => x.status === '合同异常').length, color: '#ff4d4f' },
  ]

  return (
    <div style={{padding:12,background:'#f5f5f5',minHeight:'calc(100vh - 48px)'}}>
      {/* Stats */}
      <div style={{display:'flex',gap:12,marginBottom:12}}>
        {stats.map((s, i) => (
          <div key={i} style={{flex:1,background:'#fff',borderRadius:8,padding:'12px 20px',boxShadow:'0 1px 4px rgba(0,0,0,0.05)'}}>
            <div style={{fontSize:12,color:'#888'}}>{s.label}</div>
            <div style={{fontSize:24,fontWeight:700,color:s.color}}>{s.value}</div>
          </div>
        ))}
      </div>
      {/* Toolbar */}
      <div style={{display:'flex',gap:8,marginBottom:8,alignItems:'center',flexWrap:'wrap'}}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={'\uD83D\uDD0D \u641C\u7D22\u5546\u5BB6 / \u8054\u7CFB\u4EBA / \u7A0E\u53F7'}
          style={{padding:'6px 10px',border:'1px solid #d9d9d9',borderRadius:4,width:240,fontSize:13}} />
        <select value={status} onChange={e => setStatus(e.target.value)}
          style={{padding:'5px 8px',border:'1px solid #d9d9d9',borderRadius:4,fontSize:12}}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s === '全部' ? '' : s}>{s === '全部' ? '全部状态' : s}</option>)}
        </select>
        <span style={{fontSize:12,color:'#888'}}>共 {items.length} 家</span>
        <div style={{flex:1}} />
        <button onClick={() => nav('/suppliers/new')}
          style={{padding:'5px 12px',background:'#1a1a2e',color:'#fff',border:'none',borderRadius:4,cursor:'pointer',fontSize:12}}>+ 新增供应商</button>
      </div>
      {/* Table */}
      <div style={{overflow:'auto',background:'#fff',borderRadius:8,boxShadow:'0 1px 4px rgba(0,0,0,0.05)',maxHeight:'calc(100vh - 260px)'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead>
            <tr style={{background:'#f7f7f7',position:'sticky',top:0}}>
              <th style={th}>商家名称</th><th style={{...th,width:90}}>状态</th>
              <th style={{...th,width:130}}>联系人</th><th style={{...th,width:60}}>商品数</th>
              <th style={{...th,width:120}}>合同</th><th style={{...th,width:90}}>更新时间</th>
              <th style={{...th,width:60}}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{textAlign:'center',padding:24,color:'#888'}}>加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} style={{textAlign:'center',padding:24,color:'#888'}}>暂无数据</td></tr>
            ) : items.map((r, i) => {
              const sc = STATUS_COLORS[r.status] || STATUS_COLORS['待签章']
              return (
                <tr key={r._id} style={{borderBottom:'1px solid #f0f0f0',background:i%2===0?'#fff':'#fafcff',height:50,cursor:'pointer'}}
                  onMouseEnter={e => e.currentTarget.style.background='#f0f7ff'}
                  onMouseLeave={e => e.currentTarget.style.background=i%2===0?'#fff':'#fafcff'}
                  onClick={() => goProducts(r)}>
                  <td style={td}><strong>{r.name}</strong></td>
                  <td style={td}><span style={{display:'inline-block',padding:'2px 8px',borderRadius:10,fontSize:11,background:sc.bg,color:sc.c}}>{r.status}</span></td>
                  <td style={{...td,fontSize:11}}>{r.contact?.name || '\u2014'}<br/><span style={{color:'#999'}}>{r.contact?.phone || ''}</span></td>
                  <td style={{...td,textAlign:'center',fontWeight:600}}>{r.product_count || 0}</td>
                  <td style={td}>{(r.contract_files||[]).slice(0,2).map((f,i) => <a key={i} href={f.url} target="_blank" onClick={e=>e.stopPropagation()} style={{fontSize:11,color:'#1890ff',marginRight:4}}>{f.name}</a>)||'\u2014'}</td>
                  <td style={{...td,fontSize:11,color:'#999'}}>{fmt(r.updatedAt)}</td>
                  <td style={td}>
                    <button onClick={e=>{e.stopPropagation();nav('/suppliers/'+r._id)}} style={{padding:'2px 6px',border:'none',borderRadius:4,cursor:'pointer',fontSize:14,background:'transparent'}}>📋</button>
                    <button onClick={e=>handleDelete(e,r._id)} style={{padding:'2px 6px',border:'none',borderRadius:4,cursor:'pointer',fontSize:14,background:'transparent'}}>🗑️</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
const th = {padding:'6px 8px',borderBottom:'2px solid #e8e8e8',fontWeight:600,fontSize:11,color:'#555',whiteSpace:'nowrap',position:'sticky',top:0,background:'#f7f7f7',userSelect:'none',textAlign:'left'}
const td = {padding:'4px 6px',borderBottom:'1px solid #f0f0f0',fontSize:12,verticalAlign:'middle',overflow:'hidden'}
