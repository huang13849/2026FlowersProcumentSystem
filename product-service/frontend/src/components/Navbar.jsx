import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
export default function Navbar() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <nav style={{ background:'#1a1a2e', padding:'0 20px', display:'flex', alignItems:'center', height:48, color:'#fff', justifyContent:'space-between' }}>
      <div style={{ display:'flex', gap:16, alignItems:'center' }}>
        <span style={{ fontWeight:'bold', fontSize:15 }}>🌺 花卉采购系统</span>
        <a href="http://100.96.54.109:3002" target="_blank" style={{ opacity:.5, fontSize:13, color:"#8cf", textDecoration:"none", marginLeft:8 }}>供应商管理</a>
        <span style={{ opacity:.5, fontSize:13 }}>商品管理表格</span>
      </div>
      <div style={{ display:'flex', gap:12, alignItems:'center' }}>
        <span style={{ fontSize:13, opacity:.7 }}>{user?.displayName || user?.username} ({user?.role})</span>
        <button onClick={() => { logout(); nav('/login'); }} style={{ background:'none', border:'1px solid #ffffff33', color:'#fff', padding:'3px 12px', borderRadius:4, cursor:'pointer', fontSize:12 }}>退出</button>
      </div>
    </nav>
  );
}
