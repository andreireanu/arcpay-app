import { useActionState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { Link } from 'react-router-dom'

type FormState =
  | { type: 'error'; message: string }
  | { type: 'confirm' }
  | null

export default function Register() {
  const { signUpUser } = useAuth()

  const [state, submitAction, isPending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      const email = formData.get('email') as string
      const password = formData.get('password') as string
      const { success, emailConfirmationRequired, error } = await signUpUser(email, password)
      if (!success && error) return { type: 'error', message: error }
      if (emailConfirmationRequired) return { type: 'confirm' }
      return null
    },
    null,
  )

  if (state?.type === 'confirm') {
    return (
      <div>
        <h2>Check your email</h2>
        <p>We sent a confirmation link to your email address. Click it to activate your account, then <Link to="/login">sign in</Link>.</p>
      </div>
    )
  }

  return (
    <div>
      <h1>Arc Pay</h1>
      <h2>Create account</h2>
      <form action={submitAction}>
        <div>
          <label htmlFor="email">Email</label>
          <input type="email" id="email" name="email" required disabled={isPending} />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input type="password" id="password" name="password" minLength={6} required disabled={isPending} />
        </div>
        {state?.type === 'error' && <p role="alert">{state.message}</p>}
        <button type="submit" disabled={isPending}>
          {isPending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  )
}
