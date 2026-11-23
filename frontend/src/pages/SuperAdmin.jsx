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
import { Buildings, Plus, Receipt, Gear, Key, CheckCircle, WarningCircle, ShieldCheck } from "@phosphor-icons/react";

const FEATURE_KEYS = [
  ["customs", "Dogana"], ["insurance", "Assicurazione"], ["prepaid", "Prepagato"],
  ["manifests", "Manifest"], ["address_book", "Rubrica"], ["parcels", "I miei pacchi"],
  ["broadcasts", "Comunicazioni"], ["premium_own_carriers", "Codici corriere propri"],
];

const CARRIERS = ["brt", "gls", "dhl", "ups", "tnt", "poste"];

const POLICY_OPTIONS = [
  { value: "admin_only", label: "Codice Admin (Master)" },
  { value: "reseller_only", label: "Codice Reseller (Proprio)" },
  { value: "disabled", label: "Disabilitato" },
];

export default function SuperAdmin() {
  const { logout } = useAuth();
  const [tab, setTab] = useState("resellers");
  const [resellers, setResellers] = useState([]);
  const [masterData, setMasterData] = useState({ schemas: {}, carriers: {} });
  const [masterDrafts, setMasterDrafts] = useState({});
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [billing, setBilling] = useState(null);

  const empty = {
    company_name: "", admin_email: "", admin_password: "", plan: "basic",
    features: Object.fromEntries(FEATURE_KEYS.map(([k]) => [k, true])),
    carrier_policies: Object.fromEntries(CARRIERS.map(c => [c, "admin_only"])),
    per_shipment_fee: 0.15, active: true,
  };
  const [form, setForm] = useState(empty);

  const load = () => {
    api.get("/super/resellers").then(r => setResellers(r.data));
    api.get("/super/master-carriers").then(r => {
      setMasterData(r.data);
      const drafts = {};
      Object.keys(r.data.schemas || {}).forEach(cid => {
        drafts[cid] = { ...(r.data.carriers?.[cid]?.values || {}) };
      });
      setMasterDrafts(drafts);
    });
  };
  useEffect(() => { load(); }, []);

  const saveReseller = async () => {
    try {
      if (editing) {
        await api.patch(`/super/resellers/${editing.id}`, form);
        toast.success("Reseller aggiornato");
      } else {
        const r = await api.post("/super/resellers", form);
        toast.success(`Reseller creato — pw: ${r.data.admin_credentials.password}`);
      }
      setOpen(false);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore salvataggio");
    }
  };

  const saveMasterCarrier = async (cid) => {
    try {
      await api.put(`/super/master-carriers/${cid}`, { values: masterDrafts[cid] || {} });
      toast.success(`Configurazione ${masterData.schemas[cid]?.name} salvata`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore salvataggio corriere");
    }
  };

  const authMasterCarrier = async (cid) => {
    try {
      await api.put(`/super/master-carriers/${cid}`, { values: masterDrafts[cid] || {} });
      await api.post(`/super/master-carriers/${cid}/authenticate`);
      toast.success(`Account ${masterData.schemas[cid]?.name} autenticato con successo!`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore autenticazione account");
    }
  };

  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (r) => {
    setEditing(r);
    setForm({
      ...empty,
      ...r,
      carrier_policies: { ...empty.carrier_policies, ...(r.carrier_policies || {}) },
      admin_email: r.admin_email,
      admin_password: "",
    });
    setOpen(true);
  };
  const showBilling = async (r) => {
    const resp = await api.get(`/super/resellers/${r.id}/billing`);
    setBilling(resp.data);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 lg:p-10 max-w-6xl mx-auto">
      <header className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="label-caps text-orange-600 mb-1 flex items-center gap-2"><Gear size={14} weight="fill" /> Super Admin</div>
          <h1 className="text-4xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>Pannello Piattaforma</h1>
        </div>
        <div className="flex gap-2">
          {tab === "resellers" && (
            <Button onClick={startNew} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11"><Plus size={16} className="mr-2" /> Nuovo Reseller</Button>
          )}
          <Button variant="outline" onClick={logout} className="rounded-sm h-11">Esci</Button>
        </div>
      </header>

      <div className="flex gap-2 mb-6 border-b border-slate-200 pb-3">
        <Button variant={tab === "resellers" ? "default" : "outline"} onClick={() => setTab("resellers")}
          className={`rounded-sm ${tab === "resellers" ? "bg-slate-900" : ""}`}>
          <Buildings size={16} className="mr-2" /> Reseller & Permessi
        </Button>
        <Button variant={tab === "master_carriers" ? "default" : "outline"} onClick={() => setTab("master_carriers")}
          className={`rounded-sm ${tab === "master_carriers" ? "bg-slate-900" : ""}`}>
          <Key size={16} className="mr-2" /> I Miei Codici Corrieri (Master)
        </Button>
      </div>

      {tab === "resellers" && (
        <div className="grid gap-4">
          {resellers.map(r => {
            const pols = r.carrier_policies || {};
            return (
              <div key={r.id} className="bg-white border border-slate-200 rounded-sm p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-900 text-white rounded-sm flex items-center justify-center"><Buildings size={22} weight="fill" /></div>
                    <div>
                      <div className="font-black text-xl" style={{ fontFamily: "Chivo" }}>{r.company_name}</div>
                      <div className="text-xs text-slate-500">{r.admin_email} · piano <b className="uppercase">{r.plan}</b> · fee codici propri: <b>€ {Number(r.per_shipment_fee || 0).toFixed(2)}/sped</b></div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {CARRIERS.map(c => {
                          const p = pols[c] || "admin_only";
                          const badge = p === "reseller_only" ? "bg-blue-100 text-blue-800" : p === "disabled" ? "bg-slate-100 text-slate-400 line-through" : "bg-orange-100 text-orange-800";
                          const label = p === "reseller_only" ? "Reseller" : p === "disabled" ? "Off" : "Admin";
                          return <span key={c} className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm ${badge}`}>{c}: {label}</span>;
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => showBilling(r)} className="rounded-sm"><Receipt size={14} className="mr-1" /> Fatturazione</Button>
                    <Button variant="outline" size="sm" onClick={() => startEdit(r)} className="rounded-sm">Permessi & Modifica</Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "master_carriers" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {CARRIERS.map(cid => {
            const schema = masterData.schemas?.[cid];
            if (!schema) return null;
            const saved = masterData.carriers?.[cid] || {};
            const draft = masterDrafts[cid] || {};
            const isVerified = saved.status === "verified";
            return (
              <div key={cid} className="bg-white border border-slate-200 rounded-sm p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-black text-lg" style={{ fontFamily: "Chivo" }}>{schema.name}</div>
                    <div className="text-xs text-slate-500">
                      {schema.auth_type === "account_link" ? "Autenticazione Account (OAuth / Verifica)" : "Credenziali API dirette"}
                    </div>
                  </div>
                  {isVerified ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold bg-green-100 text-green-800 px-2.5 py-1 rounded-sm">
                      <CheckCircle size={14} weight="fill" /> Attivo ({saved.primary_code})
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-bold bg-amber-100 text-amber-800 px-2.5 py-1 rounded-sm">
                      <WarningCircle size={14} weight="fill" /> Da configurare / autenticare
                    </span>
                  )}
                </div>

                {schema.auth_note && (
                  <div className="text-xs bg-slate-50 border border-slate-200 p-2.5 rounded-sm text-slate-600">{schema.auth_note}</div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {schema.fields.map(f => (
                    <div key={f.key}>
                      <Label className="label-caps">{f.label}{f.required && "*"}</Label>
                      <Input
                        type={f.type === "password" ? "password" : "text"}
                        value={draft[f.key] || ""}
                        onChange={(e) => setMasterDrafts({ ...masterDrafts, [cid]: { ...draft, [f.key]: e.target.value } })}
                        className="mt-1 rounded-sm h-9 text-xs"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  {schema.auth_type === "account_link" ? (
                    <Button onClick={() => authMasterCarrier(cid)} className="bg-slate-900 hover:bg-slate-800 rounded-sm h-9 text-xs">
                      <ShieldCheck size={15} className="mr-1.5" /> Salva & Autentica Account
                    </Button>
                  ) : (
                    <Button onClick={() => saveMasterCarrier(cid)} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-9 text-xs">
                      Salva Codice Master
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* DIALOG MODIFICA RESELLER E PERMESSI PER CORRIERE */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl rounded-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle style={{ fontFamily: "Chivo" }}>{editing ? "Configura" : "Nuovo"} Reseller</DialogTitle></DialogHeader>
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className="label-caps">Ragione Sociale</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} className="mt-1 rounded-sm h-10" /></div>
              <div><Label className="label-caps">Email Admin Reseller</Label><Input type="email" disabled={!!editing} value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} className="mt-1 rounded-sm h-10" /></div>
              {!editing && <div><Label className="label-caps">Password</Label><Input value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} className="mt-1 rounded-sm h-10" /></div>}
              <div><Label className="label-caps">Piano</Label>
                <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v })}><SelectTrigger className="mt-1 rounded-sm h-10"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="basic">Basic</SelectItem><SelectItem value="full">Full</SelectItem><SelectItem value="premium">Premium</SelectItem></SelectContent></Select>
              </div>
              <div><Label className="label-caps">Fee su spedizioni con codice Reseller (€)</Label><Input type="number" step="0.01" value={form.per_shipment_fee} onChange={(e) => setForm({ ...form, per_shipment_fee: parseFloat(e.target.value) || 0 })} className="mt-1 rounded-sm h-10" /></div>
            </div>

            <div className="border-t pt-4">
              <div className="label-caps text-orange-600 mb-1">Assegnazione Codici Corrieri per questo Reseller</div>
              <p className="text-xs text-slate-500 mb-3">Scegli per singolo corriere se il Reseller utilizza il tuo codice Admin (Master) oppure il proprio codice Reseller.</p>
              <div className="space-y-2">
                {CARRIERS.map(cid => (
                  <div key={cid} className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center bg-slate-50 p-2.5 rounded-sm border border-slate-200">
                    <div className="font-bold text-sm uppercase">{masterData.schemas?.[cid]?.name || cid}</div>
                    <Select
                      value={form.carrier_policies?.[cid] || "admin_only"}
                      onValueChange={(v) => setForm({ ...form, carrier_policies: { ...(form.carrier_policies || {}), [cid]: v } })}
                    >
                      <SelectTrigger className="h-9 rounded-sm bg-white text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {POLICY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="label-caps mb-2">Moduli abilitati</div>
              <div className="grid grid-cols-2 gap-2">
                {FEATURE_KEYS.map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox checked={form.features[k] !== false} onCheckedChange={(v) => setForm({ ...form, features: { ...form.features, [k]: !!v } })} />{l}
                  </label>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer"><Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: !!v })} /><span className="text-sm font-semibold">Account Reseller Attivo</span></label>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Annulla</Button><Button onClick={saveReseller} className="bg-orange-600 hover:bg-orange-700 rounded-sm">Salva Configurazione</Button></div>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG REPORT FATTURAZIONE & CODICI USATI */}
      <Dialog open={!!billing} onOpenChange={(o) => !o && setBilling(null)}>
        <DialogContent className="rounded-sm max-w-2xl max-h-[85vh] overflow-y-auto">
          {billing && (
            <>
              <DialogHeader><DialogTitle style={{ fontFamily: "Chivo" }}>Fatturazione & Codici — {billing.reseller.company_name}</DialogTitle></DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b"><span>Spedizioni su codici Admin (da rifatturare)</span><b>{billing.shipments_on_master}</b></div>
                <div className="flex justify-between py-2 border-b"><span>Importo trasporto codici Admin</span><b>€ {billing.amount_due_standard.toFixed(2)}</b></div>
                <div className="flex justify-between py-2 border-b"><span>Spedizioni su codici propri Reseller</span><b>{billing.shipments_on_own}</b></div>
                <div className="flex justify-between py-2 border-b"><span>Fee piattaforma su codici Reseller</span><b>€ {billing.amount_due_premium.toFixed(2)}</b></div>
                <div className="flex justify-between py-3 border-t-2 border-slate-900 text-lg"><span className="font-black">Totale da fatturare</span><b className="text-orange-600">€ {billing.amount_due_total.toFixed(2)}</b></div>
              </div>
              {billing.recent_shipments?.length > 0 && (
                <div className="mt-4">
                  <div className="label-caps mb-2">Dettaglio ultime spedizioni</div>
                  <div className="border rounded-sm overflow-hidden text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="p-2">Tracking</th>
                          <th className="p-2">Corriere</th>
                          <th className="p-2">Titolare Codice</th>
                          <th className="p-2">Codice Usato</th>
                          <th className="p-2 text-right">Costo / Fee</th>
                        </tr>
                      </thead>
                      <tbody>
                        {billing.recent_shipments.map(s => {
                          const isAdm = (s.contract_owner || (s.on_master_codes ? "admin" : "reseller")) === "admin";
                          return (
                            <tr key={s.id} className="border-t">
                              <td className="p-2 font-mono">{s.tracking_number}</td>
                              <td className="p-2">{s.carrier_name}</td>
                              <td className="p-2">
                                <span className={`px-1.5 py-0.5 rounded-sm font-bold ${isAdm ? "bg-orange-100 text-orange-800" : "bg-blue-100 text-blue-800"}`}>
                                  {isAdm ? "Admin" : "Reseller"}
                                </span>
                              </td>
                              <td className="p-2 font-mono">{s.carrier_code_used || "-"}</td>
                              <td className="p-2 text-right font-semibold">
                                € {(isAdm ? (s.cost || 0) : (s.applied_fee ?? billing.reseller.per_shipment_fee ?? 0)).toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
