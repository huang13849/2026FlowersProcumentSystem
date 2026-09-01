import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import SupplierList from './pages/SupplierList'
import SupplierForm from './pages/SupplierForm'
import SupplierDetail from './pages/SupplierDetail'
import InternetSuppliers from './pages/InternetSuppliers'
import SupplierApplications from './pages/SupplierApplications'

function Layout({ children }) {
  const location = useLocation()
  const tab = (to, label) => <Link to={to} style={{ textDecoration: 'none', padding: '9px 14px', borderRadius: 8, color: location.pathname === to ? '#fff' : '#335743', background: location.pathname === to ? '#17673d' : '#eef6ef' }}>{label}</Link>
  return <><Navbar /><nav style={{ display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid #dbe6de', background: '#fff' }}>{tab('/', '供应商管理')}{tab('/supplier-applications', '供应商审批')}{tab('/internet-suppliers', '互联网供应商')}</nav>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout><SupplierList /></Layout>} />
      <Route path="/internet-suppliers" element={<Layout><InternetSuppliers /></Layout>} />
      <Route path="/supplier-applications" element={<Layout><SupplierApplications /></Layout>} />
      <Route path="/suppliers/new" element={<Layout><SupplierForm /></Layout>} />
      <Route path="/suppliers/:id" element={<Layout><SupplierDetail /></Layout>} />
      <Route path="/suppliers/:id/edit" element={<Layout><SupplierForm /></Layout>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  )
}
