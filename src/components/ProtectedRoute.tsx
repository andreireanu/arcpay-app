import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import type { ReactNode } from "react";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session } = useAuth();

  if (session === undefined) {
    return <p>Loading...</p>;
  }
  return session ? <>{children}</> : <Navigate to="/login" replace />;
}
