import type { Session } from '@supabase/supabase-js'
import { supabase } from '../client'

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
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
