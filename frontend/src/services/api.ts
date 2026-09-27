export interface AuthCredentials {
  email: string
  password: string
}

export interface SignupResponse {
  message: string
  user_id: string | null
}

export interface AuthResponse {
  access_token: string
  refresh_token: string
  user_id: string
  email: string
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const API_BASE_URL = (
  (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ??
  'http://localhost:8000'
).replace(/\/$/, '')

async function request<T>(path: string, credentials: AuthCredentials): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })

  const data: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const detail =
      typeof data === 'object' && data !== null && 'detail' in data
        ? data.detail
        : undefined
    const message = typeof detail === 'string' ? detail : `Request failed (${response.status}).`
    throw new ApiError(message, response.status)
  }

  return data as T
}

export function signup(credentials: AuthCredentials): Promise<SignupResponse> {
  return request<SignupResponse>('/api/auth/signup', credentials)
}

export function login(credentials: AuthCredentials): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/login', credentials)
}