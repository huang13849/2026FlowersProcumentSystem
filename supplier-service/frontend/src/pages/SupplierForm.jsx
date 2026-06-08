import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../api'

const STATUSES = ['已完成','待签章','已下发','合同异常','待补资料']
const SALES_PERIODS = ['全年', '春季', '夏季', '秋季', '冬季', '3-5月', '9-11月']

export default function SupplierForm() {
  const { id } = useParams()
  const isEdit = !!id
  const nav = useNavigate()
  const [form, setForm] = useState({
    name:'', status:'待签章',
    contact:{name:'',phone:'',wechat:''},
    company_info:{tax_id:'',address:'',main_business:''},
    notes:'', address:'',
    planting_area: null, estimated_inventory: null,
    sales_period: [], longitude: null, latitude: null,
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [geocoding, setGeocoding] = useState(false)

  useEffect(() => {
    if (isEdit) {
      setLoading(true)
      api.get('/api/suppliers/' + id).then(r => {
        const d = r.data
        setForm({
          name:d.name||'', status:d.status||'待签章',
          contact:d.contact||{name:'',phone:'',wechat:''},
          company_info:d.company_info||{tax_id:'',address:'',main_business:''},
          notes:d.notes||'', address:d.address||'',
          planting_area:d.planting_area||null, estimated_inventory:d.estimated_inventory||null,
          sales_period:d.sales_period||[], longitude:d.longitude||null, latitude:d.latitude||null,
        })
      }).finally(() => setLoading(false))
    }
  }, [id])

  const h = (k, v) => setForm(f => ({...f, [k]: v}))
  const hn = (p, k, v) => setForm(f => ({...f, [p]: {...f[p], [k]: v}}))

  const handleAddressBlur = async () => {
    if (!form.address.trim()) return
    setGeocoding(true)
    try {
      const r = await api.post('/api/suppliers/geocode', { address: form.address })
      if (r.data.longitude && r.data.latitude) {
        setForm(f => ({...f, longitude: r.data.longitude, latitude: r.data.latitude}))
      }
    } catch (e) { console.warn('地址解析失败:', e.message) }
    setGeocoding(false)
  }

  const toggleSalesPeriod = (period) => {
    setForm(f => ({
      ...f,
      sales_period: f.sales_period.includes(period)
        ? f.sales_period.filter(p => p !== period)
        : [...f.sales_period, period]
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        ...form,
        planting_area: form.planting_area ? Number(form.planting_area) : null,
        estimated_inventory: form.estimated_inventory ? Number(form.estimated_inventory) : null,
      }
      if (isEdit) await api.put('/api/suppliers/' + id, payload)
      else await api.post('/api/suppliers', payload)
      nav('/')
    } catch (err) { alert('保存失败: ' + (err.response?.data?.error || err.message)) }
    setSaving(false)
  }

  if (loading) return <div style={{padding:24,textAlign:'center',color:'#888'}}>加载中...</div>

  return (
    <div style={{padding:12,background:'#f5f5f5',minHeight:'calc(100vh - 48px)'}}>
      <form onSubmit={submit}>
        <button type="button" onClick={()=>nav('/')} style={{background:'none',border:'none',color:'#1890ff',cursor:'pointer',fontSize:13,marginBottom:12}}>&larr; 返回</button>
        <div style={{background:'#fff',borderRadius:8,padding:20,boxShadow:'0 1px 4px rgba(0,0,0,0.05)',maxWidth:800}}>
          <h3 style={{marginBottom:16,fontSize:16}}>{isEdit ? '编辑' : '新增'}供应商</h3>

          <div style={sectionTitle}>基础信息</div>
          <div style={row}><label style={lb}>商家名称 <span style={{color:'red'}}>*</span></label><input required value={form.name} onChange={e=>h('name',e.target.value)} style={inp} /></div>
          <div style={row}><label style={lb}>状态</label><select value={form.status} onChange={e=>h('status',e.target.value)} style={inp}>{STATUSES.map(s=><option key={s} value={s}>{s}</option>)}</select></div>

          <div style={sectionTitle}>联系人</div>
          <div style={{...row,flexDirection:'column'}}>
            <div style={{display:'flex',gap:8,marginTop:4}}>
              <input value={form.contact.name} onChange={e=>hn('contact','name',e.target.value)} style={inp} placeholder="姓名"/>
              <input value={form.contact.phone} onChange={e=>hn('contact','phone',e.target.value)} style={inp} placeholder="电话"/>
              <input value={form.contact.wechat} onChange={e=>hn('contact','wechat',e.target.value)} style={inp} placeholder="微信"/>
            </div>
          </div>

          <div style={sectionTitle}>公司信息</div>
          <div style={{...row,flexDirection:'column'}}>
            <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:4}}>
              <input value={form.company_info.tax_id} onChange={e=>hn('company_info','tax_id',e.target.value)} style={inp} placeholder="税号"/>
              <input value={form.company_info.address} onChange={e=>hn('company_info','address',e.target.value)} style={inp} placeholder="公司地址"/>
              <input value={form.company_info.main_business} onChange={e=>hn('company_info','main_business',e.target.value)} style={inp} placeholder="主营业务"/>
            </div>
          </div>

          <div style={{...sectionTitle,marginTop:20}}>经营信息 <span style={{fontWeight:400,fontSize:11,color:'#999'}}>(V2.0)</span></div>

          <div style={row}>
            <label style={lb}>经营/种植地址</label>
            <div style={{flex:1,display:'flex',gap:8,alignItems:'center'}}>
              <input value={form.address} onChange={e=>h('address',e.target.value)} onBlur={handleAddressBlur} style={{...inp,flex:1}} placeholder="例如：北京市丰台区花乡路158号" />
              {geocoding && <span style={{fontSize:11,color:'#fa8c16'}}>地址解析中...</span>}
            </div>
          </div>

          {form.longitude && form.latitude && (
            <div style={row}>
              <label style={lb}>经纬度</label>
              <span style={{fontSize:12,color:'#888'}}>
                {form.longitude}, {form.latitude}
                <span style={{marginLeft:8,fontSize:11,color:'#52c41a'}}>（地址解析自动生成）</span>
              </span>
            </div>
          )}

          <div style={row}><label style={lb}>种植面积（亩）</label>
            <input type="number" min="0" step="0.1" value={form.planting_area??''} onChange={e=>h('planting_area',e.target.value?Number(e.target.value):null)} style={inp} placeholder="100" />
          </div>

          <div style={row}><label style={lb}>预估总库存（株/棵）</label>
            <input type="number" min="0" step="1" value={form.estimated_inventory??''} onChange={e=>h('estimated_inventory',e.target.value?Number(e.target.value):null)} style={inp} placeholder="5000" />
          </div>

          <div style={row}><label style={lb}>销售期</label>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,flex:1}}>
              {SALES_PERIODS.map(p => (
                <label key={p} style={{
                  padding:'4px 12px', borderRadius:4, cursor:'pointer', fontSize:12,
                  background: form.sales_period.includes(p) ? '#1a1a2e' : '#f5f5f5',
                  color: form.sales_period.includes(p) ? '#fff' : '#555',
                  border: '1px solid', borderColor: form.sales_period.includes(p) ? '#1a1a2e' : '#d9d9d9',
                  userSelect:'none', transition:'all 0.15s'
                }}>
                  <input type="checkbox" checked={form.sales_period.includes(p)}
                    onChange={() => toggleSalesPeriod(p)} style={{display:'none'}} />
                  {p}
                </label>
              ))}
            </div>
          </div>

          <div style={row}><label style={lb}>备注</label><textarea value={form.notes} onChange={e=>h('notes',e.target.value)} style={{...inp,minHeight:80,resize:'vertical'}} /></div>

          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:20,borderTop:'1px solid #f0f0f0',paddingTop:16}}>
            <button type="button" onClick={()=>nav('/')} style={{padding:'6px 20px',border:'1px solid #d9d9d9',borderRadius:4,background:'#fff',cursor:'pointer',fontSize:13}}>取消</button>
            <button type="submit" disabled={saving} style={{padding:'6px 20px',background:'#1a1a2e',color:'#fff',border:'none',borderRadius:4,cursor:'pointer',fontSize:13}}>{saving ? '保存中...' : (isEdit ? '更新' : '创建')}</button>
          </div>
        </div>
      </form>
    </div>
  )
}
const sectionTitle = { fontSize:13, fontWeight:600, color:'#1a1a2e', marginBottom:12, paddingBottom:4, borderBottom:'1px solid #f0f0f0' }
const row = {display:'flex',alignItems:'flex-start',gap:12,marginBottom:14}
const lb = {minWidth:120,fontSize:13,fontWeight:500,color:'#555',paddingTop:6}
const inp = {padding:'6px 10px',border:'1px solid #d9d9d9',borderRadius:4,fontSize:13,flex:1}
