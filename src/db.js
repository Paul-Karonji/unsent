import { get, set } from 'idb-keyval';
import { supabase } from './lib/supabase';

export const PENDING_SYNC_KEY = 'unsent_pending_entries';
export const CACHED_ENTRIES_KEY = 'unsent_cached_entries';
export const PENDING_DELETIONS_KEY = 'unsent_pending_deletions';
export const LOCAL_HASH_KEY = 'unsent_local_hash';
export const USER_ID_KEY = 'unsent_user_id';

// PBKDF2 parameters for the offline unlock hash. Stored hashes embed their own
// iteration count so it can be raised later without breaking existing devices.
const PBKDF2_ITERATIONS = 600000;
const PBKDF2_HASH = 'SHA-256';

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function derivePasswordBits(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: PBKDF2_HASH, salt, iterations },
    keyMaterial,
    256
  );
}

// Hashes the password for local offline checking.
// Format: pbkdf2$<iterations>$<salt-hex>$<hash-hex>
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hashBuffer = await derivePasswordBits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(hashBuffer))}`;
}

// Legacy format was a single unsalted SHA-256 hex digest.
async function legacyHashPassword(password) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return bytesToHex(new Uint8Array(hashBuffer));
}

// Verifies a password against a stored hash.
// Returns { ok, upgrade } — upgrade is true when a legacy hash matched and
// should be re-stored in the PBKDF2 format.
export async function verifyPassword(password, stored) {
  if (!stored) return { ok: false, upgrade: false };

  if (stored.startsWith('pbkdf2$')) {
    const [, iterations, saltHex, hashHex] = stored.split('$');
    try {
      const hashBuffer = await derivePasswordBits(password, hexToBytes(saltHex), parseInt(iterations, 10));
      return { ok: bytesToHex(new Uint8Array(hashBuffer)) === hashHex, upgrade: false };
    } catch {
      return { ok: false, upgrade: false };
    }
  }

  const legacy = await legacyHashPassword(password);
  return { ok: legacy === stored, upgrade: legacy === stored };
}

// Store entries locally for fast reading
export async function cacheEntriesLocally(entries) {
  await set(CACHED_ENTRIES_KEY, entries);
}

// Get cached entries (including pending ones on top), deduplicated by id
export async function getLocalEntries() {
  const cached = (await get(CACHED_ENTRIES_KEY)) || [];
  const pending = (await get(PENDING_SYNC_KEY)) || [];

  const seen = new Set();
  const allEntries = [];
  for (const entry of [...pending, ...cached]) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      allEntries.push(entry);
    }
  }
  return allEntries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Save entry offline
export async function saveEntryOffline(entry) {
  const pending = (await get(PENDING_SYNC_KEY)) || [];
  pending.push(entry);
  await set(PENDING_SYNC_KEY, pending);
}

async function getSessionUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user || null;
}

// Attempt to sync pending entries to Supabase. Entries keep the UUID generated
// locally so a retried sync after a partial failure stays idempotent.
export async function syncPendingEntries() {
  const pending = (await get(PENDING_SYNC_KEY)) || [];
  if (pending.length === 0) return false;

  const user = await getSessionUser();
  if (!user) return false; // Cannot sync without a session

  const { error } = await supabase.from('entries').insert(pending);

  if (!error) {
    await set(PENDING_SYNC_KEY, []);
    return true;
  }

  console.error('Entry sync failed:', error.message);
  return false;
}

// Replays offline deletions against the server. Returns true when the queue
// was fully cleared.
export async function syncPendingDeletions() {
  const pendingDeletions = (await get(PENDING_DELETIONS_KEY)) || [];
  if (pendingDeletions.length === 0) return false;

  const user = await getSessionUser();
  if (!user) return false;

  // Collect storage paths first, before the cascade removes the rows.
  const { data: attachments } = await supabase
    .from('entry_attachments')
    .select('storage_path')
    .in('entry_id', pendingDeletions);

  if (attachments && attachments.length > 0) {
    await supabase.storage.from('attachments').remove(attachments.map(att => att.storage_path));
  }

  const { error } = await supabase.from('entries').delete().in('id', pendingDeletions);

  if (!error) {
    await set(PENDING_DELETIONS_KEY, []);
    return true;
  }

  console.error('Deletion sync failed:', error.message);
  return false;
}
