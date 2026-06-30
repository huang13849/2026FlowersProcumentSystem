import { useNavigate } from 'react-router-dom';
export default function Navbar() {
  const nav = useNavigate();
  const linkStyle = { opacity: .5, fontSize: 13, color: '#8cf', textDecoration: 'none', marginLeft: 8, cursor: 'pointer' }
  return (
    <nav style={{ background:'#1a1a2e', padding:'0 20px', display:'flex', alignItems:'center', height:48, color:'#fff', justifyContent:'space-between' }}>
      <div style={{ display:'flex', gap:16, alignItems:'center' }}>
        <span style={{ fontWeight:'bold', fontSize:15 }}>🌺 花卉采购系统</span>
        <span style={{ opacity:.5, fontSize:13 }}>商品管理表格</span>
        <a href="http://100.96.54.109:3002" style={linkStyle}>供应商管理</a>
        <a href="http://100.96.54.109:3004" style={linkStyle}>经销商系统</a>
        <a href="http://106.12.91.182/map" style={linkStyle}>地图</a>
      </div>
      <div style={{ display:'flex', gap:12, alignItems:'center' }}>
        <span style={{ fontSize:13, opacity:.7 }}>管理员</span>
      </div>
    </nav>
  );
}
