/** Web Crypto helpers for Cloudflare Pages Functions (no Node crypto). */

const textEncoder = new TextEncoder()

export const randomId = (bytes = 16) => {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const randomToken = (bytes = 32) => {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const bufferToHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

const hexToBuffer = (hex: string) => {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/** PBKDF2-SHA-256, 100k iterations — edge-friendly, independent of local agent scrypt. */
export const hashPassword = async (password: string, saltHex: string) => {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBuffer(saltHex),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  )
  return bufferToHex(bits)
}

export const newSaltHex = () => {
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  return bufferToHex(buf.buffer)
}

export const timingSafeEqualHex = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}
