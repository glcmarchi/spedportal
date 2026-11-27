import React from "react";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";
import Layout from "@/components/Layout";

import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Dashboard from "@/pages/Dashboard";
import QuickQuote from "@/pages/QuickQuote";
import NewShipment from "@/pages/NewShipment";
import Shipments from "@/pages/Shipments";
import ShipmentDetail from "@/pages/ShipmentDetail";
import AddressBook from "@/pages/AddressBook";
import Parcels from "@/pages/Parcels";
import Manifests from "@/pages/Manifests";
import Billing from "@/pages/Billing";
import TopUp from "@/pages/TopUp";
import PaymentSuccess from "@/pages/PaymentSuccess";
import Support from "@/pages/Support";
import AdminUsers from "@/pages/AdminUsers";
import AdminRates from "@/pages/AdminRates";
import AdminBroadcast from "@/pages/AdminBroadcast";
import ResellerCarriers from "@/pages/ResellerCarriers";
import SuperAdmin from "@/pages/SuperAdmin";

function PendingPage() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-sm p-8 text-center space-y-4">
        <div className="text-xs font-bold uppercase tracking-widest text-orange-600">Account in Verifica</div>
        <h1 className="text-2xl font-black text-slate-900" style={{ fontFamily: "Chivo" }}>
          Registrazione Ricevuta
        </h1>
        <p className="text-sm text-slate-600">
          Ciao <b>{user?.company_name || user?.email}</b>, il tuo account è in attesa di approvazione da parte dell'agenzia. Riceverai un'email appena sarà attivato.
        </p>
        <button
          onClick={logout}
          className="mt-2 px-5 h-10 bg-slate-900 text-white text-xs font-bold rounded-sm hover:bg-slate-800"
        >
          Torna al Login
        </button>
      </div>
    </div>
  );
}

function PaymentCancelPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-sm p-8 text-center space-y-4">
        <h1 className="text-2xl font-black text-slate-900" style={{ fontFamily: "Chivo" }}>
          Pagamento Annullato
        </h1>
        <p className="text-sm text-slate-600">
          L'operazione di pagamento è stata annullata. Nessun addebito è stato effettuato.
        </p>
        <Link
          to="/dashboard"
          className="inline-block px-5 h-10 leading-[40px] bg-orange-600 text-white text-xs font-bold rounded-sm"
        >
          Torna alla Dashboard
        </Link>
      </div>
    </div>
  );
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500">Caricamento…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function ApprovedRoute({ children }) {
  const { user } = useAuth();
  if (user?.role === "user" && user?.status !== "approved") return <Navigate to="/pending" replace />;
  return <Layout>{children}</Layout>;
}

function AdminRoute({ children }) {
  const { user } = useAuth();
  if (!["reseller_admin", "super_admin", "admin"].includes(user?.role)) return <Navigate to="/dashboard" replace />;
  return <Layout>{children}</Layout>;
}

function SuperRoute({ children }) {
  const { user } = useAuth();
  if (user?.role !== "super_admin") return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/pending" element={<Protected><PendingPage /></Protected>} />
          <Route path="/dashboard" element={<Protected><ApprovedRoute><Dashboard /></ApprovedRoute></Protected>} />
          <Route path="/quote" element={<Protected><ApprovedRoute><QuickQuote /></ApprovedRoute></Protected>} />
          <Route path="/shipments/new" element={<Protected><ApprovedRoute><NewShipment /></ApprovedRoute></Protected>} />
          <Route path="/shipments" element={<Protected><ApprovedRoute><Shipments /></ApprovedRoute></Protected>} />
          <Route path="/shipments/:id" element={<Protected><ApprovedRoute><ShipmentDetail /></ApprovedRoute></Protected>} />
          <Route path="/address-book" element={<Protected><ApprovedRoute><AddressBook /></ApprovedRoute></Protected>} />
          <Route path="/parcels" element={<Protected><ApprovedRoute><Parcels /></ApprovedRoute></Protected>} />
          <Route path="/manifests" element={<Protected><ApprovedRoute><Manifests /></ApprovedRoute></Protected>} />
          <Route path="/billing" element={<Protected><ApprovedRoute><Billing /></ApprovedRoute></Protected>} />
          <Route path="/billing/topup" element={<Protected><ApprovedRoute><TopUp /></ApprovedRoute></Protected>} />
          <Route path="/payment/success" element={<Protected><PaymentSuccess /></Protected>} />
          <Route path="/payment/cancel" element={<Protected><PaymentCancelPage /></Protected>} />
          <Route path="/support" element={<Protected><ApprovedRoute><Support /></ApprovedRoute></Protected>} />
          <Route path="/admin/users" element={<Protected><AdminRoute><AdminUsers /></AdminRoute></Protected>} />
          <Route path="/admin/rates" element={<Protected><AdminRoute><AdminRates /></AdminRoute></Protected>} />
          <Route path="/admin/carriers" element={<Protected><AdminRoute><ResellerCarriers /></AdminRoute></Protected>} />
          <Route path="/admin/broadcasts" element={<Protected><AdminRoute><AdminBroadcast /></AdminRoute></Protected>} />
          <Route path="/super" element={<Protected><SuperRoute><SuperAdmin /></SuperRoute></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}
