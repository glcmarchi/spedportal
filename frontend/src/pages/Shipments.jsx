import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/pages/Dashboard";
import { toast } from "sonner";
import { DownloadSimple, ArrowClockwise, Package, MagnifyingGlass, Printer } from "@phosphor-icons/react";

export default function Shipments() {
  const { user } = useAuth();
  const isResellerOrAdmin = ["reseller_admin", "super_admin", "admin"].includes(user?.role);
  const [params] = useSearchParams();
  const filter = params.get("filter") || "all";
  const [ships, setShips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [originFilter, setOriginFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    try { const r = await api.get("/shipments"); setShips(r.data); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const exportXlsx = async () => {
    try {
      const r = await api.get("/shipments/export/xlsx", { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a"); a.href = url; a.download = "spedizioni.xlsx"; a.click(); URL.revokeObjectURL(url);
      toast.success("Excel scaricato");
    } catch { toast.error("Errore export"); }
  };

  const label = async (s) => {
    const r = await api.get(`/shipments/${s.id}/label`, { responseType: "blob" });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a"); a.href = url; a.download = `label-${s.tracking_number}.pdf`; a.click(); URL.revokeObjectURL(url);
  };

  const filtered = ships.filter(s => {
    if (filter !== "all") {
      if (filter === "in_transit" && !["in_transit", "out_for_delivery", "created"].includes(s.status)) return false;
      if (filter !== "in_transit" && s.status !== filter) return false;
    }
    if (isResellerOrAdmin && originFilter !== "all") {
      const isClient = s.created_by_role === "user";
      if (originFilter === "reseller" && isClient) return false;
      if (originFilter === "subclients" && !isClient) return false;
    }
    if (!q) return true;
    const t = q.toLowerCase();
    return (
      s.tracking_number?.toLowerCase().includes(t) ||
      s.recipient?.company_name?.toLowerCase().includes(t) ||
      s.carrier_name?.toLowerCase().includes(t) ||
      s.user_company_name?.toLowerCase().includes(t)
    );
  });

  const cancelledByText = (s) => {
    if (s.status !== "cancelled") return null;
    if (s.cancelled_by_role === "reseller_admin") return "Annullata dal Reseller";
    if (s.cancelled_by_role === "super_admin") return "Annullata dall'Admin";
    if (s.cancelled_by_role === "user") return "Annullata dal Cliente";
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="label-caps text-orange-600 mb-1">Log Operativo</div>
          <h1 className="text-4xl font-black tracking-tighter text-slate-900" style={{ fontFamily: "Chivo" }}>Spedizioni</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={load} disabled={loading} className="rounded-sm h-11"><ArrowClockwise size={16} className={`mr-2 ${loading ? "animate-spin" : ""}`} /> Aggiorna Tracking</Button>
          <Button variant="outline" onClick={exportXlsx} className="rounded-sm h-11"><DownloadSimple size={16} className="mr-2" /> Excel</Button>
          <Link to="/shipments/new" className="inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-4 h-11 rounded-sm font-semibold"><Package size={16} weight="fill" /> Nuova</Link>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative max-w-md flex-1">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={isResellerOrAdmin ? "Cerca tracking, destinatario, sub-cliente, corriere…" : "Cerca per tracking, destinatario, corriere…"}
            className="pl-9 h-11 rounded-sm"
          />
        </div>

        {isResellerOrAdmin && (
          <div className="flex gap-1.5 flex-wrap">
            {[
              ["all", "Tutte"],
              ["reseller", "Dirette Reseller"],
              ["subclients", "Sub-Clienti"],
            ].map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setOriginFilter(k)}
                className={`text-xs px-3 h-10 rounded-sm font-semibold border transition-colors ${
                  originFilter === k
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left label-caps">
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Tracking</th>
                <th className="px-4 py-3">Corriere</th>
                {isResellerOrAdmin && <th className="px-4 py-3">Origine</th>}
                <th className="px-4 py-3">Destinatario</th>
                <th className="px-4 py-3">Città</th>
                <th className="px-4 py-3">Naz.</th>
                {isResellerOrAdmin && <th className="px-4 py-3 text-right">Tuo Costo</th>}
                <th className="px-4 py-3 text-right">{isResellerOrAdmin ? "Prezzo Cliente" : "Prezzo"}</th>
                {isResellerOrAdmin && <th className="px-4 py-3 text-right">Margine</th>}
                <th className="px-4 py-3">Stato</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const isClientShip = s.created_by_role === "user";
                const resellerCost = Number(s.reseller_cost ?? s.cost ?? 0);
                const clientPrice = Number(s.price ?? 0);
                const margin = isClientShip ? Math.round((clientPrice - resellerCost) * 100) / 100 : 0;
                const cancelNote = cancelledByText(s);

                return (
                  <tr key={s.id} className={`border-b border-slate-100 hover:bg-slate-50/60 ${i % 2 === 0 ? "" : "bg-slate-50/40"}`}>
                    <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{s.created_at?.slice(0, 10)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                      <Link to={`/shipments/${s.id}`} className="text-orange-600 font-semibold hover:underline">{s.tracking_number}</Link>
                    </td>
                    <td className="px-4 py-2.5 font-semibold">{s.carrier_name}</td>
                    {isResellerOrAdmin && (
                      <td className="px-4 py-2.5 text-xs">
                        {isClientShip ? (
                          <span className="inline-block bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded-sm font-semibold">
                            Sub-cliente: {s.user_company_name || "Cliente"}
                          </span>
                        ) : (
                          <span className="inline-block bg-slate-100 text-slate-700 px-2 py-0.5 rounded-sm font-semibold">
                            Diretta Reseller
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2.5">{s.recipient?.company_name}</td>
                    <td className="px-4 py-2.5">{s.recipient?.city}</td>
                    <td className="px-4 py-2.5 font-mono">{s.recipient?.country}</td>
                    {isResellerOrAdmin && (
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600 whitespace-nowrap">
                        € {resellerCost.toFixed(2)}
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">€ {clientPrice.toFixed(2)}</td>
                    {isResellerOrAdmin && (
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-bold whitespace-nowrap">
                        {isClientShip && s.status !== "cancelled" ? (
                          <span className={margin >= 0 ? "text-green-700" : "text-red-600"}>
                            {margin >= 0 ? `+ € ${margin.toFixed(2)}` : `- € ${Math.abs(margin).toFixed(2)}`}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={s.status} />
                        {cancelNote && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm ${
                            s.cancelled_by_role === "reseller_admin"
                              ? "bg-orange-100 text-orange-800"
                              : "bg-slate-100 text-slate-600"
                          }`}>
                            {cancelNote}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => label(s)} title="Etichetta" className="text-slate-500 hover:text-orange-600">
                        <Printer size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={isResellerOrAdmin ? 12 : 9} className="px-4 py-10 text-center text-slate-500">
                    Nessuna spedizione trovata.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
