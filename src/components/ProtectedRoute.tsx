import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import type { ReactNode } from "react";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { loading, authenticated } = useAuth();

  if (loading) {
    return null;
  }
  return authenticated ? <>{children}</> : <Navigate to="/login" replace />;
}
