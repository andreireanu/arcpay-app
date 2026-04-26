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
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        <div className="w-full max-w-sm bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 shadow-sm text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mb-2">Check your email</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            We sent a confirmation link to your email address. Click it to activate your account, then{' '}
            <Link to="/login" className="text-purple-600 dark:text-purple-400 hover:underline">sign in</Link>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50 text-center mb-1">Arc Pay</h1>
        <h2 className="text-lg text-gray-500 dark:text-gray-400 text-center mb-6">Create account</h2>
        <form action={submitAction} className="flex flex-col gap-4" autoComplete="off">
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Email
            </label>
            <input
              type="email"
              id="email"
              name="email"
              autoComplete="off"
              required
              disabled={isPending}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Password
            </label>
            <input
              type="password"
              id="password"
              name="password"
              autoComplete="new-password"
              minLength={6}
              required
              disabled={isPending}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
            />
          </div>
          {state?.type === 'error' && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {state.message}
            </p>
          )}
          <button
            type="submit"
            disabled={isPending}
            className="w-full py-2 px-4 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {isPending ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="text-sm text-center text-gray-500 dark:text-gray-400 mt-4">
          Already have an account?{' '}
          <Link to="/login" className="text-purple-600 dark:text-purple-400 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
