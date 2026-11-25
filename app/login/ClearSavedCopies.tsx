'use client';
import { useEffect } from 'react';
/** Reaching sign-in means the session ended: drop the page copies kept on this computer. */
export function ClearSavedCopies() {
  useEffect(() => { try { void caches.delete('ffm-campaign-saved-v1').catch(() => {}); } catch {} }, []);
  return null;
}
