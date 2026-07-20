import { supabase } from './supabase.js';

// Shared, mutable auth snapshot — import by reference and read `authState.user`
// / `authState.profile` anywhere. Populated by initAuth() and kept in sync.
export const authState = { user: null, profile: null };

async function loadProfile() {
  if (!authState.user) { authState.profile = null; return null; }
  const { data, error } = await supabase
    .from('profiles').select('*').eq('id', authState.user.id).maybeSingle();
  if (error) console.warn('[auth] profile load failed:', error.message);
  authState.profile = data ?? null;
  return authState.profile;
}

// Call once on boot. Restores an existing session from localStorage (if any)
// and returns the signed-in user, or null. Also keeps authState fresh on
// token refresh / sign-out happening in another tab.
export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  authState.user = data.session?.user ?? null;
  if (authState.user) await loadProfile();

  supabase.auth.onAuthStateChange((_event, session) => {
    authState.user = session?.user ?? null;
    if (!authState.user) authState.profile = null;
  });
  return authState.user;
}

// Create an account. With "Confirm email" turned OFF in Supabase, this signs
// the user straight in and we can write their profile row immediately.
export async function signUp({ email, password, username }) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.session) {
    // Email confirmation is still ON — the profile insert would fail (no auth
    // session yet). Tell the maintainer how to fix it.
    throw new Error('Account made, but email confirmation is ON. Turn it OFF in Supabase → Authentication → Email, then sign in.');
  }
  authState.user = data.user;
  const { error: pErr } = await supabase
    .from('profiles').insert({ id: data.user.id, username: username.trim() });
  if (pErr) {
    // Most likely a duplicate username.
    throw new Error(pErr.code === '23505' ? 'That name is already taken.' : pErr.message);
  }
  await loadProfile();
  return authState.user;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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

export const isLoggedIn = () => Boolean(authState.user);
export const isAdmin    = () => authState.profile?.role === 'admin';
export const displayName = () => authState.profile?.username || 'Student';
