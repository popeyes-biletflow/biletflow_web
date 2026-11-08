export const API_BASE_URL = (
  (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ??
  'http://localhost:8000'
).replace(/\/$/, '');
