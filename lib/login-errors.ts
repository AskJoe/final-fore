/** The sign-in page shows only these fixed messages; it never echoes text from the URL. */
export const LOGIN_ERRORS: Record<string, string> = {
  missing: 'Enter your email and password.',
  credentials: 'Unable to sign in. Check your email and password.',
  access: 'Your account has not been granted access to Final Fore.',
  setup: 'Final Fore storage is not ready. The reviewed Supabase setup must be applied first.',
};
/** Where to send a signed-out or unapproved visitor. A plain 401 needs no message. */
export function loginPath(error: { status: number }): string {
  return '/login' + (error.status === 401 ? '' : '?error=' + (error.status === 403 ? 'access' : 'setup'));
}
