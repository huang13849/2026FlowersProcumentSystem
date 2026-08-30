import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProductList from './pages/ProductList';
import ProductForm from './pages/ProductForm';

function Layout({ children }) { return <><Navbar />{children}</>; }

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout><ProductList /></Layout>} />
        <Route path="/products/new" element={<Layout><ProductForm /></Layout>} />
        <Route path="/product-submissions" element={<Layout><ProductList initialTab="submissions" /></Layout>} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </HashRouter>
  );
}
