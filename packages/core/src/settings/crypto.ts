import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SealedSecret {
  v: number;
  iv: string;
  tag: string;
  ct: string;
}

interface MasterKey {
  version: number;
  key: Buffer;
}

function parseKey(spec: string | undefined): MasterKey | null {
  if (!spec) return null;
  const m = /^(?:(\d+):)?([A-Za-z0-9+/=]+)$/.exec(spec.trim());
  const key = m ? Buffer.from(m[2]!, 'base64') : Buffer.alloc(0);
  if (!m || key.length !== 32) throw new Error('settings master key must be "<version>:<base64 of 32 bytes>"');
  return { version: m[1] ? Number(m[1]) : 1, key };
}

/** Current key encrypts; current or previous decrypts (by stored version), so rotation never locks values out. */
function masterKeys(): { current: MasterKey; all: MasterKey[] } {
  const current = parseKey(process.env.SETTINGS_MASTER_KEY);
  if (!current) throw new Error('SETTINGS_MASTER_KEY is not set; secret settings cannot be stored or read');
  const previous = parseKey(process.env.SETTINGS_MASTER_KEY_PREVIOUS);
  if (previous && previous.version === current.version) throw new Error('SETTINGS_MASTER_KEY_PREVIOUS must have a different version');
  return { current, all: previous ? [current, previous] : [current] };
}

const aad = (moduleId: string, key: string) => Buffer.from(`${moduleId}:${key}`, 'utf8');

/** AES-256-GCM, random 96-bit IV, AAD `module:key` (a sealed value cannot be moved to another field). */
export function seal(moduleId: string, key: string, plaintext: string): SealedSecret {
  const { current } = masterKeys();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', current.key, iv);
  cipher.setAAD(aad(moduleId, key));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { v: current.version, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

/** Throws on a wrong key, a tampered ciphertext/tag/IV or a value sealed for another field. */
export function unseal(moduleId: string, key: string, sealed: SealedSecret): string {
  const master = masterKeys().all.find((k) => k.version === sealed.v);
  if (!master) throw new Error(`no master key for version ${sealed.v}`);
  const decipher = createDecipheriv('aes-256-gcm', master.key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAAD(aad(moduleId, key));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ct, 'base64')), decipher.final()]).toString('utf8');
}
