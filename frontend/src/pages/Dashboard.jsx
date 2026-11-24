import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Package, Truck, CheckCircle, Wallet, ArrowRight, Warning, Archive } from "@phosphor-icons/react";

const StatCard = ({ icon: Icon, label, value, sub, accent, testid, onClick }) => (
  <button data-testid={testid} onClick={onClick}
    className="fade-up text-left bg-white border border-slate-200 rounded-sm p-5 shadow-sm hover:shadow-md hover:-translate-y-[1px] transition-all">
    <div className="flex items-center justify-between mb-3">
      <div className="label-caps">{label}</div>
      <div className={`w-8 h-8 rounded-sm flex items-center justify-center ${accent}`}><Icon size={18} weight="fill" /></div>
    </div>
    <div className="text-3xl font-black tracking-tighter text-slate-900" style={{ fontFamily: "Chivo" }}>{value}</div>
    {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
  </button>
);

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [ships, setShips] = useState([]);
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    api.get("/shipments").then(r => setShips(r.data)).catch(() => {});
    if (user?.billing_type === "prepaid") {
      api.get("/wallet/balance").then(r => setBalance(r.data)).catch(() => {});
    }
  }, [user]);

  const stats = useMemo(() => ({
    tot: ships.length,
    inTransit: ships.filter(s => ["in_transit", "out_for_delivery", "created"].includes(s.status)).length,
    delivered: ships.filter(s => s.status === "delivered").length,
    customs: ships.filter(s => s.status === "in_customs").length,
    storage: ships.filter(s => s.status === "in_storage").length,
  }), [ships]);

  const go = (f) => () => nav(`/shipments?filter=${f}`);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="label-caps text-orange-600 mb-1">Dashboard</div>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-slate-900" style={{ fontFamily: "Chivo" }}>
            Ciao, {user?.company_name?.split(" ")[0] || "Cliente"}.
          </h1>
        </div>
        <Link to="/shipments/new" data-testid="dashboard-new-shipment"
          className="inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-5 h-11 rounded-sm font-semibold">
          <Package size={18} weight="fill" /> Nuova Spedizione
        </Link>
      </div>

      {user?.billing_type === "prepaid" && (
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-sm p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="label-caps text-slate-400 mb-1">Credito residuo</div>
            <div className="text-5xl font-black tracking-tighter text-orange-400" style={{ fontFamily: "Chivo" }} data-testid="dashboard-balance">
              € {(balance?.balance ?? user?.credit_balance ?? 0).toFixed(2)}
            </div>
          </div>
          <Link to="/topup" data-testid="dashboard-topup" className="inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-700 px-5 h-11 rounded-sm font-semibold">
            <Wallet size={18} weight="fill" /> Ricarica
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard testid="stat-total" icon={Package} label="Spedizioni Totali" value={stats.tot} accent="bg-slate-100 text-slate-700" onClick={go("all")} />
        <StatCard testid="stat-transit" icon={Truck} label="In Transito" value={stats.inTransit} accent="bg-blue-100 text-blue-700" onClick={go("in_transit")} />
        <StatCard testid="stat-delivered" icon={CheckCircle} label="Consegnate" value={stats.delivered} accent="bg-green-100 text-green-700" onClick={go("delivered")} />
        <StatCard testid="stat-customs" icon={Warning} label="In Dogana" value={stats.customs} accent="bg-yellow-100 text-yellow-700" onClick={go("in_customs")} />
        <StatCard testid="stat-storage" icon={Archive} label="Giacenze" value={stats.storage} accent="bg-red-100 text-red-700" onClick={go("in_storage")} />
      </div>

      <div className="bg-white border border-slate-200 rounded-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold tracking-tight" style={{ fontFamily: "Chivo" }}>Ultime spedizioni</h2>
          <Link to="/shipments" className="text-orange-600 text-sm font-semibold hover:underline inline-flex items-center gap-1">Tutte <ArrowRight size={14} /></Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left label-caps"><th className="px-5 py-3">Tracking</th><th className="px-5 py-3">Corriere</th><th className="px-5 py-3">Destinatario</th><th className="px-5 py-3">Prezzo</th><th className="px-5 py-3">Stato</th></tr>
            </thead>
            <tbody>
              {ships.slice(0, 6).map(s => (
                <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-mono text-xs">{s.tracking_number}</td>
                  <td className="px-5 py-3 font-semibold">{s.carrier_name}</td>
                  <td className="px-5 py-3">{s.recipient?.company_name}</td>
                  <td className="px-5 py-3 font-semibold">€ {s.price.toFixed(2)}</td>
                  <td className="px-5 py-3"><StatusBadge status={s.status} /></td>
                </tr>
              ))}
              {ships.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500">Nessuna spedizione.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function StatusBadge({ status }) {
  const map = {
    created: { c: "bg-slate-100 text-slate-700 border-slate-200", l: "Creata" },
    in_transit: { c: "bg-blue-50 text-blue-700 border-blue-200", l: "In Transito" },
    out_for_delivery: { c: "bg-indigo-50 text-indigo-700 border-indigo-200", l: "In Consegna" },
    delivered: { c: "bg-green-50 text-green-700 border-green-200", l: "Consegnata" },
    in_customs: { c: "bg-yellow-50 text-yellow-800 border-yellow-200", l: "In Dogana" },
    in_storage: { c: "bg-red-50 text-red-700 border-red-200", l: "Giacenza" },
    exception: { c: "bg-red-50 text-red-700 border-red-200", l: "Anomalia" },
    cancelled: { c: "bg-red-100 text-red-800 border-red-300", l: "Annullata" },
  };
  const m = map[status] || map.created;
  return <span className={`inline-block px-2.5 py-0.5 text-xs font-semibold border rounded-sm ${m.c}`}>{m.l}</span>;
}
