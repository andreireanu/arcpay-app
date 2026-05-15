import { createBrowserRouter, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import OfferDetail from "./pages/OfferDetail";
import Pay from "./pages/Pay";
import ProtectedRoute from "./components/ProtectedRoute";

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/login" replace /> },
  { path: "/login", element: <Login /> },
  { path: "/pay/:offerId", element: <Pay /> },
  {
    path: "/dashboard",
    element: (
      <ProtectedRoute>
        <Dashboard />
      </ProtectedRoute>
    ),
  },
  {
    path: "/offer/:offerId",
    element: (
      <ProtectedRoute>
        <OfferDetail />
      </ProtectedRoute>
    ),
  },
]);
