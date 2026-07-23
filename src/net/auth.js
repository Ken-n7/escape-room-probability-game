import { supabase } from './supabase.js';

// Shared, mutable auth snapshot — import by reference and read `authState.user`
// / `authState.profile` anywhere. Populated by initAuth() and kept in sync.
export const authState = { user: null, profile: null, accessToken: null };

// Raised for our own, non-Supabase failure cases so the UI can map them to a
// friendly message. `code` is a stable string; `message` is a sane fallback.
export class AuthError extends Error {
  constructor(code, message) { super(message); this.name = 'AuthError'; this.code = code; }
}

const normEmail = e => String(e || '').trim().toLowerCase();

async function loadProfile() {
  if (!authState.user) { authState.profile = null; return null; }
  const { data, error } = await supabase
    .from('profiles').select('*').eq('id', authState.user.id).maybeSingle();
  if (error) console.warn('[auth] profile load failed:', error.message);
  authState.profile = data ?? null;
  return authState.profile;
}

let _onSignedOut = null;
// Register a callback fired when the session ends unexpectedly (token expiry, or
// a sign-out in another tab) so the app can drop back to the login screen.
export function onSignedOut(cb) { _onSignedOut = cb; }

// Call once on boot. Restores an existing session (localStorage) and returns the
// signed-in user, or null. Keeps authState fresh across refresh / cross-tab.
export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  authState.user = data.session?.user ?? null;
  authState.accessToken = data.session?.access_token ?? null;
  if (authState.user) await loadProfile();

  supabase.auth.onAuthStateChange((event, session) => {
    authState.user = session?.user ?? null;
    authState.accessToken = session?.access_token ?? null;   // kept fresh for the unload beacon
    if (!authState.user) {
      authState.profile = null;
      if (event === 'SIGNED_OUT') _onSignedOut?.();
    }
  });
  return authState.user;
}

// Ask the DB whether a display name is free (case-insensitive). Fails open — the
// unique index is the real guard, this is just for a friendly pre-submit message.
export async function isUsernameAvailable(name) {
  const { data, error } = await supabase.rpc('username_available', { name });
  if (error) { console.warn('[auth] username check failed:', error.message); return true; }
  return data === true;
}

// Create an account. The profile row is created server-side by a trigger from
// the username we pass as signup metadata, so there's no separate insert to fail
// half-way. Requires "Confirm email" OFF (otherwise there's no session yet).
export async function signUp({ email, password, username }) {
  const { data, error } = await supabase.auth.signUp({
    email: normEmail(email),
    password,
    options: { data: { username: username.trim() } },
  });
  if (error) throw error;
  if (!data.session) throw new AuthError('email_confirm_on',
    'Email confirmation is ON in Supabase. Turn it OFF (Authentication → Providers → Email), then sign in.');
  authState.user = data.user;
  await loadProfile();
  if (!authState.profile) throw new AuthError('profile_missing',
    'Account created but the profile could not be set up. Check the SQL trigger is installed.');
  return authState.user;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normEmail(email), password,
  });
  if (error) throw error;
  authState.user = data.user;
  await loadProfile();
  return authState.user;
}

export async function signOut() {
  await supabase.auth.signOut();
  authState.user = null;
  authState.profile = null;
}

export const isLoggedIn  = () => Boolean(authState.user);
export const isAdmin     = () => authState.profile?.role === 'admin';
export const displayName = () => authState.profile?.username || 'Student';
