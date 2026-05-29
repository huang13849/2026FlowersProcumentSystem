import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

// ─── Column definition ──────────────────────────────────────────────
const IMG_COLS = [
  { key: 'panorama', label: '全景主图',   color: '#1890ff' },
  { key: 'package',  label: '发货包装图', color: '#52c41a' },
  { key: 'detail',   label: '细节特写',   color: '#fa8c16' },
  { key: 'root_soil',label: '根系盆土',   color: '#722ed1' },
  { key: 'size_ref', label: '尺寸参考',   color: '#eb2f96' },
];

const DETAIL_IMG_COLS = [
  { key: 'scene',         label: '场景应用',   color: '#2f54eb' },
  { key: 'selling_point', label: '核心卖点',   color: '#f5222d' },
  { key: 'care',          label: '基础养护',   color: '#13c2c2' },
  { key: 'comparison',    label: '规格对比',   color: '#fa541c' },
  { key: 'shipping',      label: '发货说明',   color: '#a0d911' },
  { key: 'after_sale',    label: '售后保障',   color: '#d4380d' },
];

const COLUMNS = [
  // 0-4: 商品主图 5列
  { field: 'panorama',    label: '主图', width: 56, type: 'gridImg', editable: false },
  { field: 'package_img', label: '发货包装', width: 56, type: 'gridImg', editable: false },
  { field: 'detail_img',  label: '细节特写', width: 56, type: 'gridImg', editable: false },
  { field: 'root_soil_img', label: '根系盆土', width: 56, type: 'gridImg', editable: false },
  { field: 'size_img',    label: '尺寸参考', width: 56, type: 'gridImg', editable: false },
  // 5: 商品标题
  { field: 'title',        label: '商品标题', width: 150, type: 'string', editable: true },
  // 6: 分类
  { field: 'category',     label: '分类',     width: 75,  type: 'string', editable: true },
  // 7: 商家
  { field: 'sellerName',   label: '商家',     width: 110, type: 'string', editable: true },
  // 8: 花卉
  { field: 'flowerName',   label: '花卉',     width: 90,  type: 'string', editable: true },
  // 9: 规格尺寸 - 直接编辑
  { field: 'specSize',     label: '规格', width: 70, type: 'string', editable: true },
  // 10: 备注 - 直接编辑
  { field: 'potColorNotes', label: '备注', width: 90, type: 'string', editable: true },
  // 11: 发货地
  { field: 'origin',       label: '发货地',   width: 65,  type: 'string', editable: true },
  // 12: 库存
  { field: 'stock',        label: '库存',     width: 55,  type: 'number', editable: true },
  // 13: 重量
  { field: 'weight',       label: '重量',     width: 50,  type: 'number', editable: true },
  // 14: 成本价
  { field: 'costPrice',    label: '成本价',   width: 70,  type: 'money',  editable: true },
  // 15: 销售价
  { field: 'sellPrice',    label: '销售价',   width: 70,  type: 'money',  editable: true },
  // 16: 甲方税率
  { field: 'taxRateA',      label: '甲方税率', width: 65,  type: 'percent', editable: true },
  // 17: 乙方税率
  { field: 'taxRateB',      label: '乙方税率', width: 65,  type: 'percent', editable: true },
  // 18: 利润
  { field: '_profit',      label: '利润',     width: 60,  type: 'profit', editable: false },
  // 18: 利润率
  { field: '_profitRate',  label: '利率',     width: 50,  type: 'profitRate',editable: false },
  // 19-24: 商品详情图 6列
  { field: 'scene_img',    label: '场景应用', width: 56, type: 'gridImg', editable: false },
  { field: 'selling_img',  label: '品种卖点', width: 56, type: 'gridImg', editable: false },
  { field: 'care_img',     label: '养护教程', width: 56, type: 'gridImg', editable: false },
  { field: 'compare_img',  label: '规格对比', width: 56, type: 'gridImg', editable: false },
  { field: 'shipping_img', label: '发货与售后', width: 56, type: 'gridImg', editable: false },
  { field: 'after_img',    label: '售后', width: 56, type: 'gridImg', editable: false },
  // 25: 上架状态
  { field: 'isListed',     label: '状态', width: 60, type: 'enum', editable: true,
    options: [{v:true,l:'已上架'},{v:false,l:'未上架'}] },
  // 26: 操作
  { field: '_actions',     label: '操作', width: 70, type: 'actions', editable: false },
  // 27: 电商平台参考链接
  { field: 'ecommerceReferenceUrl', label: '电商平台参考', width: 90, type: 'string', editable: true },
];

// ─── Component ──────────────────────────────────────────────────────
export default function ProductList() {
  const [allProducts, setAllProducts] = useState([]);  // no pagination
  const [displayed, setDisplayed] = useState([]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});
  const [categories, setCategories] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [hoverImage, setHoverImage] = useState(null);   // {url, x, y}
  const [stockRange, setStockRange] = useState({ min: '', max: '' });
  const [priceRange, setPriceRange] = useState({ min: "", max: "" });
  const [exporting, setExporting] = useState(false);
  const [newRowId, setNewRowId] = useState(null);
  const tableRef = useRef(null);
  const [pasteTarget, setPasteTarget] = useState(null); // { product, colField }
  // 商家名称筛选
  const [sellerFilter, setSellerFilter] = useState('');
  const [sellerSuggestions, setSellerSuggestions] = useState([]);
  const [showSellerSug, setShowSellerSug] = useState(false);
  const [allSellers, setAllSellers] = useState([]);
  const sellerInputRef = useRef(null);
  const sellerSugRef = useRef(null);
  const inputRef = useRef();
  const nav = useNavigate();

  // ── Load all products (no pagination) ──
  const load = useCallback(async () => {
    const r = await api.get('/products', { params: { limit: 9999, sort: '-updatedAt' } });
    setAllProducts(r.data.products);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load filter options
  useEffect(() => {
    api.get('/products/meta/categories').then(r => setCategories(r.data));
    api.get('/products/meta/sellers').then(r => setAllSellers(r.data));
  }, []);

  // ── Client-side filtering + search ──
  useEffect(() => {
    let list = [...allProducts];

    // Search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        (p.title || '').toLowerCase().includes(q) ||
        (p.flowerName || '').toLowerCase().includes(q) ||
        (p.productId || '').toLowerCase().includes(q)
      );
    }

    // Category
    if (filters.category) list = list.filter(p => p.category === filters.category);

    // Listed
    if (filters.isListed !== undefined && filters.isListed !== '') {
      const v = filters.isListed === 'true';
      list = list.filter(p => p.isListed === v);
    }
    // Seller name
    if (sellerFilter.trim()) {
      const q = sellerFilter.trim().toLowerCase();
      list = list.filter(p => (p.sellerName || '').toLowerCase().includes(q));
    }
    // Price range
    if (priceRange.min !== '') list = list.filter(p => (p.sellPrice || 0) >= Number(priceRange.min));
    if (priceRange.max !== '') list = list.filter(p => (p.sellPrice || 0) <= Number(priceRange.max));
    // Stock range
    if (stockRange.min !== '') list = list.filter(p => (p.stock || 0) >= Number(stockRange.min));
    if (stockRange.max !== '') list = list.filter(p => (p.stock || 0) <= Number(stockRange.max));

    // Sort: new rows first, then by updatedAt (latest first)
    list.sort((a, b) => {
      if (a._id && a._id.startsWith('_new_')) return -1;
      if (b._id && b._id.startsWith('_new_')) return 1;
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });

    setDisplayed(list);
  }, [allProducts, search, filters, sellerFilter, priceRange, stockRange]);

  // ── Inline editing ──
  const startEdit = (row, col, value) => {
    if (!COLUMNS[col].editable) return;
    setEditingCell({ row, col });
    setEditValue(value ?? '');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    const { row, col } = editingCell;
    const product = displayed[row];
    if (!product) { setEditingCell(null); return; }
    const colDef = COLUMNS[col];
    const field = colDef.field;
    let value = editValue;

    if (colDef.type === 'number' || colDef.type === 'money') value = value === '' ? null : Number(value);
    if (field === 'isListed') value = editValue === 'true' || editValue === true;

    const isNewRow = product._id && product._id.startsWith('_new_');

    // Optimistic update
    const updateProduct = (p) => p._id === product._id ? { ...p, [field]: value } : p;
    setAllProducts(prev => prev.map(updateProduct));

    try {
      if (isNewRow) {
        // 需要标题才能保存
        const titleVal = colDef.field === 'title' ? value : (product.title || '');
        if (!titleVal) { setEditingCell(null); return; }
        // 用函数式读取最新 allProducts
        setAllProducts(prev => {
          const cur = prev.find(p => p._id === product._id);
          if (!cur) return prev.map(p => p._id === product._id ? { ...p, [field]: value } : p);
          const payload = { ...cur, [field]: value };
          delete payload._id;
          delete payload._v;
          delete payload.updatedAt;
          delete payload.createdAt;
          api.post('/products', payload).then(res => {
            const realId = res.data._id;
            setAllProducts(p2 => p2.map(p2 => p2._id === product._id ? { ...p2, _id: realId } : p2));
            setNewRowId(null);
          }).catch(e => {
            alert('保存失败: ' + (e.response?.data?.error || e.message));
          });
          return prev.map(p => p._id === product._id ? { ...p, [field]: value } : p);
        });
      } else {
        await api.put('/products/' + product._id, { [field]: value });
      }
    } catch {
      setAllProducts(prev => prev.map(p => p._id === product._id ? product : p));
    }
    setEditingCell(null);
  };

  const handleKeyDown = e => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') setEditingCell(null);
    if (e.key === 'Tab') { e.preventDefault(); saveEdit(); }
  };

  // ── Helpers ──
  const profit = p => {
    const s = Number(p.sellPrice || 0);
    const c = Number(p.costPrice || 0);
    const ta = Number(p.taxRateA || 0);
    const tb = Number(p.taxRateB || 0);
    // 甲方税 = 销售价/(1+甲方税率) * 甲方税率
    const taxA = ta > 0 ? (s / (1 + ta/100) * ta/100) : 0;
    // 乙方税 = 成本价/(1+乙方税率) * 乙方税率
    const taxB = tb > 0 ? (c / (1 + tb/100) * tb/100) : 0;
    return s - c - (taxA - taxB);
  };
  const profitRate = p => {
    const s = Number(p.sellPrice || 0);
    const c = Number(p.costPrice || 0);
    const ta = Number(p.taxRateA || 0);
    const tb = Number(p.taxRateB || 0);
    const pft = profit(p);
    // 利润率 = (售价 - 成本 - (甲方税 - 乙方税)) / 销售价
    return s > 0 ? (pft / s) * 100 : 0;
  };

  // ── Image compression ──
  const compressImage = async (file) => {
    if (!file.type.startsWith('image/')) return file;
    const limit = 4 * 1024 * 1024;
    if (file.size <= limit) return file;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > 1920) { height = height * 1920 / width; width = 1920; }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
        const tryCompress = (q) => {
          canvas.toBlob((blob) => {
            if (blob.size <= limit || q <= 0.15) resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
            else tryCompress(q - 0.1);
          }, 'image/jpeg', q);
        };
        tryCompress(0.8);
      };
      img.src = URL.createObjectURL(file);
    });
  };

  // ── Image column helpers ──
  const imgFieldKey = (colField) => {
    const map = {
      panorama: 'panorama_images', package_img: 'package_images', detail_img: 'detail_images',
      root_soil_img: 'root_soil_images', size_img: 'size_ref_images',
      scene_img: 'scene_images', selling_img: 'selling_point_images', care_img: 'care_images',
      compare_img: 'comparison_images', shipping_img: 'shipping_images', after_img: 'after_sale_images',
    };
    return map[colField] || 'images';
  };

  const uploadGridImage = async (e, product, colField) => {
    const files = e.target.files;
    if (!files?.length) return;
    const fd = new FormData();
    for (let i = 0; i < files.length; i++) fd.append('files', files[i]);
    try {
      const r = await api.post('/images/upload-multiple', fd);
      const urls = r.data.urls || [];
      if (urls.length) {
        const key = imgFieldKey(colField);
        const newUrls = [...(product[key] || []), ...urls];
        setAllProducts(prev => prev.map(p =>
          p._id === product._id
            ? { ...p, [key]: newUrls, images: [...(p.images || []), ...urls] }
            : p
        ));
        // 持久化到数据库
        try { await api.put('/products/' + product._id, { [key]: newUrls }); } catch (e) { console.warn('保存图片到数据库失败', e); }
      }
    } catch (err) {
      alert('上传失败: ' + (err.response?.data?.error || err.message));
    }
    e.target.value = '';
  };

  const removeGridImage = async (productId, colField, url) => {
    const key = imgFieldKey(colField);
    try {
      // 先从 MinIO 删除图片本身
      try { await api.delete('/images/by-url', { data: { imageUrl: url } }); } catch (e) { console.warn('MinIO删除失败', e); }
      // 再从产品中移除引用
      setAllProducts(prev => {
        const updated = prev.map(p => {
          if (p._id !== productId) return p;
          const filtered = (p[key] || []).filter(i => i !== url);
          return { ...p, [key]: filtered, images: (p.images || []).filter(i => i !== url) };
        });
        const updatedProduct = updated.find(p => p._id === productId);
        const newArr = updatedProduct?.[key] || [];
        api.put('/products/' + productId, { [key]: newArr }).catch(() => {});
        return updated;
      });
    } catch { alert('删除失败'); }
  };

  const triggerGridUpload = (product, colField) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*';
    inp.onchange = async (ev) => {
      if (ev.target.files?.length) {
        const compressed = await Promise.all(Array.from(ev.target.files).map(compressImage));
        const fd = new FormData();
        compressed.forEach(f => fd.append('files', f));
        try {
          const r = await api.post('/images/upload-multiple', fd);
          const urls = r.data.urls || [];
          if (urls.length) {
            const key = imgFieldKey(colField);
            const newUrls = [...(product[key] || []), ...urls];
            setAllProducts(prev => prev.map(p =>
              p._id === product._id
                ? { ...p, [key]: newUrls, images: [...(p.images || []), ...urls] }
                : p
            ));
            // 持久化到数据库
            try { await api.put('/products/' + product._id, { [key]: newUrls }); } catch (e) { console.warn('保存图片到数据库失败', e); }
          }
        } catch (err) { alert('上传失败'); }
      }
    };
    inp.click();
  };

  // ── Paste image support ──
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const handlePaste = async (e) => {
      if (!pasteTarget) return;
      const { productId, colField } = pasteTarget;
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles = [];
      for (const item of items) {
        const file = item.getAsFile();
        if (file && file.type.startsWith('image/')) imageFiles.push(file);
      }
      if (!imageFiles.length) return;
      e.preventDefault();

      const compressed = await Promise.all(imageFiles.map(compressImage));
      const fd = new FormData();
      compressed.forEach(f => fd.append('files', f));
      try {
        const r = await api.post('/images/upload-multiple', fd);
        const urls = r.data.urls || [];
        if (urls.length) {
          const key = imgFieldKey(colField);
          const latestProductId = productId;
          setAllProducts(prev => {
            const cur = prev.find(p => p._id === latestProductId);
            const currentUrls = cur?.[key] || [];
            const merged = [...currentUrls, ...urls];
            // 持久化到数据库（在callback里确保读到最新数据）
            api.put('/products/' + latestProductId, { [key]: merged }).catch(e => console.warn('粘贴图片保存到数据库失败', e));
            return prev.map(p =>
              p._id === latestProductId
                ? { ...p, [key]: merged, images: [...(p.images || []), ...urls] }
                : p
            );
          });
        }
      } catch (err) {
        alert('粘贴上传失败: ' + (err.response?.data?.error || err.message));
      }
    };
    el.addEventListener('paste', handlePaste);
    return () => el.removeEventListener('paste', handlePaste);
  }, [pasteTarget]);

  // ── Selection ──
  const toggle = id => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };
  const selectAll = () => {
    if (selected.size === displayed.length) setSelected(new Set());
    else setSelected(new Set(displayed.map(p => p._id)));
  };

  // ── Batch ──
  const batchDelete = async () => {
    if (!selected.size || !confirm('确认删除 ' + selected.size + ' 条商品？')) return;
    await api.post('/products/batch', { ids: [...selected], action: 'delete' });
    setSelected(new Set()); load();
  };
  const batchStatus = async (listed) => {
    if (!selected.size) return;
    await api.post('/products/batch', { ids: [...selected], action: 'list', data: { isListed: listed } });
    setSelected(new Set()); load();
  };

  // ── Copy selected product (deep copy including MinIO images) ──
  const handleCopySelected = async () => {
    if (selected.size !== 1) return;
    const prodId = [...selected][0];
    if (!prodId || prodId.startsWith('_new_')) return alert('请先保存该商品再复制');
    try {
      const r = await api.post('/products/' + prodId + '/copy');
      const newProduct = r.data;
      setAllProducts(prev => [newProduct, ...prev]);
      setSelected(new Set());
    } catch (err) {
      alert('复制失败: ' + (err.response?.data?.error || err.message));
    }
  };

  // ── Export to Excel with images ──
  const exportExcel = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filters.category) params.set('category', filters.category);
      if (filters.isListed !== undefined && filters.isListed !== '') params.set('isListed', filters.isListed);
      if (priceRange.min) params.set('priceMin', priceRange.min);
      if (priceRange.max) params.set('priceMax', priceRange.max);
      if (stockRange.min) params.set('stockMin', stockRange.min);
      if (stockRange.max) params.set('stockMax', stockRange.max);
      if (sellerFilter.trim()) params.set('sellerName', sellerFilter.trim());
      params.set('limit', '30');
      // Also support exporting only selected items
      if (selected.size > 0) {
        const validIds = [...selected].filter(id => !id.startsWith("_new_"));
        if (validIds.length > 0) params.set("ids", validIds.join(","));
      }
      const token = localStorage.getItem('token');
      const resp = await fetch('/api/export/excel?' + params.toString(), {
        headers: { Authorization: 'Bearer ' + (token || '') },
      });
      if (!resp.ok) throw new Error('导出失败: ' + resp.statusText);
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '商品列表_' + new Date().toLocaleDateString('zh-CN').replace(/\//g, '') + '.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('导出失败: ' + (err.message || '未知错误'));
    }
    setExporting(false);
  };

  // ── Click outside handler for seller suggestion ──
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (sellerSugRef.current && !sellerSugRef.current.contains(e.target) &&
          sellerInputRef.current && !sellerInputRef.current.contains(e.target)) {
        setShowSellerSug(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Render ──
  return (
    <div style={{ padding:'8px 12px', background:'#f5f5f5', minHeight:'calc(100vh - 48px)' }}>
      {/* ════ Toolbar ════ */}
      <div style={{ display:'flex', gap:8, marginBottom:8, alignItems:'center', flexWrap:'wrap' }}>
        {/* 商家名称筛选 */}
        <div style={{position:'relative'}}>
          <input ref={sellerInputRef} value={sellerFilter}
            onChange={e => {
              const v = e.target.value;
              setSellerFilter(v);
              if (v.trim()) {
                setSellerSuggestions(allSellers.filter(n => n && n.toLowerCase().includes(v.toLowerCase())));
                setShowSellerSug(true);
              } else {
                setSellerSuggestions([]);
                setShowSellerSug(false);
              }
            }}
            onFocus={() => { if (sellerFilter.trim() && sellerSuggestions.length) setShowSellerSug(true); }}
            placeholder="🏷️ 筛选商家"
            style={{padding:'6px 10px',border:'1px solid #d9d9d9',borderRadius:4,width:160,fontSize:13}} />
          {sellerFilter && (
            <button onClick={() => {setSellerFilter('');setSellerSuggestions([]);setShowSellerSug(false);}}
              style={{position:'absolute',right:6,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',fontSize:14,color:'#999',padding:0,lineHeight:1}}
              title="清除筛选">✕</button>
          )}
          {showSellerSug && sellerSuggestions.length > 0 && (
            <div ref={sellerSugRef} style={{
              position:'absolute',top:'100%',left:0,zIndex:1000,
              background:'#fff',border:'1px solid #d9d9d9',borderRadius:4,
              maxHeight:200,overflowY:'auto',width:220,
              boxShadow:'0 4px 12px rgba(0,0,0,0.15)',
            }}>
              {sellerSuggestions.map((name, i) => (
                <div key={i} onClick={() => {setSellerFilter(name);setSellerSuggestions([]);setShowSellerSug(false);}}
                  onMouseDown={e => e.preventDefault()}
                  style={{padding:'6px 10px',fontSize:12,cursor:'pointer',borderBottom:'1px solid #f0f0f0',background:'#fff',}}
                  onMouseEnter={e => e.currentTarget.style.background='#e6f7ff'}
                  onMouseLeave={e => e.currentTarget.style.background='#fff'}>
                  {name}
                </div>
              ))}
            </div>
          )}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 搜索标题 / 花卉 / SKU…"
          style={{ padding:'6px 10px', border:'1px solid #d9d9d9', borderRadius:4, width:200, fontSize:13 }} />
        <select onChange={e => setFilters(f => ({...f, category: e.target.value}))} style={selStyle}>
          <option value="">全部分类</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <select onChange={e => setFilters(f => ({...f, isListed: e.target.value}))} style={selStyle}>
          <option value="">全部状态</option>
          <option value="true">🟢 已上架</option>
          <option value="false">🔴 未上架</option>
        </select>

        {/* Price range */}
        <span style={{ fontSize:11, color:'#999' }}>售价</span>
        <input type="number" placeholder="最低" value={priceRange.min}
          onChange={e => setPriceRange(r => ({...r, min: e.target.value}))}
          style={{ ...inpStyle, width:60 }} />
        <span style={{ color:'#ccc' }}>~</span>
        <input type="number" placeholder="最高" value={priceRange.max}
          onChange={e => setPriceRange(r => ({...r, max: e.target.value}))}
          style={{ ...inpStyle, width:60 }} />

        {/* Stock range */}
        <span style={{ fontSize:11, color:'#999' }}>库存</span>
        <input type="number" placeholder="最低" value={stockRange.min}
          onChange={e => setStockRange(r => ({...r, min: e.target.value}))}
          style={{ ...inpStyle, width:55 }} />
        <span style={{ color:'#ccc' }}>~</span>
        <input type="number" placeholder="最高" value={stockRange.max}
          onChange={e => setStockRange(r => ({...r, max: e.target.value}))}
          style={{ ...inpStyle, width:55 }} />

        <span style={{ fontSize:12, color:'#888' }}>共 {displayed.length} 条</span>
        <div style={{ flex:1 }} />
        <button onClick={exportExcel} disabled={exporting}
          style={{
            padding:'5px 12px',
            background: exporting ? '#d9d9d9' : '#52c41a',
            color: exporting ? '#999' : '#fff',
            border:'none', borderRadius:4,
            cursor: exporting ? 'not-allowed' : 'pointer',
            fontSize:12, whiteSpace:'nowrap',
            display:'flex', alignItems:'center', gap:4,
          }}>
          {exporting ? '⏳ 导出中…' : '📊 导出Excel'}
        </button>
        <button onClick={() => {
          if (selected.size === 1) {
            // 复制
            handleCopySelected();
          } else {
            // 新建
            const id = '_new_' + Date.now();
            setAllProducts(p => [{ _id: id, title: '(新商品)', sellerName: '', category: '', flowerName: '', origin: '', stock: 0, weight: 0, costPrice: 0, sellPrice: 0, taxRateA: 0, taxRateB: 0, isListed: false, ecommerceReferenceUrl: '' }, ...p]);
            setNewRowId(id);
          }
        }}
          style={{
            padding:'5px 12px',
            background: selected.size === 1 ? '#1a1a2e' : '#1a1a2e',
            color: '#fff',
            border:'none', borderRadius:4,
            cursor:'pointer',
            fontSize:12, whiteSpace:'nowrap',
            display:'flex', alignItems:'center', gap:4,
          }}>
          {selected.size === 1 ? '📋 复制' : '➕ 新增'}
        </button>
        {selected.size > 0 && <>
          <button onClick={() => batchStatus(true)} style={btnStyle('#52c41a','#fff')}>✅ 上架</button>
          <button onClick={() => batchStatus(false)} style={btnStyle('#faad14','#fff')}>⏸ 下架</button>
          <button onClick={batchDelete} style={btnStyle('#ff4d4f','#fff')}>🗑 删除</button>
          <span style={{ fontSize:12, color:'#888' }}>已选 {selected.size} 项</span>
        </>}
      </div>

      {/* ════ Virtual-scroll Table (all rows, no pagination) ════ */}
      <div ref={tableRef} style={{
        overflow:'auto', background:'#fff', borderRadius:8, boxShadow:'0 1px 4px #0000000d',
        maxHeight:'calc(100vh - 160px)', position:'relative',
      }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, tableLayout:'fixed' }}>
          <thead>
            <tr style={{ background:'#f7f7f7', position:'sticky', top:0, zIndex:3, boxShadow:'0 1px 2px #0000000d' }}>
              <th style={{ ...thS, width:32, minWidth:32 }}><input type="checkbox" onChange={selectAll}
                checked={selected.size === displayed.length && displayed.length > 0} /></th>
              {COLUMNS.map((col, ci) => (
                <th key={ci} style={{ ...thS, width:col.width, minWidth:col.width,
                  textAlign: ['number','money','profit','profitRate','percent'].includes(col.type) ? 'right' : 'left'
                }}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map((p, ri) => {
              const isEven = ri % 2 === 0;

              return (
                <tr key={p._id} style={{
                  borderBottom:'1px solid #f0f0f0',
                  background: isEven ? '#fff' : '#fafcff',
                  height: 64,
                  transition:'background 0.15s',
                }}
                  onMouseEnter={e => e.currentTarget.style.background='#f0f7ff'}
                  onMouseLeave={e => e.currentTarget.style.background= isEven ? '#fff' : '#fafcff'}
                >
                  {/* Checkbox */}
                  <td style={{ ...tdS, width:32, textAlign:'center' }}>
                    <input type="checkbox" checked={selected.has(p._id)} onChange={() => toggle(p._id)} />
                  </td>

                  {COLUMNS.map((col, ci) => {
                    const cellKey = ri + '-' + ci;
                    const isEditing = editingCell?.row === ri && editingCell?.col === ci;
                    const val = p[col.field];

                    // ── Grid Image column (all 11 types, 50px cell) ──
                    if (col.type === 'gridImg') {
                      const key = imgFieldKey(col.field);
                      let imgs = p[key] || [];
                      // Fallback: if dedicated field empty and column is panorama, use images[0]
                      if (!imgs.length && col.field === 'panorama' && p.images?.length) {
                        imgs = [p.images[0]];
                      }
                      // For other empty columns, distribute remaining images
                      if (!imgs.length && col.field !== 'panorama' && p.images?.length) {
                        const imgFallbackIdx = ['panorama','package_img','detail_img','root_soil_img','size_img',
                          'scene_img','selling_img','care_img','compare_img','shipping_img','after_img'].indexOf(col.field);
                        if (imgFallbackIdx > 0 && imgFallbackIdx < p.images.length) {
                          imgs = [p.images[imgFallbackIdx]];
                        }
                      }
                      const firstUrl = imgs[0];
                      const isMain = col.field.indexOf('img') < 0;
                      const colLabel = IMG_COLS.concat(DETAIL_IMG_COLS).find(c => c.key === col.field.replace('_img',''))?.label || '';
                      return (
                        <td key={ci} style={{ ...tdS, width:col.width, padding:1, textAlign:'center', verticalAlign:'middle' }}>
                          <div style={{ position:'relative', width:50, height:50, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto' }}>
                            {firstUrl ? (
                              <div style={{ position:'relative', width:44, height:44 }}
                                title={colLabel + ' (' + imgs.length + '张)'}>
                                <img src={firstUrl} alt=""
                                  style={{ width:44, height:44, borderRadius:4, objectFit:'cover', border:'1px solid #e0e0e0', cursor:'pointer', display:'block' }}
                                  onClick={() => { setPasteTarget({ productId: p._id, colField: col.field }); window.open(firstUrl, '_blank'); }}
                                  onMouseEnter={e => { const r = e.currentTarget.getBoundingClientRect(); setHoverImage({ url: firstUrl, x: r.right + 8, y: Math.max(r.top - 80, 0) }); }}
                                  onMouseLeave={() => setHoverImage(null)}
                                  onError={e => e.target.style.display='none'} />
                                <button onClick={() => removeGridImage(p._id, col.field, firstUrl)}
                                  style={{ position:'absolute', top:-3, right:-3, width:14, height:14, borderRadius:'50%', border:'none', background:'#e74c3c', color:'#fff', fontSize:9, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1, padding:0 }}>×</button>
                                {imgs.length > 1 && <span style={{ position:'absolute', bottom:-2, right:-2, fontSize:8, color:'#fff', background:'rgba(0,0,0,0.6)', borderRadius:6, padding:'0 3px', lineHeight:'12px' }}>{imgs.length}</span>}
                              </div>
                            ) : (
                              <div onClick={() => { setPasteTarget({ productId: p._id, colField: col.field }); triggerGridUpload(p, col.field); }}
                                style={{ width:44, height:44, border:'2px dashed #ccc', borderRadius:4, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#bbb', fontSize:9, lineHeight:1.2, transition:'all 0.15s' }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = '#999'; e.currentTarget.style.color = '#666' }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = '#ccc'; e.currentTarget.style.color = '#bbb' }}>
                                <span style={{ fontSize:14 }}>+</span>
                                <span>上传</span>
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    }

                    // ── Profit column (auto calc) ──
                    if (col.type === 'profit') {
                      const pft = profit(p);
                      return (
                        <td key={ci} style={{ ...tdS, textAlign:'right', fontWeight:600,
                          color: pft >= 0 ? '#52c41a' : '#ff4d4f', fontSize:13 }}>
                          ¥{pft.toFixed(1)}
                        </td>
                      );
                    }

                    // ── Profit rate column ──
                    if (col.type === 'profitRate') {
                      const rate = profitRate(p);
                      return (
                        <td key={ci} style={{ ...tdS, textAlign:'right', fontWeight:600,
                          color: rate >= 0 ? '#52c41a' : '#ff4d4f' }}>
                          {rate >= 0 ? '+' : ''}{rate.toFixed(0)}%
                        </td>
                      );
                    }



                    // ── Actions column ──
                    if (col.type === 'actions') {
                      return (
                        <td key={ci} style={{ ...tdS, textAlign:'center' }}>
                          <div style={{ display:'flex', gap:3, justifyContent:'center' }}>
                            <button onClick={() => nav('/products/' + p._id)}
                              style={actBtnStyle('#1890ff')} title="编辑">✏️</button>
                            <button onClick={() => {
                              if (confirm('确认删除「' + p.title + '」？')) {
                                api.delete('/products/' + p._id).then(() => load());
                              }
                            }} style={actBtnStyle('#ff4d4f')} title="删除">🗑</button>
                          </div>
                        </td>
                      );
                    }

                    // ── Status column ──
                    if (col.type === 'enum') {
                      if (isEditing) {
                        return (
                          <td key={ci} style={{ ...tdS, padding:0 }}>
                            <select value={String(val)} onChange={e => setEditValue(e.target.value)}
                              onBlur={saveEdit} autoFocus ref={inputRef}
                              style={{ width:'100%', height:'100%', border:'2px solid #1890ff', outline:'none', padding:'2px 4px', fontSize:12 }}>
                              {col.options.map(o => (
                                <option key={o.v} value={o.v}>{o.l}</option>
                              ))}
                            </select>
                          </td>
                        );
                      }
                      return (
                        <td key={ci} style={{ ...tdS, textAlign:'center', cursor:'pointer' }}
                          onClick={() => startEdit(ri, ci, val)}>
                          <span style={{
                            display:'inline-block', padding:'2px 8px', borderRadius:10,
                            fontSize:11, fontWeight:500,
                            background: val ? '#e6fffb' : '#fff2f0',
                            color: val ? '#13c2c2' : '#ff4d4f',
                            border: '1px solid ' + (val ? '#b7eb8f' : '#ffccc7'),
                          }}>{val ? '已上架' : '未上架'}</span>
                        </td>
                      );
                    }

                    // ── Editing cell (text / number / money / sellerName) ──
                    if (col.editable && isEditing) {
                      const isSeller = col.field === 'sellerName';
                      return (
                        <td key={ci} style={{ ...tdS, padding:0, position:'relative' }}>
                          {isSeller ? (
                            <div style={{ position:'relative', width:'100%', height:'100%' }}>
                              <input ref={inputRef}
                                type="text" value={editValue}
                                onChange={e => {
                                  setEditValue(e.target.value);
                                  if (e.target.value.trim()) {
                                    const q = e.target.value.trim().toLowerCase();
                                    const filtered = allSellers.filter(n => n && n.toLowerCase().includes(q));
                                    setSellerSuggestions(filtered);
                                    setShowSellerSug(filtered.length > 0);
                                  } else {
                                    setSellerSuggestions([]);
                                    setShowSellerSug(false);
                                  }
                                }}
                                onFocus={() => {
                                  if (allSellers.length > 0 && !editValue) {
                                    setSellerSuggestions(allSellers.slice(0, 10));
                                    setShowSellerSug(true);
                                  }
                                }}
                                onBlur={() => setTimeout(() => setShowSellerSug(false), 200)}
                                onKeyDown={handleKeyDown}
                                style={{ width:'100%', height:'100%', border:'2px solid #1890ff',
                                  outline:'none', padding:'2px 6px', fontSize:12,
                                  boxSizing:'border-box' }} />
                              {showSellerSug && sellerSuggestions.length > 0 && (
                                <div style={{
                                  position:'absolute', top:'100%', left:0, zIndex:1000,
                                  background:'#fff', border:'1px solid #d9d9d9', borderRadius:4,
                                  maxHeight:160, overflowY:'auto', width:200,
                                  boxShadow:'0 4px 12px rgba(0,0,0,0.15)'
                                }}>
                                  {sellerSuggestions.map((name, si) => (
                                    <div key={si}
                                      onMouseDown={(e) => { e.preventDefault(); setEditValue(name); setShowSellerSug(false); }}
                                      onClick={() => { setEditValue(name); setShowSellerSug(false); }}
                                      style={{ padding:'5px 8px', fontSize:12, cursor:'pointer', borderBottom:'1px solid #f0f0f0', background:'#fff' }}
                                      onMouseEnter={e => e.currentTarget.style.background='#e6f7ff'}
                                      onMouseLeave={e => e.currentTarget.style.background='#fff'}>
                                      {name}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <input ref={inputRef}
                              type={['number','money','percent'].includes(col.type) ? 'number' : 'text'}
                              step={['money','percent'].includes(col.type) ? '0.1' : '1'}
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={saveEdit} onKeyDown={handleKeyDown}
                              style={{ width:'100%', height:'100%', border:'2px solid #1890ff',
                                outline:'none', padding:'2px 6px', fontSize:12,
                                textAlign: ['number','money'].includes(col.type) ? 'right' : 'left' }} />
                          )}
                        </td>
                      );
                    }

                    // ── Display cell ──
                    const displayVal = val ?? '';
                    const isMonetary = col.type === 'money';
                    const isPercent = col.type === 'percent';

                    return (
                      <td key={ci} style={{
                        ...tdS,
                        cursor: col.editable ? 'pointer' : 'default',
                        background: isEditing ? '#e6f7ff' : 'transparent',
                        fontWeight: col.field === 'title' ? 600 : 'normal',
                        color: col.field === '_profit' ? (profit(p) >= 0 ? '#52c41a' : '#ff4d4f') : '#333',
                        textAlign: ['number','money','profit','profitRate','percent'].includes(col.type) ? 'right' : 'left',
                      }} onClick={() => col.editable && startEdit(ri, ci, val)}>
                        <div style={{
                          maxWidth: col.width - 12,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }} title={displayVal}>
                          {isMonetary && displayVal !== '' ? '¥' + Number(displayVal).toFixed(1) : isPercent ? displayVal + '%' : displayVal}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ════ Hover image preview ════ */}
      {hoverImage && (
        <div style={{
          position:'fixed', left:hoverImage.x, top:hoverImage.y, zIndex:9999,
          background:'#fff', borderRadius:8, boxShadow:'0 4px 20px rgba(0,0,0,0.2)',
          padding:4, maxWidth:320, maxHeight:320,
        }}
          onMouseEnter={() => setHoverImage(null)}
        >
          <img src={hoverImage.url} alt="" style={{ maxWidth:300, maxHeight:300, borderRadius:4, objectFit:'contain' }}
            onError={e => { e.target.style.display='none'; setHoverImage(null); }} />
        </div>
      )}

      {/* Info bar */}
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:8, fontSize:11, color:'#aaa' }}>
        <span>已加载全部 {displayed.length} 条商品（无分页）</span>
        <span>点击行展开详情 · 悬停图片查看大图 · 点击单元格编辑</span>
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────
const thS = {
  padding:'6px 8px', borderBottom:'2px solid #e8e8e8', fontWeight:600, fontSize:11,
  color:'#555', whiteSpace:'nowrap', position:'sticky', top:0, background:'#f7f7f7',
  userSelect:'none',
};
const tdS = {
  padding:'3px 5px', borderBottom:'1px solid #f0f0f0', fontSize:12,
  verticalAlign:'middle', overflow:'hidden',
};
const selStyle = {
  padding:'5px 8px', border:'1px solid #d9d9d9', borderRadius:4, fontSize:12,
};
const inpStyle = {
  padding:'5px 6px', border:'1px solid #d9d9d9', borderRadius:4, fontSize:12,
};
const btnStyle = (bg, color) => ({
  padding:'5px 12px', background:bg, color:color,
  border:'1px solid ' + (bg==='#fff'?'#d9d9d9':'transparent'), borderRadius:4,
  cursor:'pointer', fontSize:12, whiteSpace:'nowrap',
});
const actBtnStyle = (color) => ({
  padding:'2px 6px', border:'none', borderRadius:4, cursor:'pointer', fontSize:14,
  background:'transparent', lineHeight:1,
});
