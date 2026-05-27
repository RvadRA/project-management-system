import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import api from '../api/client';

export interface User {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  full_name: string;
  role: string;
  domain: string | null;
  phone: string;
  telegram_chat_id?: string;
  notify_telegram?: boolean;
  notify_email?: boolean;
  notify_daily_digest?: boolean;
  bio?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (access: string, refresh: string) => void;
  logout: () => void;
  updateUserLocal: (userData: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = async () => {
    try {
      const response = await api.get('/users/me/');
      setUser(response.data);
    } catch (err) {
      console.error('Failed to fetch user', err);
      logout();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token) {
      fetchUser();
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (access: string, refresh: string) => {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    // Add a tiny delay to ensure interceptors pick up the new token
    await new Promise(r => setTimeout(r, 100));
    await fetchUser();
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
    window.location.href = '/login';
  };

  const updateUserLocal = (userData: User) => {
    setUser(userData);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUserLocal }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
