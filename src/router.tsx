import { createBrowserRouter, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import SellerDashboard from "./pages/SellerDashboard";
import Products from "./pages/Products";
import Transactions from "./pages/Transactions";
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
    path: "/products",
    element: (
      <ProtectedRoute>
        <Products />
      </ProtectedRoute>
    ),
  },
  {
    path: "/transactions",
    element: (
      <ProtectedRoute>
        <Transactions />
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
