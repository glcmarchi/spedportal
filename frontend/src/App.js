import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import NewShipment from "@/pages/NewShipment";
import Shipments from "@/pages/Shipments";
import ShipmentDetail from "@/pages/ShipmentDetail";
import Billing from "@/pages/Billing";
import TopUp from "@/pages/TopUp";
import PaymentSuccess from "@/pages/PaymentSuccess";
import PaymentCancel from "@/pages/PaymentCancel";
import AdminUsers from "@/pages/AdminUsers";
import AdminRates from "@/pages/AdminRates";
import AdminBroadcast from "@/pages/AdminBroadcast";
import AddressBook from "@/pages/AddressBook";
import MyParcels from "@/pages/MyParcels";
import Support from "@/pages/Support";
import Manifests from "@/pages/Manifests";
import PendingApproval from "@/pages/PendingApproval";
import SuperAdmin from "@/pages/SuperAdmin";
import ResellerCarriers from "@/pages/ResellerCarriers";

const ADMIN_ROLES = ["admin", "reseller_admin", "super_admin"];

function SuperOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-500">Caricamento…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "super_admin") return <Navigate to="/dashboard" replace />;
  return children;
}

function Protected({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-500">Caricamento…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "super_admin" && !adminOnly) return <Navigate to="/super-admin" replace />;
  const isAdmin = ADMIN_ROLES.includes(user.role);
  if (adminOnly && !isAdmin) return <Navigate to="/dashboard" replace />;
  if (user.role === "user" && user.status !== "approved") return <PendingApproval />;
  return children;
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <Toaster position="top-right" richColors />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/super-admin" element={<SuperOnly><SuperAdmin /></SuperOnly>} />
            <Route path="/payment/success" element={<PaymentSuccess />} />
            <Route path="/payment/cancel" element={<PaymentCancel />} />
            <Route element={<Protected><Layout /></Protected>}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/shipments/new" element={<NewShipment />} />
              <Route path="/shipments" element={<Shipments />} />
              <Route path="/shipments/:id" element={<ShipmentDetail />} />
              <Route path="/billing" element={<Billing />} />
              <Route path="/topup" element={<TopUp />} />
              <Route path="/addressbook" element={<AddressBook />} />
              <Route path="/parcels" element={<MyParcels />} />
              <Route path="/support" element={<Support />} />
              <Route path="/manifests" element={<Manifests />} />
              <Route path="/admin/users" element={<Protected adminOnly><AdminUsers /></Protected>} />
              <Route path="/admin/rates" element={<Protected adminOnly><AdminRates /></Protected>} />
              <Route path="/admin/carriers" element={<Protected adminOnly><ResellerCarriers /></Protected>} />
              <Route path="/admin/broadcast" element={<Protected adminOnly><AdminBroadcast /></Protected>} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}
export default App;
