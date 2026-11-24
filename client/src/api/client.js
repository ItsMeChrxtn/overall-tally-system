import axios from 'axios';

export const TOKEN_KEY = 'otms_token';
export const API_URL = import.meta.env.VITE_API_URL || '/api';
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

const api = axios.create({ baseURL: API_URL, timeout: 30000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Session expiration / revocation: broadcast so AuthContext can sign the user out cleanly
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error.response?.status;
    const code = error.response?.data?.code;
    if (status === 401 && localStorage.getItem(TOKEN_KEY) && !error.config?.url?.includes('/auth/login')) {
      window.dispatchEvent(new CustomEvent('auth:expired', { detail: { message: error.response?.data?.message, code } }));
    }
    if (status === 403 && code === 'PASSWORD_CHANGE_REQUIRED') {
      window.dispatchEvent(new CustomEvent('auth:password-change'));
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (error?.response?.data?.message) {
    const errors = error.response.data.errors;
    return Array.isArray(errors) && errors.length ? `${error.response.data.message}\n• ${errors.join('\n• ')}` : error.response.data.message;
  }
  if (error?.code === 'ECONNABORTED') return 'The server took too long to respond.';
  if (error?.message === 'Network Error') return 'Cannot reach the server. Check your connection.';
  return fallback;
}

/** Absolute URL for files served by the API (uploads). */
export function fileUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${SERVER_URL}${path}`;
}

/** Downloads a binary response (Excel exports). */
export async function downloadFile(url, params, fallbackName = 'report.xlsx') {
  const res = await api.get(url, { params, responseType: 'blob' });
  const disposition = res.headers['content-disposition'] || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const name = match ? match[1] : fallbackName;
  const href = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}

export default api;
