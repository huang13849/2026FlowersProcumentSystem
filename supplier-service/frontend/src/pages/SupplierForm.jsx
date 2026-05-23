import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../api'

const STATUSES = ['已完成','待签章','已下发','合同异常','待补资料']

export default function SupplierForm() {
  const { id } = useParams()
  const isEdit = !!id
  const nav = useNavigate()
  const [form, setForm] = useState({name:'',status:'待签章',contact:{name:'',phone:'',wechat:''},company_info:{tax_id:'',address:'',main_business:''},notes:''})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isEdit) {
      setLoading(true)
      api.get('/api/suppliers/' + id).then(r => {
        const d = r.data
        setForm({name:d.name||'',status:d.status||'待签章',contact:d.contact||{name:'',phone:'',wechat:''},company_info:d.company_info||{tax_id:'',address:'',main_business:''},notes:d.notes||''})
      }).finally(() => setLoading(false))
    }
  }, [id])

  const h = (k, v) => setForm(f => ({...f, [k]: v}))
  const hn = (p, k, v) => setForm(f => ({...f, [p]: {...f[p], [k]: v}}))
  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (isEdit) await api.put('/api/suppliers/' + id, form)
      else await api.post('/api/suppliers', form)
      nav('/')
    } catch (err) { alert('保存失败: ' + (err.response?.data?.error || err.message)) }
    setSaving(false)
  }

  if (loading) return <div style={{padding:24,textAlign:'center',color:'#888'}}>加载中...</div>

  return (
    <div style={{padding:12,background:'#f5f5f5',minHeight:'calc(100vh - 48px)'}}>
      <form onSubmit={submit}>
        <button type="button" onClick={()=>nav('/')} style={{background:'none',border:'none',color:'#1890ff',cursor:'pointer',fontSize:13,marginBottom:12}}>&larr; 返回</button>
        <div style={{background:'#fff',borderRadius:8,padding:20,boxShadow:'0 1px 4px rgba(0,0,0,0.05)',maxWidth:720}}>
          <h3 style={{marginBottom:16,fontSize:16}}>{isEdit ? '编辑' : '新增'}供应商</h3>
          <div style={row}><label style={lb}>商家名称 <span style={{color:'red'}}>*</span></label><input required value={form.name} onChange={e=>h('name',e.target.value)} style={inp} /></div>
          <div style={row}><label style={lb}>状态</label><select value={form.status} onChange={e=>h('status',e.target.value)} style={inp}>{STATUSES.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          <div style={{...row,flexDirection:'column'}}><label style={lb}>联系人</label><div style={{display:'flex',gap:8,marginTop:4}}><input value={form.contact.name} onChange={e=>hn('contact','name',e.target.value)} style={inp} placeholder="姓名"/><input value={form.contact.phone} onChange={e=>hn('contact','phone',e.target.value)} style={inp} placeholder="电话"/><input value={form.contact.wechat} onChange={e=>hn('contact','wechat',e.target.value)} style={inp} placeholder="微信"/></div></div>
          <div style={{...row,flexDirection:'column'}}><label style={lb}>公司信息</label><div style={{display:'flex',flexDirection:'column',gap:8,marginTop:4}}><input value={form.company_info.tax_id} onChange={e=>hn('company_info','tax_id',e.target.value)} style={inp} placeholder="税号"/><input value={form.company_info.address} onChange={e=>hn('company_info','address',e.target.value)} style={inp} placeholder="地址"/><input value={form.company_info.main_business} onChange={e=>hn('company_info','main_business',e.target.value)} style={inp} placeholder="主营业务"/></div></div>
          <div style={row}><label style={lb}>备注</label><textarea value={form.notes} onChange={e=>h('notes',e.target.value)} style={{...inp,minHeight:80,resize:'vertical'}} /></div>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:20}}>
            <button type="button" onClick={()=>nav('/')} style={{padding:'6px 20px',border:'1px solid #d9d9d9',borderRadius:4,background:'#fff',cursor:'pointer',fontSize:13}}>取消</button>
            <button type="submit" disabled={saving} style={{padding:'6px 20px',background:'#1a1a2e',color:'#fff',border:'none',borderRadius:4,cursor:'pointer',fontSize:13}}>{saving ? '保存中...' : (isEdit ? '更新' : '创建')}</button>
          </div>
        </div>
      </form>
    </div>
  )
}
const row = {display:'flex',alignItems:'flex-start',gap:12,marginBottom:14}
const lb = {minWidth:80,fontSize:13,fontWeight:500,color:'#555',paddingTop:6}
const inp = {padding:'6px 10px',border:'1px solid #d9d9d9',borderRadius:4,fontSize:13,flex:1}
