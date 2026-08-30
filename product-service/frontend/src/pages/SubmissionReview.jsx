import { useEffect, useState } from 'react';
import api from '../api';

const IMAGE_FIELDS = [
  ['主图', 'panorama_images'],
  ['发货包装图', 'package_images'],
  ['细节特写图', 'detail_images'],
  ['根系盆土图', 'root_soil_images'],
  ['尺寸参考图', 'size_ref_images'],
  ['场景应用图', 'scene_images'],
  ['品种卖点图', 'selling_point_images'],
  ['养护教程图', 'care_images'],
  ['规格对比图', 'comparison_images'],
  ['发货与售后图', 'shipping_images'],
  ['售后图', 'after_sale_images'],
];

function list(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || '').split(/[\n,，]/).map(s => s.trim()).filter(Boolean);
}

export default function SubmissionReview({ embedded = false, onChanged, onApproved }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const load = async () => {
    try { setItems((await api.get('/product-submissions?status=pending')).data.submissions || []); }
    catch (e) { setError(e.response?.data?.error || e.message); }
  };
  useEffect(() => { load(); }, []);
  const review = async (id, action) => {
    setBusy(id); setError('');
    try {
      await api.post(`/product-submissions/${id}/${action}`, {});
      await load();
      onChanged?.();
      if (action === 'approve') onApproved?.();
    }
    catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(null); }
  };
  const field = (label, value) => (
    <div style={{ minWidth: 140 }}>
      <div style={{ fontSize: 12, color: '#8c8c8c' }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 13, color: '#262626' }}>{value || '-'}</div>
    </div>
  );

  return <main style={embedded ? { padding: 0 } : { padding: 24, maxWidth: 1200, margin: '0 auto' }}>
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
      <div>
        <h2 style={{ margin:'0 0 6px', fontSize:20 }}>新增商品审核</h2>
        <p style={{ margin:0, color:'#666', fontSize:13 }}>同意后写入现有商品总表，驳回后投稿人可修改并再次提交。</p>
      </div>
      <button onClick={load} disabled={busy !== null} style={{ padding:'7px 14px', border:'1px solid #d9d9d9', borderRadius:4, background:'#fff', cursor:'pointer' }}>刷新</button>
    </div>
    {error && <p style={{ color: '#c62828', background:'#fff1f0', border:'1px solid #ffa39e', padding:10, borderRadius:4 }}>{error}</p>}
    {items.length === 0 && <p style={{ color:'#777', background:'#fafafa', padding:20, border:'1px dashed #d9d9d9', borderRadius:6 }}>暂无待审核投稿。</p>}
    {items.map(item => {
      const product = item.payload || {};
      return <section key={item.id} style={{ border:'1px solid #e5e5e5', borderRadius:6, padding:16, marginBottom:12, background:'#fff' }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'flex-start' }}>
          <div>
            <h3 style={{ margin:'0 0 8px', fontSize:16 }}>{product.title || '未命名商品'}</h3>
            <div style={{ color:'#666', fontSize:12 }}>来源：{item.source_project} · 投稿人：{item.submitter_name || item.submitter_id} · {new Date(item.created_at).toLocaleString()}</div>
          </div>
          <div style={{ whiteSpace:'nowrap' }}>
            <button disabled={busy === item.id} onClick={() => review(item.id, 'approve')} style={{ padding:'7px 14px', border:'1px solid #389e0d', borderRadius:4, background:'#52c41a', color:'#fff', cursor:'pointer' }}>同意并入库</button>
            <button disabled={busy === item.id} onClick={() => review(item.id, 'reject')} style={{ marginLeft:8, padding:'7px 14px', border:'1px solid #ff7875', borderRadius:4, background:'#fff1f0', color:'#cf1322', cursor:'pointer' }}>驳回</button>
          </div>
        </div>
        <div style={{ display:'flex', gap:22, flexWrap:'wrap', marginTop:14, padding:'12px 0', borderTop:'1px solid #f0f0f0' }}>
          {field('商家', product.sellerName)}
          {field('分类', product.category)}
          {field('商品名称', product.flowerName)}
          {field('英文名', product.englishTitle)}
          {field('规格', product.specSize)}
          {field('库存', product.stock)}
          {field('销售价', product.sellPrice)}
          {field('成本价', product.costPrice)}
        </div>
        <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid #f0f0f0' }}>
          <div style={{ fontSize:12, color:'#8c8c8c', marginBottom:8 }}>上传图片</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
            {IMAGE_FIELDS.flatMap(([label, key]) => list(product[key]).map((url, idx) => ({ label, key, url, idx }))).length === 0 && (
              <span style={{ color:'#aaa', fontSize:13 }}>未上传图片</span>
            )}
            {IMAGE_FIELDS.flatMap(([label, key]) => list(product[key]).map((url, idx) => ({ label, key, url, idx }))).map(img => (
              <a key={img.key + img.idx + img.url} href={img.url} target="_blank" rel="noreferrer"
                title={img.label}
                style={{ width:104, textDecoration:'none', color:'#595959' }}>
                <div style={{
                  width:104,
                  height:104,
                  border:'1px solid #e8e8e8',
                  borderRadius:6,
                  background:'#fafafa',
                  overflow:'hidden',
                  display:'flex',
                  alignItems:'center',
                  justifyContent:'center',
                }}>
                  <img src={img.url} alt={img.label} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                </div>
                <div style={{ marginTop:5, fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{img.label}</div>
              </a>
            ))}
          </div>
        </div>
        <details style={{ marginTop:8 }}>
          <summary style={{ cursor:'pointer', color:'#595959', fontSize:13 }}>查看完整投稿数据</summary>
          <pre style={{ whiteSpace:'pre-wrap', background:'#fafafa', padding:10, maxHeight:260, overflow:'auto', border:'1px solid #f0f0f0', borderRadius:4 }}>{JSON.stringify(product, null, 2)}</pre>
        </details>
      </section>;
    })}
  </main>;
}
