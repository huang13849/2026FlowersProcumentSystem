import { Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import SupplierList from './pages/SupplierList'
import SupplierForm from './pages/SupplierForm'
import SupplierDetail from './pages/SupplierDetail'
import InternetSuppliers from './pages/InternetSuppliers'

function Layout({ children }) { return <><Navbar />{children}</> }

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout><SupplierList /></Layout>} />
      <Route path="/internet-suppliers" element={<Layout><InternetSuppliers /></Layout>} />
      <Route path="/suppliers/new" element={<Layout><SupplierForm /></Layout>} />
      <Route path="/suppliers/:id" element={<Layout><SupplierDetail /></Layout>} />
      <Route path="/suppliers/:id/edit" element={<Layout><SupplierForm /></Layout>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  )
}
