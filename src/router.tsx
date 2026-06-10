import { createBrowserRouter, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import SellerDashboard from "./pages/SellerDashboard";
import OfferDetail from "./pages/OfferDetail";
import Pay from "./pages/Pay";
import ProtectedRoute from "./components/ProtectedRoute";

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/login" replace /> },
  { path: "/login", element: <Login /> },
  { path: "/pay/:offerId", element: <Pay /> },
  { path: "/dashboard", element: <Navigate to="/seller" replace /> },
  {
    path: "/seller",
    element: (
      <ProtectedRoute>
        <SellerDashboard />
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
