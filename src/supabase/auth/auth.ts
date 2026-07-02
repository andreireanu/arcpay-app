import type { Session } from '@supabase/supabase-js'
import { supabase } from '../client'

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

export function getCurrentRole(): 'seller' | 'buyer' {
  const role = localStorage.getItem('arcpay_role')
  return role === 'buyer' ? 'buyer' : 'seller'
}

// The stored role, or null if none is set yet (i.e. the user hasn't entered the
// app from either dashboard). Lets the buy page keep an existing role instead of
// forcing 'buyer', while still defaulting a fresh login to 'buyer'.
export function getStoredRole(): 'seller' | 'buyer' | null {
  const role = localStorage.getItem('arcpay_role')
  return role === 'buyer' || role === 'seller' ? role : null
}

// The chain the user chose at login. A session is scoped to one chain (model A):
// you sign in on the chain you pick and the app transacts on it. Persisted so it
// survives reloads and is available before primaryWallet resolves.
export type AppChain = 'solana' | 'sui'

export function getActiveChain(): AppChain {
  return localStorage.getItem('arcpay_chain') === 'sui' ? 'sui' : 'solana'
}

export function setActiveChain(chain: AppChain): void {
  localStorage.setItem('arcpay_chain', chain)
}

export function onAuthStateChange(callback: (session: Session | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
  return { unsubscribe: () => data.subscription.unsubscribe() }
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.toLowerCase(),
    password,
  })
  if (error) return { success: false, error: error.message }
  return { success: true }
}

export async function signUp(
  email: string,
  password: string,
): Promise<{ success: boolean; emailConfirmationRequired: boolean; error?: string }> {
  const { data, error } = await supabase.auth.signUp({
    email: email.toLowerCase(),
    password,
  })
  if (error) return { success: false, emailConfirmationRequired: false, error: error.message }
  return { success: true, emailConfirmationRequired: !data.session }
}

export async function signOut(): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.auth.signOut()
  if (error) return { success: false, error: error.message }
  return { success: true }
}
