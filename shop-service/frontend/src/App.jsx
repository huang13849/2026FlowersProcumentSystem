import { Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import ShopList from './pages/ShopList'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<><Navbar /><ShopList /></>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  )
}