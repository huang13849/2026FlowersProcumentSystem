import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { gatewayApi } from '../api';

// ── 图片压缩（目标 100KB 以内）──
const IMG_LIMIT = 100 * 1024;
function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      if (file.type && file.type !== '') return resolve(file);
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    let settled = false;
    const cleanup = () => { try { URL.revokeObjectURL(url); } catch {} };
    const done = (f) => { if (settled) return; settled = true; cleanup(); resolve(f); };
    const fail = (e) => { if (settled) return; settled = true; cleanup(); reject(e); };
    const timer = setTimeout(() => fail(new Error('图片处理超时')), 15000);
    img.onerror = () => { clearTimeout(timer); fail(new Error('无法读取该图片')); };
    img.onload = () => {
      clearTimeout(timer);
      try {
        if (file.size <= IMG_LIMIT && /image\/(jpe?g|png|webp)/i.test(file.type)) return done(file);
        let { width, height } = img;
        const MAX_DIM = 1200;
        if (width > MAX_DIM || height > MAX_DIM) {
          const r = Math.min(MAX_DIM / width, MAX_DIM / height);
          width = Math.round(width * r); height = Math.round(height * r);
        }
        const canvas = document.createElement('canvas');
        const tryCompress = (q, curW, curH) => {
          canvas.width = curW; canvas.height = curH;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, curW, curH);
          canvas.toBlob((blob) => {
            if (!blob) return fail(new Error('图片压缩失败'));
            if (blob.size <= IMG_LIMIT || (q <= 0.3 && curW <= 400)) {
              done(new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
            } else if (q <= 0.3) {
              tryCompress(0.5, Math.round(curW * 0.7), Math.round(curH * 0.7));
            } else {
              tryCompress(q - 0.1, curW, curH);
            }
          }, 'image/jpeg', q);
        };
        tryCompress(0.8, width, height);
      } catch (e) { fail(e); }
    };
    img.src = url;
  });
}

export default function ProductForm() {
  const nav = useNavigate();
  const [form, setForm] = useState({});
  const [mainImages, setMainImages] = useState([]);
  const [detailImages, setDetailImages] = useState([]);
  const [uploading, setUploading] = useState(false);

  const mainFileRef = useRef();
  const detailFileRef = useRef();

  useEffect(() => {
    // 支持粘贴上传
    const handlePaste = e => {
      const items = e.clipboardData?.items;
      if (!items?.length) return;
      const files = Array.from(items)
        .filter(item => item.type.startsWith('image/'))
        .map(item => item.getAsFile());
      if (files.length > 0) {
        pasteUploadImages(files);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  const set = (k, v) => setForm(f => ({...f, [k]: v}));

  const uploadImages = async (files, targetArray, setTargetArray) => {
    setUploading(true);
    try {
      const compressed = [];
      for (const f of files) {
        try { compressed.push(await compressImage(f)); } catch (e) { console.warn('压缩失败，使用原图', e); compressed.push(f); }
      }
      const fd = new FormData();
      fd.append('folder', 'products');
      for (const f of compressed) fd.append('files', f);
      const r = await gatewayApi.post('/api/minio/upload-multiple', fd);
      setTargetArray(i => [...i, ...(r.data.files || []).map(f => f.url)]);
    } catch (e) { alert('上传失败'); }
    setUploading(false);
  };

  const pasteUploadImages = async (files) => {
    if (mainImages.length === 0) {
      await uploadImages(files, mainImages, setMainImages);
    } else {
      await uploadImages(files, detailImages, setDetailImages);
    }
  };

  const uploadMainImg = async e => {
    await uploadImages(e.target.files, mainImages, setMainImages);
    mainFileRef.current.value = '';
  };

  const uploadDetailImg = async e => {
    await uploadImages(e.target.files, detailImages, setDetailImages);
    detailFileRef.current.value = '';
  };

  const computedCostPrice = () => {
    return Number(form.settlementPrice || 0) + Number(form.shippingFee || 0);
  };

  const save = async () => {
    if (!form.title) return alert('请输入商品标题');
    if (!form.sellerName) return alert('请输入商家名称');
    try {
      const payload = {
        ...form,
        costPrice: computedCostPrice(),
        main_images: mainImages,
        detail_images: detailImages,
        images: [...mainImages, ...detailImages]
      };
      await api.post('/products', payload);
      nav('/');
    } catch (e) { alert('保存失败: ' + (e.response?.data?.error || e.message)); }
  };

  const fields = [
    ['title','商品标题','text',true], ['englishTitle','英文名','text'], ['productId','SKU','text'], ['category','分类','text'],
    ['sellerName','商家名称','text',true], ['flowerName','花卉名称','text'], ['specSize','规格尺寸','text'],
    ['potColorNotes','备注','text'], ['deliveryMethod','履约方式','text'], ['origin','发货地','text'],
    ['weight','重量(kg)','number'], ['stock','库存','number'],
    ['minOrder','起订量','number'],
    ['settlementPrice','结算价','number'],
    ['shippingFee','运费','number'],
    ['shipping_description','运费说明','select'],
    ['costPrice','成本价','number'],
    ['sellPrice','销售价','number'], ['profit','利润','number'],
  ];

  const renderImageSection = (title, images, setImages, fileRef, uploadFn, color) => (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontSize:13, fontWeight:600, color, marginBottom:8 }}>{title}</div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'flex-start' }}>
        {images.map((url,i) => (
          <div key={i} style={{ position:'relative' }}>
            <img src={url} alt="" style={{ width:72, height:72, borderRadius:6, objectFit:'cover' }} />
            <span onClick={() => setImages(ii => ii.filter(x => x !== url))}
              style={{ position:'absolute', top:-4, right:-4, width:18, height:18, borderRadius:'50%', background:'#ff4d4f', color:'#fff', fontSize:12, lineHeight:'18px', textAlign:'center', cursor:'pointer' }}>×</span>
          </div>
        ))}
        <label style={{ width:72, height:72, border:'2px dashed', borderColor:color, borderRadius:6, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', color, fontSize:22 }}>
          {uploading ? '⏳' : '📷'}
          <span style={{ fontSize:10, marginTop:2 }}>点击/粘贴</span>
          <input ref={fileRef} type="file" multiple accept="image/*" onChange={uploadFn} style={{ display:'none' }} />
        </label>
      </div>
    </div>
  );

  return (
    <div style={{ padding:20, maxWidth:800, margin:'0 auto' }}>
      <h2 style={{ marginBottom:16, fontSize:16 }}>新增商品</h2>

      {renderImageSection('📷 商品主图', mainImages, setMainImages, mainFileRef, uploadMainImg, '#1890ff')}
      {renderImageSection('🖼️ 商品详情图', detailImages, setDetailImages, detailFileRef, uploadDetailImg, '#52c41a')}

      {/* 花期选择（12月可视化）*/}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:13, fontWeight:600, color:'#389e0d', marginBottom:8 }}>🌸 花期（点击选择开花月份）</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
          {Array.from({ length: 12 }, (_, idx) => idx + 1).map(m => {
            const months = form.floweringMonths || [];
            const on = months.includes(m);
            return (
              <span key={m}
                onClick={() => {
                  const cur = form.floweringMonths || [];
                  const next = cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m].sort((a,b)=>a-b);
                  set('floweringMonths', next);
                }}
                style={{
                  width:34, height:30, lineHeight:'30px', textAlign:'center', fontSize:12,
                  cursor:'pointer', userSelect:'none', borderRadius:4,
                  border:'1px solid ' + (on ? '#389e0d' : '#d9d9d9'),
                  background: on ? '#52c41a' : '#fff', color: on ? '#fff' : '#999',
                }}>{m}月</span>
            );
          })}
          <button type="button" onClick={() => set('floweringMonths', (form.floweringMonths||[]).length===12 ? [] : [1,2,3,4,5,6,7,8,9,10,11,12])}
            style={{ padding:'4px 10px', fontSize:12, border:'1px solid #1890ff', color:'#1890ff', background:'#fff', borderRadius:4, cursor:'pointer' }}>
            {(form.floweringMonths||[]).length===12 ? '清空' : '全年'}
          </button>
        </div>
      </div>

      <div style={{ padding:8, background:'#f6ffed', border:'1px solid #b7eb8f', borderRadius:4, marginBottom:16, fontSize:12, color:'#389e0d' }}>
        💡 提示：可以直接粘贴图片（Ctrl+V / Cmd+V）到页面，第一张粘贴为头图，之后粘贴为详情图
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        {fields.map(([k, label, type, required, readonly]) => {
          const isComputed = k === 'costPrice';
          return (
          <div key={k}>
            <label style={{ fontSize:12, color: isComputed ? '#999' : '#555' }}>{label}{required?' *':''}</label>
            {k === 'shipping_description' ? (
              <select value={form[k] || ''} onChange={e => set(k, e.target.value)}
                style={{ width:'100%', padding:'6px 8px', border:'1px solid #d9d9d9', borderRadius:4, fontSize:13, background:'#fff' }}>
                <option value="">请选择</option>
                <option value="free_shipping">包邮</option>
                <option value="per_plant">不包邮，按颗计费</option>
                <option value="per_kg">不包邮，按KG计费</option>
              </select>
            ) : (
            <input type={type} value={isComputed ? computedCostPrice() || '' : (form[k] ?? '')}
              onChange={e => { if (readonly || isComputed) return; set(k, type==='number' ? (e.target.value===''?'':Number(e.target.value)) : e.target.value); }}
              readOnly={readonly || isComputed}
              style={{ width:'100%', padding:'6px 8px', border: isComputed ? '1px dashed #d9d9d9' : '1px solid #d9d9d9', borderRadius:4, fontSize:13, background: isComputed ? '#fafafa' : '#fff', color: isComputed ? '#8c8c8c' : '#333' }} />
            )}
          </div>
        );})}
      </div>

      <div style={{ marginTop:16, display:'flex', gap:8 }}>
        <button onClick={save} style={{ padding:'7px 24px', background:'#1a1a2e', color:'#fff', border:'none', borderRadius:4, fontSize:13, cursor:'pointer' }}>💾 保存</button>
        <button onClick={() => nav('/')} style={{ padding:'7px 24px', background:'#fff', border:'1px solid #d9d9d9', borderRadius:4, fontSize:13, cursor:'pointer' }}>取消</button>
      </div>
    </div>
  );
}
