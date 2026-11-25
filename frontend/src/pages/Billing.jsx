import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DownloadSimple, Wallet, Receipt } from "@phosphor-icons/react";

export default function Billing() {
  const { user } = useAuth();
  const isSubClient = user?.role === "user";
  const [invs, setInvs] = useState([]);
  const [bal, setBal] = useState(null);

  useEffect(() => {
    api.get("/invoices").then(r => setInvs(r.data)).catch(() => {});
    if (isSubClient && user?.billing_type === "prepaid") {
      api.get("/wallet/balance").then(r => setBal(r.data)).catch(() => {});
    }
  }, [user, isSubClient]);

  const downloadPdf = async (inv) => {
    const r = await api.get(`/invoices/${inv.id}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a"); a.href = url; a.download = `${inv.invoice_number}.pdf`; a.click(); URL.revokeObjectURL(url);
  };

  const ledgerLabel = (l) => {
    if (l.note) return l.note;
    if (l.type === "reseller_topup") return "Accredito da Agenzia";
    if (l.type === "reseller_adjustment") return "Rettifica da Agenzia";
    if (l.type === "topup") return "Ricarica Online";
    if (l.type === "shipment_refund") return "Rimborso Annullamento";
    return "Addebito Spedizione";
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="label-caps text-orange-600 mb-1">Amministrazione</div>
        <h1 className="text-4xl font-black tracking-tighter text-slate-900" style={{ fontFamily: "Chivo" }}>Fatturazione</h1>
      </div>

      {isSubClient && user?.billing_type === "prepaid" && (
        <div className="bg-slate-900 text-white rounded-sm p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="label-caps text-slate-400 mb-1">Modalità Prepagato · Credito residuo</div>
            <div className="text-5xl font-black tracking-tighter text-orange-400" style={{ fontFamily: "Chivo" }}>
              € {(bal?.balance ?? user?.credit_balance ?? 0).toFixed(2)}
            </div>
          </div>
          <Link to="/topup" className="inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-700 px-5 h-11 rounded-sm font-semibold">
            <Wallet size={18} weight="fill" /> Ricarica Credito
          </Link>
        </div>
      )}

      {isSubClient && user?.billing_type === "prepaid" && bal?.ledger?.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-sm">
          <div className="px-5 py-4 border-b border-slate-200"><h2 className="text-lg font-bold tracking-tight" style={{ fontFamily: "Chivo" }}>Storico Movimenti Credito</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left label-caps"><th className="px-5 py-3">Data</th><th className="px-5 py-3">Causale / Dettaglio</th><th className="px-5 py-3 text-right">Importo</th></tr>
              </thead>
              <tbody>
                {bal.ledger.map(l => (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="px-5 py-2.5 text-xs font-mono text-slate-500">{l.created_at?.slice(0, 19).replace("T", " ")}</td>
                    <td className="px-5 py-2.5 font-semibold">{ledgerLabel(l)}</td>
                    <td className={`px-5 py-2.5 text-right font-mono font-bold ${l.amount > 0 ? "text-green-600" : "text-slate-900"}`}>
                      {l.amount > 0 ? "+" : ""}€ {Number(l.amount || 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-sm">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
          <Receipt size={20} weight="fill" className="text-slate-700" />
          <h2 className="text-lg font-bold tracking-tight" style={{ fontFamily: "Chivo" }}>Fatture</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left label-caps">
                <th className="px-5 py-3">Numero</th><th className="px-5 py-3">Data</th><th className="px-5 py-3">Spedizioni</th>
                <th className="px-5 py-3 text-right">Imponibile</th><th className="px-5 py-3 text-right">Totale</th><th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {invs.map(inv => (
                <tr key={inv.id} className="border-b border-slate-100">
                  <td className="px-5 py-2.5 font-mono font-semibold">{inv.invoice_number}</td>
                  <td className="px-5 py-2.5 text-xs">{inv.created_at?.slice(0, 10)}</td>
                  <td className="px-5 py-2.5">{inv.shipment_ids.length}</td>
                  <td className="px-5 py-2.5 text-right">€ {inv.total.toFixed(2)}</td>
                  <td className="px-5 py-2.5 text-right font-bold">€ {inv.grand_total.toFixed(2)}</td>
                  <td className="px-5 py-2.5 text-right">
                    <Button variant="outline" size="sm" onClick={() => downloadPdf(inv)} className="rounded-sm"><DownloadSimple size={14} className="mr-1" /> PDF</Button>
                  </td>
                </tr>
              ))}
              {invs.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">Nessuna fattura ancora emessa.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
