import { useNavigate } from 'react-router-dom'
export default function Navbar() {
  const n = useNavigate()
  return (
    <nav style={{background:'#1a1a2e',padding:'0 20px',display:'flex',alignItems:'center',height:48,color:'#fff',justifyContent:'space-between'}}>
      <div style={{display:'flex',gap:16,alignItems:'center'}}>
        <span style={{fontWeight:'bold',fontSize:15}}>供应商管理系统</span>
        <a href="http://100.96.54.109:3001" style={{opacity:.5,fontSize:13,color:'#8cf',textDecoration:'none',marginLeft:8}}>商品管理</a>
      </div>
      <div>
        <button onClick={()=>{localStorage.removeItem('token');n('/')}}
          style={{background:'none',border:'1px solid #ffffff33',color:'#fff',padding:'3px 12px',borderRadius:4,cursor:'pointer',fontSize:12}}>退出</button>
      </div>
    </nav>
  )
}
