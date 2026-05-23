import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api'

const ACCEPTED_TYPES = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp'
const IMAGE_TYPES = ['jpg','jpeg','png','gif','webp']
const MAX_SIZE_MB = 50

function isImage(name) {
  const ext = name?.split('.').pop()?.toLowerCase()
  return IMAGE_TYPES.includes(ext)
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / 1024 / 1024).toFixed(1) + 'MB'
}

function FileIcon({ name }) {
  const ext = name?.split('.').pop()?.toLowerCase()
  const icons = { pdf: '📄', doc: '📝', docx: '📝', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🎞️', webp: '🖼️' }
  return <span style={{ fontSize: 20, marginRight: 6 }}>{icons[ext] || '📎'}</span>
}

export default function SupplierDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const [sup, setSup] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState({ contracts: false, licenses: false })
  const [preview, setPreview] = useState(null) // { url, name }
  const [toast, setToast] = useState(null)

  const showToast = (msg, type = 'error') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    setLoading(true)
    api.get('/api/suppliers/' + id).then(r => setSup(r.data)).catch(() => showToast('加载失败')).finally(() => setLoading(false))
  }, [id])

  const handleUpload = async (e, type) => {
    const files = e.target.files
    if (!files?.length) return

    // Client-side validation
    for (const f of files) {
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        showToast(`${f.name} 超过 ${MAX_SIZE_MB}MB 限制`)
        e.target.value = ''
        return
      }
    }

    const key = type === 'contracts' ? 'contracts' : 'licenses'
    setUploading(u => ({ ...u, [key]: true }))

    try {
      const fd = new FormData()
      fd.append('type', type)
      for (const f of files) fd.append('files', f)
      const r = await api.post('/api/upload/multiple', fd)
      const uploaded = r.data.files || []
      const field = type === 'contracts' ? 'contract_files' : 'license_files'
      const upd = {}
      upd[field] = [...(sup[field] || []), ...uploaded]
      await api.put('/api/suppliers/' + id, upd)
      setSup(s => ({ ...s, [field]: [...(s[field] || []), ...uploaded] }))
      showToast(`成功上传 ${uploaded.length} 个文件`, 'success')
    } catch (err) {
      showToast('上传失败: ' + (err.response?.data?.error || err.message))
    }
    setUploading(u => ({ ...u, [key]: false }))
    e.target.value = ''
  }

  const handleDeleteFile = async (field, fileIndex) => {
    const files = sup[field] || []
    const file = files[fileIndex]
    if (!confirm(`确认删除「${file.name}」？`)) return
    const upd = {}
    upd[field] = files.filter((_, i) => i !== fileIndex)
    try {
      await api.put('/api/suppliers/' + id, upd)
      setSup(s => ({ ...s, [field]: upd[field] }))
      showToast('已删除', 'success')
    } catch (err) {
      showToast('删除失败')
    }
  }

  const FileList = ({ files = [], field, title, uploadType }) => (
    <div style={{ background: '#fff', borderRadius: 8, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      <h4 style={{ fontSize: 14, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{title}</span>
        <span style={{ fontSize: 11, color: '#999' }}>{files.length} 个文件</span>
      </h4>

      {/* Uploaded files */}
      {files.length === 0 && (
        <div style={{ padding: '16px 0', textAlign: 'center', color: '#bbb', fontSize: 12 }}>暂无文件</div>
      )}
      {files.map((f, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 8px', marginBottom: 4,
          borderRadius: 6, background: '#f8f9fa',
          border: '1px solid #eee',
          transition: 'background 0.2s',
        }}
          onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
          onMouseLeave={e => e.currentTarget.style.background = '#f8f9fa'}
        >
          <FileIcon name={f.name} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f.name}
            </div>
            {f.size && <div style={{ fontSize: 10, color: '#999' }}>{formatSize(f.size)}</div>}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {isImage(f.name) ? (
              <button onClick={() => setPreview({ url: f.url, name: f.name })}
                style={{ padding: '3px 6px', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11, background: '#e6f7ff', color: '#1890ff' }}>
                预览
              </button>
            ) : (
              <a href={f.url} target="_blank" rel="noopener noreferrer"
                style={{ padding: '3px 6px', borderRadius: 4, fontSize: 11, background: '#f0f5ff', color: '#1890ff', textDecoration: 'none' }}>
                下载
              </a>
            )}
            <button onClick={() => handleDeleteFile(field, i)}
              style={{ padding: '3px 6px', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11, background: '#fff2f0', color: '#ff4d4f' }}>
              删除
            </button>
          </div>
        </div>
      ))}

      {/* Upload area */}
      <label style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        marginTop: 10, padding: '10px 0',
        border: '1px dashed #d9d9d9', borderRadius: 6,
        cursor: uploading[uploadType] ? 'wait' : 'pointer',
        fontSize: 12, color: uploading[uploadType] ? '#1890ff' : '#888',
        background: uploading[uploadType] ? '#e6f7ff' : 'transparent',
        transition: 'all 0.2s',
      }}>
        {uploading[uploadType] ? (
          <>
            <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #1890ff', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            上传中...
          </>
        ) : (
          <>
            <span>📤</span> 上传文件（支持 PDF / Word / 图片，≤{MAX_SIZE_MB}MB）
          </>
        )}
        <input type="file" multiple accept={ACCEPTED_TYPES}
          onChange={e => handleUpload(e, uploadType)}
          disabled={uploading[uploadType]}
          style={{ display: 'none' }} />
      </label>
    </div>
  )

  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>加载中...</div>
  if (!sup) return <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>供应商不存在</div>

  return (
    <div style={{ padding: 12, background: '#f5f5f5', minHeight: 'calc(100vh - 48px)' }}>
      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000, padding: '8px 20px', borderRadius: 6,
          background: toast.type === 'success' ? '#f6ffed' : '#fff2f0',
          border: `1px solid ${toast.type === 'success' ? '#b7eb8f' : '#ffccc7'}`,
          color: toast.type === 'success' ? '#52c41a' : '#ff4d4f',
          fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Image preview lightbox */}
      {preview && (
        <div onClick={() => setPreview(null)} style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'rgba(0,0,0,0.7)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          cursor: 'zoom-out',
        }}>
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <button onClick={() => setPreview(null)}
              style={{ position: 'absolute', top: -32, right: 0, background: 'none', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer' }}>
              ✕
            </button>
            <img src={preview.url} alt={preview.name}
              style={{ maxWidth: '100%', maxHeight: '85vh', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }} />
            <div style={{ textAlign: 'center', color: '#ccc', fontSize: 12, marginTop: 8 }}>{preview.name}</div>
          </div>
        </div>
      )}

      {/* Nav */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => nav('/')} style={{ background: 'none', border: 'none', color: '#1890ff', cursor: 'pointer', fontSize: 13 }}>&larr; 返回</button>
        <button onClick={() => nav('/suppliers/' + id + '/edit')}
          style={{ padding: '4px 12px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
          编辑信息
        </button>
      </div>

      {/* Supplier Info */}
      <div style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.05)', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, fontWeight: 'bold' }}>
            {sup.name?.[0] || '?'}
          </div>
          <div>
            <h3 style={{ fontSize: 18, margin: 0 }}>{sup.name}</h3>
            <span style={{
              display: 'inline-block', padding: '2px 10px', borderRadius: 10, fontSize: 11, marginTop: 4,
              background: sup.status === '已完成' ? '#e6fffb' : sup.status === '合同异常' ? '#fff2f0' : '#fff7e6',
              color: sup.status === '已完成' ? '#13c2c2' : sup.status === '合同异常' ? '#ff4d4f' : '#fa8c16',
            }}>
              {sup.status}
            </span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16, fontSize: 13 }}>
          <div><b>联系人:</b> {sup.contact?.name || '—'}</div>
          <div><b>电话:</b> {sup.contact?.phone || '—'}</div>
          <div><b>微信:</b> {sup.contact?.wechat || '—'}</div>
          <div><b>税号:</b> {sup.company_info?.tax_id || '—'}</div>
          <div><b>地址:</b> {sup.company_info?.address || '—'}</div>
          <div><b>主营:</b> {sup.company_info?.main_business || '—'}</div>
        </div>
        {sup.notes && (
          <div style={{ marginTop: 12, padding: 10, background: '#f8f8f8', borderRadius: 4, fontSize: 12, color: '#666' }}>
            <b>备注:</b> {sup.notes}
          </div>
        )}
      </div>

      {/* Contract & License Files */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <FileList files={sup.contract_files} field="contract_files" title="📋 合同文件" uploadType="contracts" />
        <FileList files={sup.license_files} field="license_files" title="🏢 营业执照 / 资质" uploadType="licenses" />
      </div>

      {/* Related Products */}
      <div style={{ background: '#fff', borderRadius: 8, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <h4 style={{ fontSize: 14, marginBottom: 8 }}>关联商品: {sup.product_count || 0}</h4>
        <p style={{ color: '#888', fontSize: 12 }}>点击列表中的供应商行，可在商品系统查看该供应商的商品</p>
      </div>

      {/* Spin animation */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
