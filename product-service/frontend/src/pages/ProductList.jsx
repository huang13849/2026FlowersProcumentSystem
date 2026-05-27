import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

// ─── Column definition ──────────────────────────────────────────────
const COLUMNS = [
  // 0: SKU → 商品主图
  { field: 'mainImage',    label: '主图',        width: 80,  type: 'image',     editable: false },
  // 1: 商品标题（固定宽）
  { field: 'title',        label: '商品标题',     width: 180, type: 'string',    editable: true },
  // 2: 分类
  { field: 'category',     label: '分类',         width: 85,  type: 'string',    editable: true },
  // 3: 商家
  { field: 'sellerName',   label: '商家',         width: 120, type: 'string',    editable: true },
  // 4: 花卉名称
  { field: 'flowerName',   label: '花卉',         width: 100, type: 'string',    editable: true },
  // 5: 规格+备注+履约（合并，可展开）
  { field: '_detail',      label: '规格/备注',    width: 140, type: 'expand',    editable: false },
  // 6: 发货地
  { field: 'origin',       label: '发货地',       width: 70,  type: 'string',    editable: true },
  // 7: 库存
  { field: 'stock',        label: '库存',         width: 60,  type: 'number',    editable: true },
  // 8: 重量
  { field: 'weight',       label: '重量',         width: 55,  type: 'number',    editable: true },
  // 9: 成本价
  { field: 'costPrice',    label: '成本价',       width: 75,  type: 'money',     editable: true },
  // 10: 市场参考价（新增）
  { field: 'retailMarkupPrice', label: '市场价',  width: 75,  type: 'money',     editable: true },
  // 11: 平台对比价
  { field: 'platformPriceDiff', label: '平台价',  width: 75,  type: 'string',    editable: true },
  // 12: 销售价
  { field: 'sellPrice',    label: '销售价',       width: 75,  type: 'money',     editable: true },
  // 13: 利润（自动计算）
  { field: '_profit',      label: '利润',         width: 80,  type: 'profit',    editable: false },
  // 14: 利润率%（自动计算）
  { field: '_profitRate',  label: '利润率',       width: 65,  type: 'profitRate',editable: false },
  // 15: 优惠券
  { field: 'couponInfo',   label: '优惠券',       width: 65,  type: 'string',    editable: true },
  // 16: 图片多张（新增合并区域）
  { field: 'images',       label: '多图',         width: 100, type: 'images',    editable: false },
  // 17: 上架状态
  { field: 'isListed',     label: '状态',         width: 65,  type: 'enum',      editable: true,
    options: [{v:true,l:'已上架'},{v:false,l:'未上架'}] },
  // 18: 操作
  { field: '_actions',     label: '操作',         width: 80,  type: 'actions',   editable: false },
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
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [priceRange, setPriceRange] = useState({ min: '', max: '' });
  const [stockRange, setStockRange] = useState({ min: '', max: '' });
  const [exporting, setExporting] = useState(false);
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

    // Sort: isListed first, then by updatedAt
    list.sort((a, b) => {
      if (a.isListed !== b.isListed) return a.isListed ? -1 : 1;
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

    // Optimistic
    const updateProduct = (p) => p._id === product._id ? { ...p, [field]: value } : p;
    setAllProducts(prev => prev.map(updateProduct));

    try {
      await api.put('/products/' + product._id, { [field]: value });
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
    return s - c;
  };
  const profitRate = p => {
    const c = Number(p.costPrice || 0);
    return c > 0 ? ((profit(p) / c) * 100) : 0;
  };

  // ── Image upload (PicGo) ──
  const uploadMainImage = async (e, product) => {
    const files = e.target.files;
    if (!files?.length) return;
    const fd = new FormData();
    fd.append('files', files[0]);
    fd.append('productId', product._id);
    fd.append('productName', product.title || '商品');
    try {
      const r = await api.post('/images/upload-multiple', fd);
      const urls = r.data.urls || [];
      if (urls.length) {
        setAllProducts(prev => prev.map(p =>
          p._id === product._id
            ? { ...p, images: [...(p.images || []), ...urls] }
            : p
        ));
      }
    } catch (err) {
      alert('上传失败: ' + (err.response?.data?.error || err.message));
    }
    e.target.value = '';
  };

  const removeImage = async (productId, url) => {
    try {
      await api.delete('/images/product/' + productId, { data: { imageUrl: url } });
      setAllProducts(prev => prev.map(p =>
        p._id === productId ? { ...p, images: (p.images || []).filter(i => i !== url) } : p
      ));
    } catch { alert('删除失败'); }
  };

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
      // Also support exporting only selected items
      if (selected.size > 0) {
        params.set('ids', [...selected].join(','));
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

  // ── Toggle expand detail ──
  const toggleExpand = (id) => {
    const s = new Set(expandedRows);
    s.has(id) ? s.delete(id) : s.add(id);
    setExpandedRows(s);
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
        <button onClick={() => nav('/products/new')} style={btnStyle('#1a1a2e','#fff')}>➕ 新增</button>
        {selected.size > 0 && <>
          <button onClick={() => batchStatus(true)} style={btnStyle('#52c41a','#fff')}>✅ 上架</button>
          <button onClick={() => batchStatus(false)} style={btnStyle('#faad14','#fff')}>⏸ 下架</button>
          <button onClick={batchDelete} style={btnStyle('#ff4d4f','#fff')}>🗑 删除</button>
          <span style={{ fontSize:12, color:'#888' }}>已选 {selected.size} 项</span>
        </>}
      </div>

      {/* ════ Virtual-scroll Table (all rows, no pagination) ════ */}
      <div style={{
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
                  textAlign: ['number','money','profit','profitRate'].includes(col.type) ? 'right' : 'left'
                }}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map((p, ri) => {
              const isExpanded = expandedRows.has(p._id);
              const isEven = ri % 2 === 0;

              return (
                <tr key={p._id} style={{
                  borderBottom:'1px solid #f0f0f0',
                  background: isEven ? '#fff' : '#fafcff',
                  height: isExpanded ? 'auto' : 64,
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

                    // ── Main Image column ──
                    if (col.type === 'image') {
                      const mainUrl = (p.images || [])[0];
                      return (
                        <td key={ci} style={{ ...tdS, width:col.width, textAlign:'center', padding:2 }}>
                          <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:60 }}>
                            {mainUrl ? (
                              <div style={{ position:'relative' }}
                                onMouseEnter={e => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setHoverImage({ url: mainUrl, x: rect.right + 8, y: Math.max(rect.top - 120, 0) });
                                }}
                                onMouseLeave={() => setHoverImage(null)}
                              >
                                <img src={mainUrl} alt=""
                                  style={{ width:56, height:56, borderRadius:6, objectFit:'cover', border:'2px solid #eee', cursor:'pointer' }}
                                  onClick={() => window.open(mainUrl, '_blank')}
                                  onError={e => e.target.style.display='none'} />
                              </div>
                            ) : (
                              <label style={{
                                width:56, height:56, border:'2px dashed #d9d9d9', borderRadius:6,
                                display:'flex', alignItems:'center', justifyContent:'center',
                                cursor:'pointer', color:'#bbb', fontSize:20,
                              }}>
                                +<input type="file" accept="image/*" onChange={e => uploadMainImage(e, p)}
                                  style={{ display:'none' }} />
                              </label>
                            )}
                          </div>
                        </td>
                      );
                    }

                    // ── Expand detail column ──
                    if (col.type === 'expand') {
                      return (
                        <td key={ci} style={{ ...tdS, width:col.width, padding:2, cursor:'pointer' }}
                          onClick={() => toggleExpand(p._id)}>
                          <div style={{ fontSize:11, lineHeight:1.4 }}>
                            <div style={{ fontWeight:500, color:'#555', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {p.specSize || '—'}
                            </div>
                            {isExpanded ? (
                              <div style={{ marginTop:4, padding:6, background:'#f8f8f8', borderRadius:4, fontSize:11, color:'#666' }}>
                                <div><b>备注:</b> {p.potColorNotes || '—'}</div>
                                <div><b>履约:</b> {p.deliveryMethod || '—'}</div>
                                <div><b>联系人:</b> {p.contactPerson || '—'}</div>
                              </div>
                            ) : (
                              <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'#999', fontSize:10 }}>
                                {p.potColorNotes || ''}
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

                    // ── Images column (multi) ──
                    if (col.type === 'images') {
                      const imgs = p.images || [];
                      const imgsToShow = isExpanded ? imgs : imgs.slice(0, 2);
                      return (
                        <td key={ci} style={{ ...tdS, width:col.width, padding:2 }}>
                          <div style={{ display:'flex', gap:2, alignItems:'center', flexWrap:'wrap', minHeight:50 }}>
                            {imgsToShow.map((url, ii) => (
                              <div key={ii} style={{ position:'relative', width:38, height:38 }}>
                                <img src={url} alt=""
                                  style={{ width:38, height:38, borderRadius:4, objectFit:'cover', border:'1px solid #eee', cursor:'pointer' }}
                                  onClick={() => window.open(url, '_blank')}
                                  onMouseEnter={e => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setHoverImage({ url, x: rect.right + 8, y: Math.max(rect.top - 80, 0) });
                                  }}
                                  onMouseLeave={() => setHoverImage(null)}
                                  onError={e => e.target.style.display='none'} />
                                <span onClick={() => removeImage(p._id, url)}
                                  style={{ position:'absolute', top:-2, right:-2, width:13, height:13, borderRadius:'50%',
                                    background:'#ff4d4f', color:'#fff', fontSize:8, lineHeight:'13px', textAlign:'center',
                                    cursor:'pointer', opacity:0.8 }}>
                                  ×
                                </span>
                              </div>
                            ))}
                            {!isExpanded && imgs.length > 2 && (
                              <span style={{ fontSize:10, color:'#888', cursor:'pointer' }}
                                onClick={() => toggleExpand(p._id)}>
                                +{imgs.length - 2}
                              </span>
                            )}
                            <label style={{
                              width:38, height:38, border:'2px dashed #d9d9d9', borderRadius:4,
                              display:'flex', alignItems:'center', justifyContent:'center',
                              cursor:'pointer', color:'#bbb', fontSize:14, flexShrink:0,
                            }}>
                              +<input type="file" multiple accept="image/*"
                                onChange={e => uploadMainImage(e, p)} style={{ display:'none' }} />
                            </label>
                          </div>
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

                    // ── Editing cell (text / number / money) ──
                    if (col.editable && isEditing) {
                      return (
                        <td key={ci} style={{ ...tdS, padding:0 }}>
                          <input ref={inputRef}
                            type={['number','money'].includes(col.type) ? 'number' : 'text'}
                            step={col.type === 'money' ? '0.01' : '1'}
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={saveEdit} onKeyDown={handleKeyDown}
                            style={{ width:'100%', height:'100%', border:'2px solid #1890ff',
                              outline:'none', padding:'2px 6px', fontSize:12,
                              textAlign: ['number','money'].includes(col.type) ? 'right' : 'left' }} />
                        </td>
                      );
                    }

                    // ── Display cell ──
                    const displayVal = val ?? '';
                    const isMonetary = col.type === 'money';

                    return (
                      <td key={ci} style={{
                        ...tdS,
                        cursor: col.editable ? 'pointer' : 'default',
                        background: isEditing ? '#e6f7ff' : 'transparent',
                        fontWeight: col.field === 'title' ? 600 : 'normal',
                        color: col.field === '_profit' ? (profit(p) >= 0 ? '#52c41a' : '#ff4d4f') : '#333',
                        textAlign: ['number','money','profit','profitRate'].includes(col.type) ? 'right' : 'left',
                      }} onClick={() => col.editable && startEdit(ri, ci, val)}>
                        <div style={{
                          maxWidth: col.width - 12,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }} title={displayVal}>
                          {isMonetary && displayVal !== '' ? '¥' + Number(displayVal).toFixed(1) : displayVal}
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
