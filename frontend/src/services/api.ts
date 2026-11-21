import { API_BASE_URL } from './config'

export interface AuthResponse {
  access_token: string
  refresh_token: string
  user_id: string
  email: string
  expires_in?: number | null
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// запрос к /api/auth/... (detail из FastAPI кладём в message)
async function request(path: string, body?: object, token?: string, method = 'POST') {
  const headers: Record<string, string> = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = 'Bearer ' + token

  const res = await fetch(API_BASE_URL + path, {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)

  if (!res.ok) {
    const msg = data && typeof data.detail === 'string' ? data.detail : 'Request failed (' + res.status + ')'
    throw new ApiError(msg, res.status)
  }
  return data
}

export function signup(email: string, password: string, fullName: string) {
  return request('/api/auth/signup', { email: email, password: password, full_name: fullName })
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return request('/api/auth/login', { email: email, password: password })
}

export function refreshSession(refreshToken: string): Promise<AuthResponse> {
  return request('/api/auth/refresh', { refresh_token: refreshToken })
}

export function logoutSession(token: string) {
  return request('/api/auth/logout', undefined, token)
}

export function resendVerification(email: string) {
  return request('/api/auth/resend-verification', { email: email })
}

export function requestPasswordReset(email: string) {
  return request('/api/auth/reset-password', { email: email })
}

export function confirmPasswordReset(token: string, newPassword: string) {
  return request('/api/auth/reset-password/confirm', { token: token, new_password: newPassword })
}

export function verifyEmail(token: string) {
  return request('/api/auth/verify?token=' + encodeURIComponent(token), undefined, undefined, 'GET')
}

// Supabase возвращает токены в hash: #access_token=...&refresh_token=...&type=signup
export function readAuthHash(hash: string) {
  const params = new URLSearchParams(hash.replace('#', ''))
  return {
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    type: params.get('type'),
    error: params.get('error_description') || params.get('error'),
  }
}
