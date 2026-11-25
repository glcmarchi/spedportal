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
import { Buildings, Plus, Receipt, Gear, Key, CheckCircle, WarningCircle, ShieldCheck, Wallet } from "@phosphor-icons/react";

const FEATURE_KEYS = [
  ["address_book", "Rubrica"],
  ["manifests", "Manifest"],
  ["parcels", "I miei pacchi"],
  ["sub_clients", "Gestione Sub-Clienti (B2B2B)"],
  ["rate_tables", "Listini Clienti"],
  ["broadcasts", "Comunicazioni Clienti"],
  ["client_prepaid", "Prepagato Sub-Clienti"],
  ["client_billing", "Fatturazione Clienti"],
];

const SURCHARGE_KEYS = [
  ["insurance", "Assicurazione"],
  ["cod", "Contrassegno (COD)"],
  ["saturday_delivery", "Consegna al Sabato"],
  ["neutral_delivery", "Consegna Neutra"],
  ["residential_delivery", "Indirizzo Privato / Residenziale"],
];

const PLAN_PRESETS = {
  basic: {
    address_book: true, manifests: true, parcels: false,
    sub_clients: false, rate_tables: false, broadcasts: false,
    client_prepaid: false, client_billing: false,
  },
  full: {
    address_book: true, manifests: true, parcels: true,
    sub_clients: false, rate_tables: false, broadcasts: false,
    client_prepaid: false, client_billing: false,
  },
  premium: {
    address_book: true, manifests: true, parcels: true,
    sub_clients: true, rate_tables: true, broadcasts: true,
    client_prepaid: true, client_billing: true,
  },
};

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
  const [masterMarkups, setMasterMarkups] = useState({});
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [billing, setBilling] = useState(null);
  const [topupTarget, setTopupTarget] = useState(null);
  const [topupAmount, setTopupAmount] = useState("250");
  const [topupNote, setTopupNote] = useState("");

  const empty = {
    company_name: "", admin_email: "", admin_password: "",
    address: "", postal_code: "", city: "", province: "", country: "IT", phone: "",
    plan: "basic",
    billing_type: "prepaid",
    allow_ddp: false,
    features: { ...PLAN_PRESETS.basic },
    enabled_surcharges: Object.fromEntries(SURCHARGE_KEYS.map(([k]) => [k, true])),
    carrier_policies: Object.fromEntries(CARRIERS.map(c => [c, "admin_only"])),
    admin_carrier_markups: {},
    per_shipment_fee: 0.15, active: true,
  };
  const [form, setForm] = useState(empty);

  const load = () => {
    api.get("/super/resellers").then(r => setResellers(r.data));
    api.get("/super/master-carriers").then(r => {
      setMasterData(r.data);
      const drafts = {};
      const mks = {};
      Object.keys(r.data.schemas || {}).forEach(cid => {
        drafts[cid] = { ...(r.data.carriers?.[cid]?.values || {}) };
        mks[cid] = r.data.carriers?.[cid]?.default_markup_percent ?? 5;
      });
      setMasterDrafts(drafts);
      setMasterMarkups(mks);
    });
  };
  useEffect(() => { load(); }, []);

  const lookupCap = async (cap) => {
    if (!cap) return;
    try {
      const r = await api.get(`/geo/lookup?country=${form.country || "IT"}&cap=${encodeURIComponent(cap)}`);
      if (r.data.city || r.data.province) {
        setForm(f => ({ ...f, city: r.data.city || f.city, province: r.data.province || f.province }));
      }
    } catch {}
  };

  const handlePlanChange = (newPlan) => {
    const preset = PLAN_PRESETS[newPlan] || PLAN_PRESETS.basic;
    setForm({ ...form, plan: newPlan, features: { ...preset } });
  };

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

  const submitTopup = async () => {
    if (!topupTarget) return;
    try {
      await api.post(`/super/resellers/${topupTarget.id}/topup`, {
        amount: parseFloat(topupAmount) || 0,
        note: topupNote,
      });
      toast.success("Saldo Reseller aggiornato");
      setTopupTarget(null);
      setTopupNote("");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore accredito");
    }
  };

  const saveMasterCarrier = async (cid) => {
    try {
      await api.put(`/super/master-carriers/${cid}`, {
        values: masterDrafts[cid] || {},
        default_markup_percent: parseFloat(masterMarkups[cid]) || 0,
      });
      toast.success(`Configurazione e margine ${masterData.schemas[cid]?.name} salvati`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore salvataggio corriere");
    }
  };

  const authMasterCarrier = async (cid) => {
    try {
      await api.put(`/super/master-carriers/${cid}`, {
        values: masterDrafts[cid] || {},
        default_markup_percent: parseFloat(masterMarkups[cid]) || 0,
      });
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
      allow_ddp: !!r.allow_ddp,
      features: { ...empty.features, ...(r.features || {}) },
      enabled_surcharges: { ...empty.enabled_surcharges, ...(r.enabled_surcharges || {}) },
      carrier_policies: { ...empty.carrier_policies, ...(r.carrier_policies || {}) },
      admin_carrier_markups: { ...(r.admin_carrier_markups || {}) },
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
            const customMk = r.admin_carrier_markups || {};
            const isPre = (r.billing_type || "prepaid") === "prepaid";
            return (
              <div key={r.id} className="bg-white border border-slate-200 rounded-sm p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-900 text-white rounded-sm flex items-center justify-center"><Buildings size={22} weight="fill" /></div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-xl" style={{ fontFamily: "Chivo" }}>{r.company_name}</span>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm bg-slate-900 text-white">{r.plan}</span>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm ${isPre ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                          {isPre ? `Prepagato · € ${Number(r.credit_balance || 0).toFixed(2)}` : "Fatturazione Fine Mese"}
                        </span>
                        {r.allow_ddp && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm bg-red-100 text-red-800">DDP Attivo</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {r.admin_email} {r.city && `· ${r.city} (${r.province})`} · sub-clienti: <b>{r.user_count}</b> · fee codici propri: <b>€ {Number(r.per_shipment_fee || 0).toFixed(2)}/sped</b>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {CARRIERS.map(c => {
                          const p = pols[c] || "admin_only";
                          const defMk = masterData.carriers?.[c]?.default_markup_percent ?? 0;
                          const effMk = customMk[c] !== undefined && customMk[c] !== null ? customMk[c] : defMk;
                          const badge = p === "reseller_only" ? "bg-blue-100 text-blue-800" : p === "disabled" ? "bg-slate-100 text-slate-400 line-through" : "bg-orange-100 text-orange-800";
                          const label = p === "reseller_only" ? "Reseller" : p === "disabled" ? "Off" : `Admin (+${effMk}%)`;
                          return <span key={c} className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm ${badge}`}>{c}: {label}</span>;
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {isPre && (
                      <Button variant="outline" size="sm" onClick={() => { setTopupTarget(r); setTopupAmount("250"); }} className="rounded-sm border-green-200 text-green-700 hover:bg-green-50">
                        <Wallet size={14} className="mr-1" /> Ricarica Saldo
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => showBilling(r)} className="rounded-sm"><Receipt size={14} className="mr-1" /> Contabilità</Button>
                    <Button variant="outline" size="sm" onClick={() => startEdit(r)} className="rounded-sm">Configura</Button>
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
                  <div className="sm:col-span-2 bg-orange-50/60 border border-orange-200 p-2.5 rounded-sm flex items-center justify-between gap-3">
                    <div>
                      <div className="label-caps text-orange-800">Margine Admin Default (%)</div>
                      <div className="text-[11px] text-slate-600">Ricarico applicato ai Reseller che usano questo codice</div>
                    </div>
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      value={masterMarkups[cid] ?? 5}
                      onChange={(e) => setMasterMarkups({ ...masterMarkups, [cid]: e.target.value })}
                      className="w-24 rounded-sm h-9 text-xs font-bold text-right bg-white"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  {schema.auth_type === "account_link" ? (
                    <Button onClick={() => authMasterCarrier(cid)} className="bg-slate-900 hover:bg-slate-800 rounded-sm h-9 text-xs">
                      <ShieldCheck size={15} className="mr-1.5" /> Salva & Autentica Account
                    </Button>
                  ) : (
                    <Button onClick={() => saveMasterCarrier(cid)} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-9 text-xs">
                      Salva Codice & Margine
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* DIALOG RICARICA SALDO RESELLER */}
      <Dialog open={!!topupTarget} onOpenChange={(o) => !o && setTopupTarget(null)}>
        <DialogContent className="max-w-md rounded-sm">
          {topupTarget && (
            <>
              <DialogHeader><DialogTitle style={{ fontFamily: "Chivo" }}>Accredita Credito — {topupTarget.company_name}</DialogTitle></DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="bg-slate-50 p-3 rounded-sm border">
                  Saldo attuale: <b>€ {Number(topupTarget.credit_balance || 0).toFixed(2)}</b>
                </div>
                <div>
                  <Label className="label-caps">Importo da accreditare (€)</Label>
                  <Input type="number" step="10" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} className="mt-1 rounded-sm h-10" />
                </div>
                <div>
                  <Label className="label-caps">Causale / Riferimento Bonifico</Label>
                  <Input placeholder="Es. Bonifico CRO 123456" value={topupNote} onChange={(e) => setTopupNote(e.target.value)} className="mt-1 rounded-sm h-10" />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setTopupTarget(null)} className="rounded-sm">Annulla</Button>
                  <Button onClick={submitTopup} className="bg-green-600 hover:bg-green-700 rounded-sm">Conferma Accredito</Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* DIALOG MODIFICA RESELLER */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl rounded-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle style={{ fontFamily: "Chivo" }}>{editing ? "Configura" : "Nuovo"} Reseller</DialogTitle></DialogHeader>
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className="label-caps">Ragione Sociale*</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} className="mt-1 rounded-sm h-10" /></div>
              <div><Label className="label-caps">Email Admin Reseller*</Label><Input type="email" disabled={!!editing} value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} className="mt-1 rounded-sm h-10" /></div>
              {!editing && <div><Label className="label-caps">Password*</Label><Input value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} className="mt-1 rounded-sm h-10" /></div>}
              <div>
                <Label className="label-caps">Pacchetto Commerciale</Label>
                <Select value={form.plan} onValueChange={handlePlanChange}>
                  <SelectTrigger className="mt-1 rounded-sm h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Basic (Essenziale: Rubrica + Manifest)</SelectItem>
                    <SelectItem value="full">Full (Basic + I miei pacchi)</SelectItem>
                    <SelectItem value="premium">Premium B2B2B (Sub-Clienti + Listini + Fatture)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="label-caps">Pagamento verso Piattaforma</Label>
                <Select value={form.billing_type} onValueChange={(v) => setForm({ ...form, billing_type: v })}>
                  <SelectTrigger className="mt-1 rounded-sm h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prepaid">Prepagato (Wallet Reseller)</SelectItem>
                    <SelectItem value="postpaid">Fatturazione Fine Mese</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="label-caps">Fee per lettera di vettura su codici Reseller (€)</Label><Input type="number" step="0.01" min="0" value={form.per_shipment_fee} onChange={(e) => setForm({ ...form, per_shipment_fee: parseFloat(e.target.value) || 0 })} className="mt-1 rounded-sm h-10" /></div>
            </div>

            <div className="border-t pt-4">
              <div className="label-caps text-slate-900 mb-2">Indirizzo Sede Reseller (per compilazione rapida Mittente)</div>
              <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
                <div className="sm:col-span-6"><Label className="label-caps">Indirizzo</Label><Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1 rounded-sm h-9 text-xs" placeholder="Via Roma 10" /></div>
                <div className="sm:col-span-1"><Label className="label-caps">Naz.</Label><Input maxLength={2} value={form.country || "IT"} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} className="mt-1 rounded-sm h-9 text-xs" /></div>
                <div className="sm:col-span-1"><Label className="label-caps">CAP</Label><Input value={form.postal_code || ""} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} onBlur={(e) => lookupCap(e.target.value)} className="mt-1 rounded-sm h-9 text-xs" /></div>
                <div className="sm:col-span-2"><Label className="label-caps">Città</Label><Input value={form.city || ""} onChange={(e) => setForm({ ...form, city: e.target.value })} className="mt-1 rounded-sm h-9 text-xs" /></div>
                <div className="sm:col-span-1"><Label className="label-caps">Prov.</Label><Input maxLength={2} value={form.province || ""} onChange={(e) => setForm({ ...form, province: e.target.value.toUpperCase() })} className="mt-1 rounded-sm h-9 text-xs" /></div>
                <div className="sm:col-span-1"><Label className="label-caps">Tel.</Label><Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 rounded-sm h-9 text-xs" /></div>
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="label-caps text-orange-600 mb-1">Assegnazione Codici Corrieri & Margine Admin</div>
              <p className="text-xs text-slate-500 mb-3">
                Se imposti <b>Codice Reseller (Proprio)</b>, il Reseller inserirà il suo contratto e vedrà i suoi costi netti (tu incassi la fee fissa).
              </p>
              <div className="space-y-2">
                {CARRIERS.map(cid => {
                  const pol = form.carrier_policies?.[cid] || "admin_only";
                  const defMk = masterData.carriers?.[cid]?.default_markup_percent ?? 5;
                  const customVal = form.admin_carrier_markups?.[cid];
                  return (
                    <div key={cid} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-slate-50 p-2.5 rounded-sm border border-slate-200">
                      <div className="sm:col-span-3 font-bold text-sm uppercase">{masterData.schemas?.[cid]?.name || cid}</div>
                      <div className="sm:col-span-5">
                        <Select
                          value={pol}
                          onValueChange={(v) => setForm({ ...form, carrier_policies: { ...(form.carrier_policies || {}), [cid]: v } })}
                        >
                          <SelectTrigger className="h-9 rounded-sm bg-white text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {POLICY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="sm:col-span-4">
                        {pol === "admin_only" ? (
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              step="0.5"
                              min="0"
                              placeholder={`Default ${defMk}%`}
                              value={customVal !== undefined && customVal !== null ? customVal : ""}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const next = { ...(form.admin_carrier_markups || {}) };
                                next[cid] = raw === "" ? null : parseFloat(raw);
                                setForm({ ...form, admin_carrier_markups: next });
                              }}
                              className="h-9 rounded-sm bg-white text-xs text-right"
                            />
                            <span className="text-xs text-slate-500 font-semibold">%</span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400 text-right pr-2">
                            {pol === "reseller_only" ? `Fee € ${Number(form.per_shipment_fee || 0).toFixed(2)}` : "Disabilitato"}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-4">
              <div>
                <div className="label-caps mb-2 text-slate-900">Moduli Piattaforma Inclusi</div>
                <div className="space-y-2">
                  {FEATURE_KEYS.map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2 cursor-pointer text-sm">
                      <Checkbox checked={!!form.features[k]} onCheckedChange={(v) => setForm({ ...form, features: { ...form.features, [k]: !!v } })} />{l}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="label-caps mb-2 text-slate-900">Supplementi & Opzioni Doganali</div>
                <div className="space-y-2">
                  {SURCHARGE_KEYS.map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2 cursor-pointer text-sm">
                      <Checkbox checked={form.enabled_surcharges?.[k] !== false} onCheckedChange={(v) => setForm({ ...form, enabled_surcharges: { ...(form.enabled_surcharges || {}), [k]: !!v } })} />{l}
                    </label>
                  ))}
                  <div className="pt-2 mt-2 border-t border-red-200 bg-red-50/60 p-2.5 rounded-sm">
                    <label className="flex items-start gap-2 cursor-pointer text-sm">
                      <Checkbox checked={!!form.allow_ddp} onCheckedChange={(v) => setForm({ ...form, allow_ddp: !!v })} className="mt-0.5" />
                      <div>
                        <div className="font-bold text-red-900 text-xs">Abilita resa doganale DDP (Dazi a carico mittente)</div>
                        <div className="text-[11px] text-red-700">Attenzione: in DDP eventuali dazi e IVA esteri vengono addebitati sul codice pagante del trasporto.</div>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer border-t pt-3"><Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: !!v })} /><span className="text-sm font-semibold">Account Reseller Attivo</span></label>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Annulla</Button><Button onClick={saveReseller} className="bg-orange-600 hover:bg-orange-700 rounded-sm">Salva Configurazione</Button></div>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG REPORT CONTABILITA' & MARGINI */}
      <Dialog open={!!billing} onOpenChange={(o) => !o && setBilling(null)}>
        <DialogContent className="rounded-sm max-w-2xl max-h-[85vh] overflow-y-auto">
          {billing && (
            <>
              <DialogHeader><DialogTitle style={{ fontFamily: "Chivo" }}>Contabilità & Margini — {billing.reseller.company_name}</DialogTitle></DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b"><span>Modalità pagamento</span><b className="uppercase">{billing.reseller.billing_type || "prepaid"}</b></div>
                {(billing.reseller.billing_type || "prepaid") === "prepaid" && (
                  <div className="flex justify-between py-2 border-b bg-green-50 px-2 rounded-sm"><span>Credito residuo nel Wallet</span><b className="text-green-700">€ {Number(billing.reseller.credit_balance || 0).toFixed(2)}</b></div>
                )}
                <div className="flex justify-between py-2 border-b"><span>Spedizioni su codici Admin</span><b>{billing.shipments_on_master}</b></div>
                <div className="flex justify-between py-2 border-b text-slate-500"><span>Costo vivo API corriere (codici Admin)</span><span>€ {(billing.raw_carrier_cost_master ?? billing.amount_due_standard).toFixed(2)}</span></div>
                <div className="flex justify-between py-2 border-b text-green-700"><span>Margine Admin maturato</span><b>+ € {(billing.admin_margin_earned ?? 0).toFixed(2)}</b></div>
                <div className="flex justify-between py-2 border-b"><span>Totale trasporto codici Admin</span><b>€ {billing.amount_due_standard.toFixed(2)}</b></div>
                <div className="flex justify-between py-2 border-b"><span>Fee lettere di vettura su codici Reseller ({billing.shipments_on_own})</span><b>€ {billing.amount_due_premium.toFixed(2)}</b></div>
                <div className="flex justify-between py-3 border-t-2 border-slate-900 text-lg"><span className="font-black">Volume complessivo Admin</span><b className="text-orange-600">€ {billing.amount_due_total.toFixed(2)}</b></div>
              </div>

              {billing.ledger?.length > 0 && (
                <div className="mt-4">
                  <div className="label-caps mb-2">Cronostoria Movimenti Wallet (Ricariche & Addebiti)</div>
                  <div className="border rounded-sm overflow-hidden text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="p-2">Data</th>
                          <th className="p-2">Tipo</th>
                          <th className="p-2">Causale</th>
                          <th className="p-2 text-right">Importo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {billing.ledger.map((m, i) => {
                          const amt = Number(m.amount || 0);
                          return (
                            <tr key={m.id || i} className="border-t">
                              <td className="p-2 font-mono">{(m.created_at || "").replace("T", " ").slice(0, 16)}</td>
                              <td className="p-2 font-semibold">{m.type}</td>
                              <td className="p-2 text-slate-600">{m.note || "-"}</td>
                              <td className={`p-2 text-right font-mono font-bold ${amt >= 0 ? "text-green-700" : "text-red-600"}`}>
                                {amt >= 0 ? `+ € ${amt.toFixed(2)}` : `- € ${Math.abs(amt).toFixed(2)}`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {billing.recent_shipments?.length > 0 && (
                <div className="mt-4">
                  <div className="label-caps mb-2">Dettaglio ultime spedizioni</div>
                  <div className="border rounded-sm overflow-hidden text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="p-2">Tracking</th>
                          <th className="p-2">Corriere</th>
                          <th className="p-2">Titolare</th>
                          <th className="p-2">Codice</th>
                          <th className="p-2 text-right">Costo API</th>
                          <th className="p-2 text-right">Addebito Reseller</th>
                        </tr>
                      </thead>
                      <tbody>
                        {billing.recent_shipments.map(s => {
                          const isAdm = (s.contract_owner || (s.on_master_codes ? "admin" : "reseller")) === "admin";
                          const rawC = s.carrier_cost ?? s.cost ?? 0;
                          const billedR = isAdm ? (s.reseller_cost ?? s.cost ?? 0) : (s.applied_fee ?? billing.reseller.per_shipment_fee ?? 0);
                          return (
                            <tr key={s.id} className="border-t">
                              <td className="p-2 font-mono">{s.tracking_number}</td>
                              <td className="p-2">{s.carrier_name}</td>
                              <td className="p-2">
                                <span className={`px-1.5 py-0.5 rounded-sm font-bold ${isAdm ? "bg-orange-100 text-orange-800" : "bg-blue-100 text-blue-800"}`}>
                                  {isAdm ? `Admin (+${s.admin_markup_percent ?? 0}%)` : "Reseller"}
                                </span>
                              </td>
                              <td className="p-2 font-mono">{s.carrier_code_used || "-"}</td>
                              <td className="p-2 text-right text-slate-500">€ {rawC.toFixed(2)}</td>
                              <td className="p-2 text-right font-semibold">€ {billedR.toFixed(2)}</td>
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
