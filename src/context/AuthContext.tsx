import { createContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSession, onAuthStateChange, signIn, signOut, signUp } from '../supabase/auth/auth'

interface AuthContextType {
  session: Session | null | undefined  // undefined = still loading
  signInUser: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  signUpUser: (
    email: string,
    password: string,
  ) => Promise<{ success: boolean; emailConfirmationRequired: boolean; error?: string }>
  signOutUser: () => Promise<{ success: boolean; error?: string }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthContextProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    getSession().then(setSession)
    const { unsubscribe } = onAuthStateChange(setSession)
    return unsubscribe
  }, [])

  return (
    <AuthContext.Provider
      value={{
        session,
        signInUser: signIn,
        signUpUser: signUp,
        signOutUser: signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export { AuthContext }
export type { AuthContextType }
