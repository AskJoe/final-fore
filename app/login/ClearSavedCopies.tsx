'use client';
import { useEffect } from 'react';
/** Reaching sign-in means the session ended: drop the page copies kept on this computer. */
export function ClearSavedCopies() {
  useEffect(() => {
    void (async () => { try { for (const name of await caches.keys()) if (name.startsWith('ffm-')) await caches.delete(name); } catch {} })();
  }, []);
  return null;
}
