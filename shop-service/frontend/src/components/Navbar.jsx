export default function Navbar() {
  const linkStyle = { opacity: 0.6, fontSize: 13, color: '#8cf', textDecoration: 'none', cursor: 'pointer' }
  return (
    <nav style={{
      background: '#1a1a2e', padding: '0 20px', display: 'flex',
      alignItems: 'center', height: 48, color: '#fff', justifyContent: 'space-between'
    }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold', fontSize: 15 }}>🏪 经销商系统</span>
        <a href="http://100.96.54.109:31001" style={linkStyle}>商品管理</a>
        <a href="http://100.96.54.109:31002" style={linkStyle}>供应商管理</a>
        <a href="http://106.12.91.182/map" style={linkStyle}>地图</a>
      </div>
    </nav>
  )
}
