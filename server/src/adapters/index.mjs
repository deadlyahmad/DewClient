/**
 * DewClient Central Server - Storage Engine Factory (Supabase Exclusive)
 */

import { SupabaseStorageAdapter } from './supabaseStorage.mjs';

let activeStorage = null;

export async function getStorage() {
  if (!activeStorage) {
    activeStorage = new SupabaseStorageAdapter();
    await activeStorage.init();
  }
  return activeStorage;
}
