import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Buildings, Plus, Receipt, Gear } from "@phosphor-icons/react";

const FEATURE_KEYS = [
  ["customs", "Dogana"], ["insurance", "Assicurazione"], ["prepaid", "Prepagato"],
  ["manifests", "Manifest"], ["address_book", "Rubrica"], ["parcels", "I miei pacchi"],
  ["broadcasts", "Comunicazioni"], ["premium_own_carriers", "Codici corriere propri (Premium)"],
];
const CARRIERS = ["brt", "gls", "dhl", "ups", "tnt", "poste"];

export default function SuperAdmin() {
  const { logout } = useAuth();
  const [resellers, setResellers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [billing, setBilling] = useState(null);
  const empty = { company_name: "", admin_email: "", admin_password: "", plan: "basic",
    features: Object.fromEntries(FEATURE_KEYS.map(([k]) => [k, true])),
    carrier_credentials: {}, per_shipment_fee: 0.15, active: true };
  const [form, setForm] = useState(empty);

  const load = () => { api.get("/super/resellers").then(r => setResellers(r.data)); };
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      if (editing) await api.patch(`/super/resellers/${editing.id}`, form);
      else { const r = await api.post("/super/resellers", form); toast.success(`Reseller creato — pw: ${r.data.admin_credentials.password}`); }
      setOpen(false); load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Errore"); }
  };
  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (r) => { setEditing(r); setForm({ ...empty, ...r, admin_email: r.admin_email, admin_password: "" }); setOpen(true); };
  const showBilling = async (r) => { const resp = await api.get(`/super/resellers/${r.id}/billing`); setBilling(resp.data); };

  return (
    <div className="min-h-screen bg-slate-50 p-6 lg:p-10 max-w-6xl mx-auto">
      <header className="flex items-end justify-between mb-8">
        <div>
          <div className="label-caps text-orange-600 mb-1 flex items-center gap-2"><Gear size={14} weight="fill" /> Super Admin</div>
          <h1 className="text-4xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>Gestione Reseller</h1>
        </div>
        <div className="flex gap-2">
          <Button onClick={startNew} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11"><Plus size={16} className="mr-2" /> Nuovo Reseller</Button>
          <Button variant="outline" onClick={logout} className="rounded-sm h-11">Esci</Button>
        </div>
      </header>
      <div className="grid gap-4">
        {resellers.map(r => (
          <div key={r.id} className="bg-white border border-slate-200 rounded-sm p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-slate-900 text-white rounded-sm flex items-center justify-center"><Buildings size={22} weight="fill" /></div>
                <div>
                  <div className="font-black text-xl" style={{ fontFamily: "Chivo" }}>{r.company_name}</div>
                  <div className="text-xs text-slate-500">{r.admin_email} · piano <b className="uppercase">{r.plan}</b> · {r.active ? "attivo" : "sospeso"}</div>
                  <div className="text-xs text-slate-500 mt-1">{r.user_count} clienti · {r.shipment_count} spedizioni</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => showBilling(r)} className="rounded-sm"><Receipt size={14} className="mr-1" /> Fatturazione</Button>
                <Button variant="outline" size="sm" onClick={() => startEdit(r)} className="rounded-sm">Modifica</Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl rounded-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle style={{ fontFamily: "Chivo" }}>{editing ? "Modifica" : "Nuovo"} Reseller</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className="label-caps">Ragione Sociale</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} className="mt-1 rounded-sm h-10" /></div>
              <div><Label className="label-caps">Email Admin Reseller</Label><Input type="email" disabled={!!editing} value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} className="mt-1 rounded-sm h-10" /></div>
              {!editing && <div><Label className="label-caps">Password</Label><Input value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} className="mt-1 rounded-sm h-10" /></div>}
              <div><Label className="label-caps">Piano</Label>
                <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v })}><SelectTrigger className="mt-1 rounded-sm h-10"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="basic">Basic</SelectItem><SelectItem value="full">Full</SelectItem><SelectItem value="premium">Premium</SelectItem></SelectContent></Select>
              </div>
              <div><Label className="label-caps">Fee codici propri (€)</Label><Input type="number" step="0.01" value={form.per_shipment_fee} onChange={(e) => setForm({ ...form, per_shipment_fee: parseFloat(e.target.value) || 0 })} className="mt-1 rounded-sm h-10" /></div>
            </div>
            <div><div className="label-caps mb-2">Funzionalità abilitate</div>
              <div className="grid grid-cols-2 gap-2">
                {FEATURE_KEYS.map(([k, l]) => (<label key={k} className="flex items-center gap-2 cursor-pointer text-sm"><Checkbox checked={form.features[k] !== false} onCheckedChange={(v) => setForm({ ...form, features: { ...form.features, [k]: !!v } })} />{l}</label>))}
              </div>
            </div>
            <div><div className="label-caps mb-2">Codici corriere</div>
              <div className="space-y-2">
                {CARRIERS.map(c => {
                  const cc = form.carrier_credentials?.[c] || {};
                  const upd = (k, v) => setForm({ ...form, carrier_credentials: { ...(form.carrier_credentials || {}), [c]: { ...cc, [k]: v } } });
                  return (<div key={c} className="grid grid-cols-4 gap-2 items-center"><div className="font-semibold uppercase text-sm">{c}</div><Input placeholder="Account" value={cc.account || ""} onChange={(e) => upd("account", e.target.value)} className="rounded-sm h-9 text-xs" /><Input placeholder="Password" value={cc.password || ""} onChange={(e) => upd("password", e.target.value)} className="rounded-sm h-9 text-xs" /><Input placeholder="Codice" value={cc.code || ""} onChange={(e) => upd("code", e.target.value)} className="rounded-sm h-9 text-xs" /></div>);
                })}
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer"><Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: !!v })} /><span className="text-sm font-semibold">Attivo</span></label>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Annulla</Button><Button onClick={save} className="bg-orange-600 hover:bg-orange-700 rounded-sm">Salva</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!billing} onOpenChange={(o) => !o && setBilling(null)}>
        <DialogContent className="rounded-sm max-w-md">
          {billing && (
            <><DialogHeader><DialogTitle style={{ fontFamily: "Chivo" }}>Fatturazione {billing.reseller.company_name}</DialogTitle></DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b"><span>Spedizioni codici master</span><b>{billing.shipments_on_master}</b></div>
                <div className="flex justify-between py-2 border-b"><span>Costo spedizioni (standard)</span><b>€ {billing.amount_due_standard.toFixed(2)}</b></div>
                <div className="flex justify-between py-2 border-b"><span>Spedizioni codici propri</span><b>{billing.shipments_on_own}</b></div>
                <div className="flex justify-between py-2 border-b"><span>Fee premium</span><b>€ {billing.amount_due_premium.toFixed(2)}</b></div>
                <div className="flex justify-between py-3 border-t-2 border-slate-900 text-lg"><span className="font-black">Totale dovuto</span><b className="text-orange-600">€ {billing.amount_due_total.toFixed(2)}</b></div>
              </div></>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
