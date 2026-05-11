import { useActionState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useNavigate, Link } from "react-router-dom";
import s from "../styles/auth.module.css";

export default function Login() {
  const { signInUser } = useAuth();
  const navigate = useNavigate();

  const [error, submitAction, isPending] = useActionState(
    async (_prev: string | null, formData: FormData) => {
      const email = formData.get("email") as string;
      const password = formData.get("password") as string;
      const { success, error } = await signInUser(email, password);
      if (!success && error) return error;
      navigate("/dashboard");
      return null;
    },
    null,
  );

  return (
    <div className={s.page}>
      <div className={s.content}>
        <div className={s.logo}>
          <img src="/favicon.svg" alt="ArcPay" className={s.logoImg} />
        </div>

        <h1 className={s.heading}>Sign in</h1>

        <form action={submitAction} className={s.form}>
          <div className={s.fields}>
            <div className={s.field}>
              <label htmlFor="email" className={s.label}>Email</label>
              <input
                type="email"
                id="email"
                name="email"
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
                required
                disabled={isPending}
                className={s.input}
              />
            </div>
          </div>

          {error && <p role="alert" className={s.error}>{error}</p>}

          <div className={s.actions}>
            <button type="submit" disabled={isPending} className={s.primaryButton}>
              {isPending ? "Signing in…" : "Sign in"}
            </button>
            <div className={s.footer}>
              <span className={s.footerText}>Don't have an account?</span>
              <Link to="/register" className={s.footerLink}>Sign up</Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
