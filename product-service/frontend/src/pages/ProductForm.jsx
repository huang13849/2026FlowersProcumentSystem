import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function ProductForm() {
  const nav = useNavigate();
  const [form, setForm] = useState({});
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();

  const set = (k, v) => setForm(f => ({...f, [k]: v}));

  const uploadImg = async e => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    try {
      const r = await api.post('/images/upload-multiple', fd);
      setImages(i => [...i, ...(r.data.urls || [])]);
    } catch (e) { alert('上传失败'); }
    setUploading(false);
    fileRef.current.value = '';
  };

  const save = async () => {
    if (!form.title) return alert('请输入商品标题');
    try {
      await api.post('/products', { ...form, images });
      nav('/');
    } catch (e) { alert('保存失败: ' + (e.response?.data?.error || e.message)); }
  };

  const fields = [
    ['title','商品标题','text',true], ['productId','SKU','text'], ['category','分类','text'],
    ['sellerName','商家名称','text'], ['flowerName','花卉名称','text'], ['specSize','规格尺寸','text'],
    ['potColorNotes','备注','text'], ['deliveryMethod','履约方式','text'], ['origin','发货地','text'],
    ['weight','重量(kg)','number'], ['stock','库存','number'], ['costPrice','成本价','number'],
    ['sellPrice','销售价','number'], ['profit','利润','number'],
  ];

  return (
    <div style={{ padding:20, maxWidth:700, margin:'0 auto' }}>
      <h2 style={{ marginBottom:16, fontSize:16 }}>新增商品</h2>

      <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:12 }}>
        {images.map((url,i) => (
          <div key={i} style={{ position:'relative' }}>
            <img src={url} alt="" style={{ width:56, height:56, borderRadius:4, objectFit:'cover' }} />
            <span onClick={() => setImages(ii => ii.filter(x => x !== url))}
              style={{ position:'absolute', top:-3, right:-3, width:16, height:16, borderRadius:'50%', background:'#ff4d4f', color:'#fff', fontSize:10, lineHeight:'16px', textAlign:'center', cursor:'pointer' }}>×</span>
          </div>
        ))}
        <label style={{ width:56, height:56, border:'2px dashed #d9d9d9', borderRadius:4, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#aaa', fontSize:22 }}>
          {uploading ? '⏳' : '+'}
          <input ref={fileRef} type="file" multiple accept="image/*" onChange={uploadImg} style={{ display:'none' }} />
        </label>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        {fields.map(([k, label, type, required]) => (
          <div key={k}>
            <label style={{ fontSize:12, color:'#555' }}>{label}{required?' *':''}</label>
            <input type={type} value={form[k] ?? ''} onChange={e => set(k, type==='number' ? (e.target.value===''?'':Number(e.target.value)) : e.target.value)}
              style={{ width:'100%', padding:'6px 8px', border:'1px solid #d9d9d9', borderRadius:4, fontSize:13 }} />
          </div>
        ))}
      </div>

      <div style={{ marginTop:16, display:'flex', gap:8 }}>
        <button onClick={save} style={{ padding:'7px 24px', background:'#1a1a2e', color:'#fff', border:'none', borderRadius:4, fontSize:13, cursor:'pointer' }}>💾 保存</button>
        <button onClick={() => nav('/')} style={{ padding:'7px 24px', background:'#fff', border:'1px solid #d9d9d9', borderRadius:4, fontSize:13, cursor:'pointer' }}>取消</button>
      </div>
    </div>
  );
}
