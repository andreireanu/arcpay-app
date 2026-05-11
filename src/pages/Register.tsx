import { useActionState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { Link } from 'react-router-dom'
import s from '../styles/auth.module.css'

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
      <div className={s.page}>
        <div className={s.content}>
          <div className={s.logo}>
            <img src="/favicon.svg" alt="ArcPay" className={s.logoImg} />
          </div>
          <div className={s.confirm}>
            <h1 className={s.confirmHeading}>Check your email</h1>
            <p className={s.confirmText}>
              We sent a confirmation link to your email address. Click it to activate your account, then{' '}
              <Link to="/login" className={s.footerLink}>sign in</Link>.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={s.page}>
      <div className={s.content}>
        <div className={s.logo}>
          <img src="/favicon.svg" alt="ArcPay" className={s.logoImg} />
        </div>

        <h1 className={s.heading}>Create account</h1>

        <form action={submitAction} className={s.form} autoComplete="off">
          <div className={s.fields}>
            <div className={s.field}>
              <label htmlFor="email" className={s.label}>Email</label>
              <input
                type="email"
                id="email"
                name="email"
                autoComplete="off"
                required
                disabled={isPending}
                className={s.input}
              />
            </div>
            <div className={s.field}>
              <label htmlFor="password" className={s.label}>Password</label>
              <input
                type="password"
                id="password"
                name="password"
                autoComplete="new-password"
                minLength={6}
                required
                disabled={isPending}
                className={s.input}
              />
            </div>
          </div>

          {state?.type === 'error' && (
            <p role="alert" className={s.error}>{state.message}</p>
          )}

          <div className={s.actions}>
            <button type="submit" disabled={isPending} className={s.primaryButton}>
              {isPending ? 'Creating account…' : 'Create account'}
            </button>
            <div className={s.footer}>
              <span className={s.footerText}>Already have an account?</span>
              <Link to="/login" className={s.footerLink}>Sign in</Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
