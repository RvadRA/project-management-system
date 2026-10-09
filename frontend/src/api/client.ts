import axios from 'axios';

export const API_BASE_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Request interceptor for JWT
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for refresh token
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const refreshToken = localStorage.getItem('refresh_token');
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && refreshToken) {
      originalRequest._retry = true;
      try {
        const response = await axios.post(`${API_BASE_URL}/auth/token/refresh/`, {
          refresh: refreshToken,
        });
        const { access, refresh } = response.data;
        localStorage.setItem('access_token', access);
        // ROTATE_REFRESH_TOKENS=True: сервер выдаёт новый refresh-токен вместе с access
        if (refresh) localStorage.setItem('refresh_token', refresh);
        originalRequest.headers.Authorization = `Bearer ${access}`;
        return api(originalRequest);
      } catch (refreshError) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

/** Загружает все страницы постраничного списка DRF (PAGE_SIZE на сервере — 50). */
export async function fetchAllPages<T = unknown>(url: string): Promise<T[]> {
  let res = await api.get(url);
  if (Array.isArray(res.data)) return res.data;
  let items: T[] = Array.isArray(res.data?.results) ? res.data.results : [];
  while (res.data?.next) {
    res = await api.get(res.data.next);
    items = items.concat(Array.isArray(res.data?.results) ? res.data.results : []);
  }
  return items;
}

/** Скачивает файл с авторизацией (прямые ссылки на /media/ права доступа не проверяют). */
export async function downloadFile(url: string, fallbackName = 'file'): Promise<void> {
  const res = await api.get(url, { responseType: 'blob' });
  const disposition: string = res.headers['content-disposition'] || '';
  const utfName = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainName = disposition.match(/filename="?([^";]+)"?/i);
  const name = utfName ? decodeURIComponent(utfName[1]) : plainName ? plainName[1] : fallbackName;

  const blobUrl = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

export default api;
