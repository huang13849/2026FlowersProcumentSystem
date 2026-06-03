import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api';
const AuthContext = createContext();
export const useAuth = () => useContext(AuthContext);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) api.get('/auth/me').then(r => setUser(r.data.user)).catch(() => {}).finally(() => setLoading(false));
    else setLoading(false);
  }, []);
  const login = async (username, password) => {
    const r = await api.post('/auth/login', { username, password });
    localStorage.setItem('token', r.data.token); setUser(r.data.user); return r.data;
  };
  const logout = () => { localStorage.removeItem('token'); setUser(null); };
  return <AuthContext.Provider value={{ user, login, logout, loading }}>{children}</AuthContext.Provider>;
}
