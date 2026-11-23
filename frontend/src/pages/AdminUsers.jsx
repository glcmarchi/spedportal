import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle, Prohibit, FileText } from "@phosphor-icons/react";

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [rates, setRates] = useState([]);

  const load = () => {
    api.get("/admin/users").then(r => setUsers(r.data));
    api.get("/admin/rate-tables").then(r => setRates(r.data));
  };
  useEffect(load, []);

  const update = async (id, patch) => {
    try { await api.patch(`/admin/users/${id}`, patch); toast.success("Utente aggiornato"); load(); }
    catch (err) { toast.error(err?.response?.data?.detail || "Errore"); }
  };
  const generate = async (id) => {
    try { const r = await api.post(`/admin/invoices/generate/${id}`); toast.success(`Fattura ${r.data.invoice_number} creata`); }
    catch (err) { toast.error(err?.response?.data?.detail || "Errore"); }
  };

  return (
    <div className="space-y-6">
      <div><div className="label-caps text-orange-600 mb-1">Admin</div><h1 className="text-4xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>Gestione Clienti</h1></div>
      <div className="bg-white border border-slate-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left label-caps"><th className="px-4 py-3">Azienda</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Stato</th><th className="px-4 py-3">Modalità</th><th className="px-4 py-3">Listino</th><th className="px-4 py-3 text-right">Saldo</th><th className="px-4 py-3">Azioni</th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-slate-100">
                  <td className="px-4 py-3 font-semibold">{u.company_name}</td><td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 text-xs rounded-sm border font-semibold">{u.status}</span></td>
                  <td className="px-4 py-3">
                    <Select value={u.billing_type} onValueChange={(v) => update(u.id, { billing_type: v })}>
                      <SelectTrigger className="h-8 rounded-sm text-xs w-32"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="postpaid">Fine mese</SelectItem><SelectItem value="prepaid">Prepagato</SelectItem></SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <Select value={u.rate_table_id || "none"} onValueChange={(v) => update(u.id, { rate_table_id: v === "none" ? null : v })}>
                      <SelectTrigger className="h-8 rounded-sm text-xs w-40"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="none">Nessuno (20% def.)</SelectItem>{rates.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold">€ {(u.credit_balance || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 flex gap-1">
                    {u.status !== "approved" && <Button size="sm" onClick={() => update(u.id, { status: "approved" })} className="bg-green-600 hover:bg-green-700 rounded-sm h-8"><CheckCircle size={14} weight="fill" /></Button>}
                    {u.status !== "rejected" && <Button size="sm" variant="outline" onClick={() => update(u.id, { status: "rejected" })} className="rounded-sm h-8"><Prohibit size={14} /></Button>}
                    {u.billing_type === "postpaid" && <Button size="sm" variant="outline" onClick={() => generate(u.id)} className="rounded-sm h-8"><FileText size={14} /></Button>}
                  </td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-slate-500">Nessun cliente.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
