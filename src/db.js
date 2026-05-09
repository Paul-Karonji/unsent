import { get, set } from 'idb-keyval';
import { supabase } from './App';

export const PENDING_SYNC_KEY = 'unsent_pending_entries';
export const CACHED_ENTRIES_KEY = 'unsent_cached_entries';
export const LOCAL_HASH_KEY = 'unsent_local_hash';

// Hashes the password for local offline checking
export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Store entries locally for fast reading
export async function cacheEntriesLocally(entries) {
  await set(CACHED_ENTRIES_KEY, entries);
}

// Get cached entries (including pending ones on top)
export async function getLocalEntries() {
  const cached = (await get(CACHED_ENTRIES_KEY)) || [];
  const pending = (await get(PENDING_SYNC_KEY)) || [];
  
  // Create a combined list avoiding duplicates (pending usually aren't in cached yet anyway)
  // We'll put pending at the top
  const allEntries = [...pending, ...cached];
  return allEntries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Save entry offline
export async function saveEntryOffline(entry) {
  const pending = (await get(PENDING_SYNC_KEY)) || [];
  pending.push(entry);
  await set(PENDING_SYNC_KEY, pending);
}

// Attempt to sync pending entries to Supabase
export async function syncPendingEntries() {
  const pending = (await get(PENDING_SYNC_KEY)) || [];
  if (pending.length === 0) return;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return; // Cannot sync without a session

  console.log(`Syncing ${pending.length} entries to Supabase...`);

  // We should upload them one by one or in a batch
  const toUpload = pending.map(entry => {
    // We strip out the temporary id we generated locally to let Supabase generate a real UUID
    // OR if we generated a UUID locally, we can keep it. Let's assume we generated an ISO string or UUID locally.
    // Wait, the schema uses DEFAULT uuid_generate_v4() so we should omit `id`.
    const { id, ...entryWithoutId } = entry;
    return entryWithoutId;
  });

  const { error } = await supabase.from('entries').insert(toUpload);

  if (!error) {
    console.log("Sync successful!");
    // Clear pending
    await set(PENDING_SYNC_KEY, []);
    return true; // Indicates sync happened
  } else {
    console.error("Sync failed:", error.message);
    return false;
  }
}
