import React, { useState, useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import {
  House, Package, ListChecks, Receipt, Wallet, Users, ChartBar,
  SignOut, List as MenuIcon, Truck, AddressBook, Headset, ClipboardText,
  Megaphone, Bell, Envelope, Key,
} from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/api";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const NavItem = ({ to, icon: Icon, label, testid, active, onClick }) => (
  <Link to={to} onClick={onClick} data-testid={testid}
    className={`flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors ${active ? "bg-orange-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}>
    <Icon size={18} weight={active ? "fill" : "regular"} />
    <span>{label}</span>
  </Link>
);

export default function Layout() {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  const isActive = (p) => {
    if (p === "/shipments") return loc.pathname === "/shipments" || (loc.pathname.startsWith("/shipments/") && loc.pathname !== "/shipments/new");
    return loc.pathname === p || loc.pathname.startsWith(p + "/");
  };

  const isAdmin = ["admin", "reseller_admin", "super_admin"].includes(user?.role);
  const features = user?.features || {};
  const isReseller = user?.role === "reseller_admin";
  const isPrepaid = user?.billing_type === "prepaid" && (isReseller || features.client_prepaid !== false);

  const nav_items = [
    { to: "/dashboard", icon: House, label: "Dashboard", testid: "nav-dashboard" },
    { to: "/shipments/new", icon: Package, label: "Nuova Spedizione", testid: "nav-new-shipment" },
    { to: "/shipments", icon: ListChecks, label: "Spedizioni", testid: "nav-shipments" },
    ...(features.manifests !== false ? [{ to: "/manifests", icon: ClipboardText, label: "Manifest", testid: "nav-manifests" }] : []),
    ...(features.address_book !== false ? [{ to: "/addressbook", icon: AddressBook, label: "Rubrica", testid: "nav-addressbook" }] : []),
    ...(features.parcels ? [{ to: "/parcels", icon: Package, label: "I miei pacchi", testid: "nav-parcels" }] : []),
    ...(features.client_billing ? [{ to: "/billing", icon: Receipt, label: "Fatture", testid: "nav-billing" }] : []),
    ...(isPrepaid ? [{ to: "/topup", icon: Wallet, label: isReseller ? "Wallet & Credito" : "Ricariche", testid: "nav-topup" }] : []),
    { to: "/support", icon: Headset, label: "Supporto", testid: "nav-support" },
  ];

  const admin_items = [
    ...(features.sub_clients ? [{ to: "/admin/users", icon: Users, label: "Sub-Clienti", testid: "nav-admin-users" }] : []),
    ...(features.rate_tables ? [{ to: "/admin/rates", icon: ChartBar, label: "Listini Clienti", testid: "nav-admin-rates" }] : []),
    ...(isReseller && user?.can_manage_own_carriers
      ? [{ to: "/admin/carriers", icon: Key, label: "I Miei Corrieri", testid: "nav-admin-carriers" }]
      : []),
    ...(features.broadcasts ? [{ to: "/admin/broadcast", icon: Megaphone, label: "Comunicazioni", testid: "nav-admin-bc" }] : []),
  ];

  const SideContent = () => (
    <div className="flex flex-col h-full bg-slate-900 text-white">
      <div className="p-6 border-b border-slate-800 flex items-center gap-3">
        <div className="w-9 h-9 bg-orange-600 flex items-center justify-center rounded-sm"><Truck size={22} weight="fill" /></div>
        <div>
          <div className="font-black text-lg leading-none tracking-tight" style={{ fontFamily: "Chivo" }}>SpedPortal</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 mt-1">{user?.reseller_name || "Console Spedizioni"}</div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <div className="label-caps text-slate-500 px-3 pt-2 pb-1">Operazioni</div>
        {nav_items.map((n) => <NavItem key={n.to} {...n} active={isActive(n.to)} onClick={() => setOpen(false)} />)}
        {isAdmin && admin_items.length > 0 && (
          <>
            <div className="label-caps text-slate-500 px-3 pt-6 pb-1">Gestione Agenzia</div>
            {admin_items.map((n) => <NavItem key={n.to} {...n} active={isActive(n.to)} onClick={() => setOpen(false)} />)}
          </>
        )}
      </nav>
      <div className="p-4 border-t border-slate-800">
        <div className="text-xs text-slate-400 mb-1">Connesso come</div>
        <div className="text-sm font-semibold truncate">{user?.email}</div>
        <div className="text-xs text-slate-500 truncate mb-3">{user?.company_name}</div>
        {isPrepaid && (
          <div className="bg-slate-800 rounded-sm p-2.5 mb-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Credito residuo</div>
            <div className="text-lg font-bold text-orange-400" data-testid="sidebar-credit">€ {(user?.credit_balance ?? 0).toFixed(2)}</div>
          </div>
        )}
        <Button data-testid="logout-btn" variant="outline" onClick={() => { logout(); nav("/login"); }}
          className="w-full bg-transparent border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white rounded-sm">
          <SignOut size={16} className="mr-2" /> Esci
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 overflow-x-hidden">
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 z-30"><SideContent /></aside>
      {open && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="w-64" onClick={(e) => e.stopPropagation()}><SideContent /></div>
          <div className="flex-1 bg-black/50" onClick={() => setOpen(false)} />
        </div>
      )}
      <div className="flex-1 lg:ml-64 min-h-screen flex flex-col">
        <TopBar onMenu={() => setOpen(true)} isAdmin={isAdmin} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto"><Outlet /></main>
      </div>
    </div>
  );
}

function TopBar({ onMenu, isAdmin }) {
  const [broadcasts, setBroadcasts] = useState([]);
  const [ships, setShips] = useState([]);
  const [popupMsg, setPopupMsg] = useState(null);

  const loadBc = () => {
    if (isAdmin) return;
    api.get("/broadcasts").then(r => {
      setBroadcasts(r.data);
      const unread = r.data.find(m => !m.read);
      if (unread) setPopupMsg(unread);
    }).catch(() => {});
  };
  useEffect(() => {
    loadBc();
    api.get("/shipments").then(r => setShips(r.data.slice(0, 8))).catch(() => {});
  }, [isAdmin]);

  const markRead = async (id) => { await api.post(`/broadcasts/${id}/read`); setPopupMsg(null); loadBc(); };
  const unreadCount = broadcasts.filter(m => !m.read).length;

  return (
    <>
    <header className="bg-white border-b border-slate-200 h-14 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-20">
      <button data-testid="mobile-menu-btn" onClick={onMenu} className="lg:hidden p-2 -ml-2"><MenuIcon size={22} /></button>
      <div className="flex items-center gap-2 lg:hidden">
        <div className="w-7 h-7 bg-orange-600 flex items-center justify-center rounded-sm"><Truck size={16} weight="fill" className="text-white" /></div>
        <span className="font-black tracking-tight" style={{ fontFamily: "Chivo" }}>SpedPortal</span>
      </div>
      <div className="hidden lg:block" />
      <Popover>
        <PopoverTrigger asChild>
          <button data-testid="bell-btn" className="relative p-2 hover:bg-slate-100 rounded-sm">
            <Bell size={20} className="text-slate-700" />
            {unreadCount > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-orange-600 rounded-full" />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 p-0 rounded-sm">
          <div className="p-3 border-b border-slate-200 flex gap-4 text-sm font-semibold">
            <div className="text-slate-900 flex items-center gap-1"><Envelope size={14} /> Comunicazioni ({broadcasts.length})</div>
            <div className="text-slate-500 flex items-center gap-1"><Truck size={14} /> Spedizioni ({ships.length})</div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {broadcasts.length === 0 && <div className="p-4 text-sm text-slate-500">Nessuna comunicazione.</div>}
            {broadcasts.map(m => (
              <div key={m.id} className={`p-3 border-b border-slate-100 ${m.read ? "" : "bg-orange-50/40"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-sm">{m.title}</div>
                  {!m.read && <button onClick={() => markRead(m.id)} className="text-xs text-orange-600 font-semibold hover:underline">Letto</button>}
                </div>
                <div className="text-xs text-slate-600 mt-1">{m.body}</div>
              </div>
            ))}
            <div className="border-t-2 border-slate-100" />
            {ships.map(s => (
              <div key={s.id} className="p-3 border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold font-mono">{s.tracking_number}</div>
                  <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-sm">{s.status}</span>
                </div>
                <div className="text-xs text-slate-500">{s.carrier_name} → {s.recipient?.city}</div>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </header>
    <Dialog open={!!popupMsg} onOpenChange={(o) => !o && setPopupMsg(null)}>
      <DialogContent className="rounded-sm max-w-md">
        {popupMsg && (
          <>
            <div className="label-caps text-orange-600">Comunicazione</div>
            <h3 className="text-2xl font-black tracking-tight" style={{ fontFamily: "Chivo" }}>{popupMsg.title}</h3>
            <div className="text-sm text-slate-700 whitespace-pre-line">{popupMsg.body}</div>
            <Button onClick={() => markRead(popupMsg.id)} className="bg-orange-600 hover:bg-orange-700 rounded-sm">Letto</Button>
          </>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
