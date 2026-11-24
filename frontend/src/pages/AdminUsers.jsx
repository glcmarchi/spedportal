import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle, Prohibit, FileText, Plus, Copy } from "@phosphor-icons/react";

export default function AdminUsers() {
  const { user } = useAuth();
  const features = user?.features || {};
  const [users, setUsers] = useState([]);
  const [rates, setRates] = useState([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [form, setForm] = useState({ company_name: "", email: "", password: "", phone: "", billing_type: "postpaid", rate_table_id: "none" });

  const load = () => {
    api.get("/admin/users").then(r => setUsers(r.data));
    api.get("/admin/rate-tables").then(r => setRates(r.data));
  };
  useEffect(load, []);

  const inviteUrl = `${window.location.origin}/register?reseller=${user?.reseller_slug || "demo"}`;

  const copyInvite = () => {
    navigator.clipboard.writeText(inviteUrl);
    toast.success("Link di registrazione copiato!");
  };

  const createClient = async () => {
    try {
      await api.post("/admin/users", {
        ...form,
        rate_table_id: form.rate_table_id === "none" ? null : form.rate_table_id,
      });
      toast.success("Sub-cliente creato e attivo!");
      setOpenCreate(false);
      setForm({ company_name: "", email: "", password: "", phone: "", billing_type: "postpaid", rate_table_id: "none" });
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore creazione cliente");
    }
  };

  const update = async (id, patch) => {
    try { await api.patch(`/admin/users/${id}`, patch); toast.success("Cliente aggiornato"); load(); }
    catch (err) { toast.error(err?.response?.data?.detail || "Errore"); }
  };

  const generate = async (id) => {
    try { const r = await api.post(`/admin/invoices/generate/${id}`); toast.success(`Fattura ${r.data.invoice_number} creata`); }
    catch (err) { toast.error(err?.response?.data?.detail || "Errore"); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="label-caps text-orange-600 mb-1">Gestione Agenzia</div>
          <h1 className="text-4xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>Sub-Clienti</h1>
        </div>
        <Button onClick={() => setOpenCreate(true)} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11">
          <Plus size={16} className="mr-2" /> Nuovo Sub-Cliente
        </Button>
      </div>

      <div className="bg-slate-900 text-white rounded-sm p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs">
          <div className="label-caps text-orange-400">Link registrazione diretta per i tuoi clienti</div>
          <div className="font-mono text-slate-300 mt-1 break-all">{inviteUrl}</div>
        </div>
        <Button size="sm" onClick={copyInvite} className="bg-orange-600 hover:bg-orange-700 rounded-sm shrink-0">
          <Copy size={14} className="mr-1.5" /> Copia Link Invito
        </Button>
      </div>

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
                      <SelectContent>
                        <SelectItem value="postpaid">Fine mese</SelectItem>
                        {features.client_prepaid !== false && <SelectItem value="prepaid">Prepagato</SelectItem>}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <Select value={u.rate_table_id || "none"} onValueChange={(v) => update(u.id, { rate_table_id: v === "none" ? null : v })}>
                      <SelectTrigger className="h-8 rounded-sm text-xs w-40"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="none">Default (+20%)</SelectItem>{rates.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold">€ {(u.credit_balance || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 flex gap-1">
                    {u.status !== "approved" && <Button size="sm" onClick={() => update(u.id, { status: "approved" })} className="bg-green-600 hover:bg-green-700 rounded-sm h-8"><CheckCircle size={14} weight="fill" /></Button>}
                    {u.status !== "rejected" && <Button size="sm" variant="outline" onClick={() => update(u.id, { status: "rejected" })} className="rounded-sm h-8"><Prohibit size={14} /></Button>}
                    {u.billing_type === "postpaid" && features.client_billing && <Button size="sm" variant="outline" onClick={() => generate(u.id)} className="rounded-sm h-8"><FileText size={14} /></Button>}
                  </td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-slate-500">Nessun sub-cliente registrato.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="max-w-lg rounded-sm">
          <DialogHeader><DialogTitle style={{ fontFamily: "Chivo" }}>Crea Nuovo Sub-Cliente</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div><Label className="label-caps">Ragione Sociale*</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} className="mt-1 rounded-sm h-10" /></div>
            <div><Label className="label-caps">Email Accesso*</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 rounded-sm h-10" /></div>
            <div><Label className="label-caps">Password Iniziale*</Label><Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1 rounded-sm h-10" /></div>
            <div><Label className="label-caps">Telefono</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 rounded-sm h-10" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="label-caps">Modalità Pagamento</Label>
                <Select value={form.billing_type} onValueChange={(v) => setForm({ ...form, billing_type: v })}>
                  <SelectTrigger className="mt-1 rounded-sm h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="postpaid">Fine mese</SelectItem>
                    {features.client_prepaid !== false && <SelectItem value="prepaid">Prepagato</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="label-caps">Listino Assegnato</Label>
                <Select value={form.rate_table_id} onValueChange={(v) => setForm({ ...form, rate_table_id: v })}>
                  <SelectTrigger className="mt-1 rounded-sm h-10"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Default (+20%)</SelectItem>{rates.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <Button variant="outline" onClick={() => setOpenCreate(false)} className="rounded-sm">Annulla</Button>
              <Button onClick={createClient} className="bg-orange-600 hover:bg-orange-700 rounded-sm">Crea Cliente</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
