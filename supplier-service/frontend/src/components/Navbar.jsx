import { useNavigate, useLocation } from 'react-router-dom'
export default function Navbar() {
  const n = useNavigate()
  const loc = useLocation()
  const tab = loc.pathname.startsWith('/internet') ? 'internet' : 'supplier'
  const tabStyle = (active) => ({
    padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
    fontWeight: 600, color: active ? '#fff' : '#ffffff88',
    background: active ? '#3E7B5B' : 'transparent', border: 'none', transition: 'all .15s'
  })
  const linkStyle = { opacity: .6, fontSize: 13, color: '#8cf', textDecoration: 'none', marginLeft: 8, cursor: 'pointer' }
  return (
    <nav style={{background:'#1a1a2e',padding:'0 20px',display:'flex',alignItems:'center',height:48,color:'#fff',justifyContent:'space-between'}}>
      <div style={{display:'flex',gap:12,alignItems:'center'}}>
        <span style={{fontWeight:'bold',fontSize:15}}>店铺注册管理</span>
        <button style={tabStyle(tab==='supplier')} onClick={()=>n('/')}>📋 供应商管理</button>
        <button style={tabStyle(tab==='internet')} onClick={()=>n('/internet-suppliers')}>🌐 花卉互联网供应商</button>
        <a href="http://100.96.54.109:31001" style={linkStyle}>商品管理</a>
        <a href="http://100.96.54.109:31004" style={linkStyle}>经销商系统</a>
        <a href="http://106.12.91.182/map" style={linkStyle}>地图</a>
      </div>
      <div>
        <button onClick={()=>{localStorage.removeItem('token');n('/')}}
          style={{background:'none',border:'1px solid #ffffff33',color:'#fff',padding:'3px 12px',borderRadius:4,cursor:'pointer',fontSize:12}}>退出</button>
      </div>
    </nav>
  )
}
