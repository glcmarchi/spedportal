import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import {
  Package, Truck, AddressBook, Cube, ClipboardText, Receipt,
  Lifebuoy, Users, CurrencyEur, Megaphone, SignOut, List, X, House, Key, Lightning,
} from "@phosphor-icons/react";

const NavItem = ({ to, icon: Icon, label, onClick }) => (
  <NavLink
    to={to}
    onClick={onClick}
    className={({ isActive }) =>
      `flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-sm transition-colors ${
        isActive
          ? "bg-orange-600 text-white"
          : "text-slate-300 hover:bg-slate-800 hover:text-white"
      }`
    }
  >
    <Icon size={18} weight="fill" />
    <span>{label}</span>
  </NavLink>
);

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  const isSuper = user?.role === "super_admin";
  const isReseller = user?.role === "reseller_admin";
  const f = user?.features || {};
  const show = (k) => isSuper || f[k] !== false;

  const userNav = [
    { to: "/dashboard", icon: House, label: "Dashboard", ok: true },
    { to: "/shipments/new", icon: Package, label: "Nuova Spedizione", ok: true },
    { to: "/quote", icon: Lightning, label: "Preventivo Rapido", ok: true },
    { to: "/shipments", icon: Truck, label: "Spedizioni", ok: true },
    { to: "/address-book", icon: AddressBook, label: "Rubrica", ok: show("address_book") },
    { to: "/parcels", icon: Cube, label: "I miei pacchi", ok: show("parcels") },
    { to: "/manifests", icon: ClipboardText, label: "Manifest", ok: show("manifests") },
    { to: "/billing", icon: Receipt, label: "Fatturazione", ok: true },
    { to: "/support", icon: Lifebuoy, label: "Assistenza", ok: true },
  ].filter((x) => x.ok);

  const adminNav = [
    { to: "/admin/users", icon: Users, label: "Sub-Clienti & Contabilità", ok: show("sub_clients") },
    { to: "/admin/rates", icon: CurrencyEur, label: "Margini Clienti", ok: show("rate_tables") },
    { to: "/admin/carriers", icon: Key, label: "I Miei Corrieri", ok: !!user?.can_manage_own_carriers },
    { to: "/admin/broadcasts", icon: Megaphone, label: "Comunicazioni", ok: show("broadcasts") },
  ].filter((x) => x.ok);

  const handleLogout = () => {
    logout();
    nav("/login");
  };

  const sidebar = (
    <div className="flex flex-col h-full bg-slate-900 text-white w-64 select-none">
      <div className="p-6 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-600 rounded-sm flex items-center justify-center font-black tracking-tighter">
            {(user?.reseller_name || "SP").slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="font-black text-lg tracking-tight truncate max-w-[165px]" style={{ fontFamily: "Chivo" }}>
              {user?.reseller_name || "SpedPortal"}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-slate-400">
              {isReseller ? "Console Reseller" : "Area Clienti"}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        <div className="px-4 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Operatività</div>
        {userNav.map((n) => (
          <NavItem key={n.to} {...n} onClick={() => setOpen(false)} />
        ))}
        {(isReseller || isSuper) && adminNav.length > 0 && (
          <>
            <div className="px-4 pt-5 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Gestione Agenzia</div>
            {adminNav.map((n) => (
              <NavItem key={n.to} {...n} onClick={() => setOpen(false)} />
            ))}
          </>
        )}
      </div>

      <div className="p-4 border-t border-slate-800 space-y-3">
        <div className="text-xs text-slate-400 truncate">
          <div className="font-semibold text-white truncate">{user?.company_name}</div>
          <div className="truncate">{user?.email}</div>
        </div>
        {user?.billing_type === "prepaid" && (
          <div className="bg-slate-800 px-3 py-2 rounded-sm flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-slate-400">Credito</span>
            <span className="text-sm font-bold text-orange-400">€ {(user?.credit_balance ?? 0).toFixed(2)}</span>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 rounded-sm"
        >
          <SignOut size={16} />
          Esci
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="hidden lg:block shrink-0">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="relative z-10">{sidebar}</div>
          <div className="flex-1 bg-black/50" onClick={() => setOpen(false)} />
        </div>
      )}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden bg-slate-900 text-white px-4 h-14 flex items-center justify-between">
          <button onClick={() => setOpen(true)} className="p-2">
            {open ? <X size={22} /> : <List size={22} />}
          </button>
          <span className="font-black tracking-tight" style={{ fontFamily: "Chivo" }}>
            {user?.reseller_name || "SpedPortal"}
          </span>
          <span className="text-xs text-orange-400 font-bold">
            {user?.billing_type === "prepaid" ? `€${(user?.credit_balance ?? 0).toFixed(0)}` : ""}
          </span>
        </header>
        <main className="flex-1 p-6 lg:p-10 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
