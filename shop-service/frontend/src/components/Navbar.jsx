export default function Navbar() {
  return (
    <nav style={{
      background: '#1a1a2e', padding: '0 20px', display: 'flex',
      alignItems: 'center', height: 48, color: '#fff', justifyContent: 'space-between'
    }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold', fontSize: 15 }}>🏪 店铺注册管理系统</span>
        <a href="http://100.96.54.109:3001"
          style={{ opacity: 0.6, fontSize: 13, color: '#8cf', textDecoration: 'none' }}>商品管理</a>
        <a href="http://100.96.54.109:3002"
          style={{ opacity: 0.6, fontSize: 13, color: '#8cf', textDecoration: 'none' }}>供应商管理</a>
      </div>
    </nav>
  )
}