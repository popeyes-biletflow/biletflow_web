/** localStorage helpers that never throw (private mode / blocked storage keeps the session in memory only). */
export const readStored = (key: string) => {
  try { return localStorage.getItem(key); } catch { return null; }
};

export const writeStored = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
};

export const PENDING_NAME_KEY = 'pending_full_name';

/** Signup only takes email + password; the name is written to the profile on first login (AuthContext). */
export const rememberPendingName = (name: string) => writeStored(PENDING_NAME_KEY, name.trim() || null);
