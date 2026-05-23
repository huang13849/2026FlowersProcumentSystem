import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
export default function Login() {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState('');
  const { login } = useAuth(); const nav = useNavigate();
  const handle = async e => { e.preventDefault(); setErr('');
    try { await login(u, p); nav('/'); } catch (e) { setErr('用户名或密码错误'); }
  };
  return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', minHeight:'100vh', background:'linear-gradient(135deg,#1a1a2e,#16213e)' }}>
      <form onSubmit={handle} style={{ background:'#fff', padding:40, borderRadius:12, boxShadow:'0 8px 32px #00000033', width:380 }}>
        <h2 style={{ textAlign:'center', marginBottom:24, color:'#1a1a2e' }}>花卉采购系统</h2>
        {err && <p style={{ color:'#ff4d4f', textAlign:'center', marginBottom:12 }}>{err}</p>}
        <input value={u} onChange={e => setU(e.target.value)} placeholder="用户名" required
          style={{ width:'100%', padding:10, marginBottom:12, border:'1px solid #d9d9d9', borderRadius:6, fontSize:14 }} />
        <input value={p} onChange={e => setP(e.target.value)} type="password" placeholder="密码" required
          style={{ width:'100%', padding:10, marginBottom:20, border:'1px solid #d9d9d9', borderRadius:6, fontSize:14 }} />
        <button type="submit" style={{ width:'100%', padding:10, background:'#1a1a2e', color:'#fff', border:'none', borderRadius:6, fontSize:16, cursor:'pointer' }}>登录</button>
      </form>
    </div>
  );
}
