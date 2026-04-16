import { useActionState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useNavigate, Link } from "react-router-dom";

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
    <div>
      <h1>Arc Pay</h1>
      <h2>Sign in</h2>
      <form action={submitAction}>
        <div>
          <label htmlFor="email">Email</label>
          <input
            type="email"
            id="email"
            name="email"
            required
            disabled={isPending}
          />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            type="password"
            id="password"
            name="password"
            required
            disabled={isPending}
          />
        </div>
        {error && <p role="alert">Login error: {error}</p>}
        <button type="submit" disabled={isPending}>
          {isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p>
        No account? <Link to="/register">Register</Link>
      </p>
    </div>
  );
}
