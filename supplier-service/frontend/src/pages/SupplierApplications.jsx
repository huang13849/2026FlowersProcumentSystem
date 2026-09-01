import { useEffect, useState } from 'react'
import api from '../api'

const statusText = { pending: '审批中', approved: '已通过', rejected: '已驳回' }
const colors = { pending: '#9a6500', approved: '#17673d', rejected: '#b42318' }

export default function SupplierApplications() {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState('')
  const load = async () => {
    setLoading(true)
    try { setItems((await api.get('/api/supplier-applications', { params: { status } })).data.items || []) }
    catch (error) { alert('加载供应商审批失败：' + (error.response?.data?.error || error.message)) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [status])
  const decide = async (item, decision) => {
    const reviewNote = decision === 'rejected' ? window.prompt('请填写驳回原因：') : window.prompt('审批备注（可留空）：', '')
    if (decision === 'rejected' && !reviewNote?.trim()) return
    try {
      setWorking(String(item.id))
      await api.post(`/api/supplier-applications/${item.id}/decision`, { decision, reviewNote: reviewNote || '' })
      await load()
    } catch (error) { alert('审批失败：' + (error.response?.data?.error || error.message)) }
    finally { setWorking('') }
  }
  return <main style={{ maxWidth: 1360, margin: '0 auto', padding: '24px 20px', fontFamily: 'Arial,"Microsoft YaHei",sans-serif' }}>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}><div><h1 style={{ margin: 0, fontSize: 24 }}>供应商审批</h1><p style={{ color: '#64748b', margin: '8px 0 0' }}>植物联盟银牌会员提交的企业资料在此审批；通过后才加入正式供应商库。</p></div><button onClick={load}>刷新</button></div>
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>{['pending', 'approved', 'rejected'].map(value => <button key={value} onClick={() => setStatus(value)} style={{ border: 0, borderRadius: 20, padding: '8px 14px', cursor: 'pointer', background: status === value ? '#17673d' : '#edf4ee', color: status === value ? '#fff' : '#335743' }}>{statusText[value]}</button>)}</div>
    {loading ? <p>加载中…</p> : !items.length ? <div style={{ padding: 40, textAlign: 'center', color: '#64748b', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>暂无{statusText[status]}申请</div> : <div style={{ display: 'grid', gap: 12 }}>{items.map(item => {
      const p = item.payload || {}; const files = Array.isArray(p.businessLicenseFiles) ? p.businessLicenseFiles : [];
      return <article key={item.id} style={{ background: '#fff', border: '1px solid #dbe6de', borderRadius: 12, padding: 18 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}><div><h2 style={{ margin: 0, fontSize: 18 }}>{item.company_name}</h2><p style={{ margin: '6px 0', color: '#64748b' }}>统一信用代码：{item.credit_code} · 联系人：{p.contactName} / {p.contactPhone}（{p.jobTitle}）</p></div><strong style={{ color: colors[item.status] }}>{statusText[item.status]}</strong></div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10, fontSize: 14, marginTop: 12 }}><div><b>主营业务：</b>{p.mainBusiness || '—'}</div><div><b>公司地址：</b>{p.companyAddress || '—'}</div><div><b>营业执照：</b>{files.length ? files.map((file, index) => <a key={file} href={file} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>查看{index + 1}</a>) : '未上传'}</div></div>{item.review_note ? <p style={{ color: '#b42318', marginBottom: 0 }}>审批说明：{item.review_note}</p> : null}{item.status === 'pending' ? <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button disabled={working === String(item.id)} onClick={() => decide(item, 'approved')} style={{ border: 0, background: '#17673d', color: '#fff', borderRadius: 7, padding: '8px 14px', cursor: 'pointer' }}>通过并加入供应商</button><button disabled={working === String(item.id)} onClick={() => decide(item, 'rejected')} style={{ border: '1px solid #e6a7a7', color: '#b42318', background: '#fff', borderRadius: 7, padding: '8px 14px', cursor: 'pointer' }}>驳回</button></div> : null}</article>
    })}</div>}
  </main>
}
