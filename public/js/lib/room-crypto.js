// End-to-end encryption for classroom rosters. Real names never reach the
// server in readable form:
//   - When a teacher creates a room, their browser makes a random teacher key,
//     an RSA-OAEP key pair, and wraps the private key with an AES key derived
//     from the teacher key. The server stores the public key, the wrapped
//     private key, and a hash of an auth token (also derived from the teacher
//     key). It never sees the teacher key itself.
//   - A student's browser encrypts the real name with the room's public key
//     before sending it.
//   - Only a browser holding the teacher key can unwrap the private key and
//     read the names.
// Uses Web Crypto (globalThis.crypto.subtle), so it runs in browsers and Node 20+.

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

const B32 = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789'.slice(0, 32); // no I, L, O, U
const KEY_BYTES = 20;

export function toBase64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}
export function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}
const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** A new random teacher key, e.g. "K7QM-2RXH-…" (160 bits). */
export function generateTeacherKey() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  return base32(bytes).match(/.{1,4}/g).join('-');
}

/** Normalizes what a teacher typed; returns null if it can't be a teacher key. */
export function normalizeTeacherKey(input) {
  const s = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return s.length === 32 && [...s].every((c) => B32.includes(c)) ? s : null;
}

async function secrets(teacherKey) {
  const norm = normalizeTeacherKey(teacherKey);
  if (!norm) throw new Error('That teacher key doesn’t look right.');
  const base = await subtle().importKey('raw', enc.encode(norm), 'HKDF', false, ['deriveBits', 'deriveKey']);
  const salt = enc.encode('student-atlas-room-v1');
  const authBits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('auth') }, base, 256);
  const wrapKey = await subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('wrap') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { authToken: toHex(authBits), wrapKey };
}

/** The token a teacher's browser sends to prove it holds the teacher key. */
export async function roomAuthToken(teacherKey) {
  return (await secrets(teacherKey)).authToken;
}

/** Everything the server stores for a new room (none of it reveals names). */
export async function createRoomKeys(teacherKey) {
  const { authToken, wrapKey } = await secrets(teacherKey);
  const pair = await subtle().generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt'],
  );
  const spki = await subtle().exportKey('spki', pair.publicKey);
  const pkcs8 = await subtle().exportKey('pkcs8', pair.privateKey);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await subtle().encrypt({ name: 'AES-GCM', iv }, wrapKey, pkcs8);
  return { authToken, publicKey: toBase64(spki), wrappedKey: toBase64(wrapped), wrapIv: toBase64(iv) };
}

/** Encrypts a student's real name for the room (done in the student's browser). */
export async function encryptName(publicKeyB64, name) {
  const key = await subtle().importKey('spki', fromBase64(publicKeyB64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const clean = String(name ?? '').normalize('NFC').trim().slice(0, 60);
  return toBase64(await subtle().encrypt({ name: 'RSA-OAEP' }, key, enc.encode(clean)));
}

/** Unlocks a room's roster in the teacher's browser. */
export async function openRoom(teacherKey, { wrappedKey, wrapIv }) {
  const { wrapKey } = await secrets(teacherKey);
  let pkcs8;
  try {
    pkcs8 = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(wrapIv) }, wrapKey, fromBase64(wrappedKey));
  } catch {
    throw new Error('That teacher key doesn’t unlock this room.');
  }
  const privateKey = await subtle().importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  return {
    async decryptName(b64) {
      if (!b64) return null;
      try {
        return dec.decode(await subtle().decrypt({ name: 'RSA-OAEP' }, privateKey, fromBase64(b64)));
      } catch {
        return null;
      }
    },
  };
}
