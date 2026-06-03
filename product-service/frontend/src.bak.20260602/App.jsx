import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import ProductList from './pages/ProductList';
import ProductForm from './pages/ProductForm';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding:24, textAlign:'center', color:'#888' }}>加载中…</div>;
  if (!user) return <Navigate to="/login" />;
  return children;
}

function Layout({ children }) { return <><Navbar />{children}</>; }

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Protected><Layout><ProductList /></Layout></Protected>} />
          <Route path="/products/new" element={<Protected><Layout><ProductForm /></Layout></Protected>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
