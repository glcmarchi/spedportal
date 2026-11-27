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
import {
  Buildings, Plus, Receipt, Gear, Key, CheckCircle,
  WarningCircle, ShieldCheck, Wallet, EnvelopeSimple, PaperPlaneTilt, DownloadSimple,
} from "@phosphor-icons/react";

const FEATURE_KEYS = [
  ["address_book", "Rubrica"],
  ["manifests", "Manifest"],
  ["parcels", "I miei pacchi"],
  ["sub_clients", "Gestione Sub-Clienti (B2B2B)"],
  ["rate_tables", "Listini Clienti"],
  ["broadcasts", "Comunicazioni Clienti"],
  ["client_prepaid", "Prepagato Sub-Clienti (solo con Fine Mese)"],
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

const normalizeRule = (raw, fallback = 5) => {
  if (typeof raw === "number") {
    return { mode: "flat", flat: raw, domestic: raw, europe: raw, world: raw };
  }
  if (raw && typeof raw === "object") {
    const flat = Number(raw.flat ?? fallback) || 0;
    return {
      mode: raw.mode === "area" ? "area" : "flat",
      flat,
      domestic: Number(raw.domestic ?? flat) || 0,
      europe: Number(raw.europe ?? flat) || 0,
      world: Number(raw.world ?? flat) || 0,
    };
  }
  return { mode: "flat", flat: fallback, domestic: fallback, europe: fallback, world: fallback };
};

const formatRuleShort = (rule) => {
  if (!rule) return "+5%";
  const r = normalizeRule(rule, 5);
  if (r.mode === "area") {
    return `IT +${r.domestic}% · UE +${r.europe}% · Mondo +${r.world}%`;
  }
  return `+${r.flat}%`;
};

export default function SuperAdmin() {
  const { logout } = useAuth();
  const [tab, setTab] = useState("resellers");
  const [resellers, setResellers] = useState([]);
  const [masterData, setMasterData] = useState({ schemas: {}, carriers: {} });
  const [masterDrafts, setMasterDrafts] = useState({});
  const [masterRules, setMasterRules] = useState({});
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [billing, setBilling] = useState(null);
  const [billingResellerId, setBillingResellerId] = useState(null);
  const [billingFrom, setBillingFrom] = useState("");
  const [billingTo, setBillingTo] = useState("");
  const [billingLoading, setBillingLoading] = useState(false);

  const [topupTarget, setTopupTarget] = useState(null);
  const [topupAmount, setTopupAmount] = useState("250");
  const [topupNote, setTopupNote] = useState("");

  const [superNotifEmail, setSuperNotifEmail] = useState("");
  const [testEmailTo, setTestEmailTo] = useState("");
  const [testingEmail, setTestingEmail] = useState(false);

  const empty = {
    company_name: "", admin_email: "", notification_email: "", admin_password: "",
    address: "", postal_code: "", city: "", province: "", country: "IT", phone: "",
    plan: "basic",
    billing_type: "prepaid",
    allow_ddp: false,
    features: { ...PLAN_PRESETS.basic },
    enabled_surcharges: Object.fromEntries(SURCHARGE_KEYS.map(([k]) => [k, true])),
    carrier_policies: Object.fromEntries(CARRIERS.map(c => [c, "admin_only"])),
    admin_carrier_markups: {},
    fee_on_admin_codes: 0.25,
    per_shipment_fee: 0.15,
    active: true,
  };
  const [form, setForm] = useState(empty);

  const load = () => {
    api.get("/super/resellers").then(r => setResellers(r.data));
    api.get("/super/settings").then(r => {
      const em = r.data?.notification_email || "";
      setSuperNotifEmail(em);
      if (!testEmailTo) setTestEmailTo(em);
    }).catch(() => {});
    api.get("/super/master-carriers").then(r => {
      setMasterData(r.data);
      const drafts = {};
      const rules = {};
      Object.keys(r.data.schemas || {}).forEach(cid => {
        drafts[cid] = { ...(r.data.carriers?.[cid]?.values || {}) };
        rules[cid] = normalizeRule(
          r.data.carriers?.[cid]?.default_markup_rule,
          r.data.carriers?.[cid]?.default_markup_percent ?? 5
        );
      });
      setMasterDrafts(drafts);
      setMasterRules(rules);
    });
  };
  useEffect(() => { load(); }, []);

  const saveSuperNotifEmail = async () => {
    try {
      await api.put("/super/settings", { notification_email: superNotifEmail });
      toast.success("Email notifiche piattaforma salvata");
    } catch {
      toast.error("Errore salvataggio impostazioni");
    }
  };

  const sendTestEmail = async () => {
    if (!testEmailTo) {
      toast.error("Inserisci un indirizzo destinatario per il test");
      return;
    }
    setTestingEmail(true);
    try {
      const r = await api.post("/super/test-email", { to: testEmailTo });
      if (r.data?.ok) {
        toast.success(`Email di test inviata correttamente a ${testEmailTo}!`);
      } else {
        toast.error(`Invio fallito: ${r.data?.error || "Errore sconosciuto"}`, { duration: 9000 });
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore chiamata test email");
    } finally {
      setTestingEmail(false);
    }
  };

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
    const nextFeatures = { ...preset };
    if (form.billing_type !== "postpaid") {
      nextFeatures.client_prepaid = false;
    }
    setForm({ ...form, plan: newPlan, features: nextFeatures });
  };

  const handleBillingTypeChange = (newBilling) => {
    const nextFeatures = { ...form.features };
    if (newBilling !== "postpaid") {
      nextFeatures.client_prepaid = false;
    }
    setForm({ ...form, billing_type: newBilling, features: nextFeatures });
  };

  const saveReseller = async () => {
    try {
      const cleanFeatures = { ...form.features };
      if (form.billing_type !== "postpaid") {
        cleanFeatures.client_prepaid = false;
      }
      const payload = {
        ...form,
        features: cleanFeatures,
        fee_on_admin_codes: parseFloat(form.fee_on_admin_codes) || 0,
        per_shipment_fee: parseFloat(form.per_shipment_fee) || 0,
      };
      if (editing) {
        await api.patch(`/super/resellers/${editing.id}`, payload);
        toast.success("Reseller aggiornato");
      } else {
        const r = await api.post("/super/resellers", payload);
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
      const rule = normalizeRule(masterRules[cid], 5);
      await api.put(`/super/master-carriers/${cid}`, {
        values: masterDrafts[cid] || {},
        default_markup_percent: rule.flat,
        default_markup_rule: rule,
      });
      toast.success(`Configurazione e margini ${masterData.schemas[cid]?.name} salvati`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore salvataggio corriere");
    }
  };

  const authMasterCarrier = async (cid) => {
    try {
      const rule = normalizeRule(masterRules[cid], 5);
      await api.put(`/super/master-carriers/${cid}`, {
        values: masterDrafts[cid] || {},
        default_markup_percent: rule.flat,
        default_markup_rule: rule,
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
    const cleanedMarkups = {};
    CARRIERS.forEach((cid) => {
      const val = r.admin_carrier_markups?.[cid];
      cleanedMarkups[cid] = val !== undefined && val !== null ? normalizeRule(val, 5) : null;
    });
    const bType = r.billing_type || "prepaid";
    const mergedFeatures = { ...empty.features, ...(r.features || {}) };
    if (bType !== "postpaid") {
      mergedFeatures.client_prepaid = false;
    }
    setForm({
      ...empty,
      ...r,
      billing_type: bType,
      fee_on_admin_codes: r.fee_on_admin_codes ?? 0,
      per_shipment_fee: r.per_shipment_fee ?? 0,
      notification_email: r.notification_email || r.admin_email || "",
      allow_ddp: !!r.allow_ddp,
      features: mergedFeatures,
      enabled_surcharges: { ...empty.enabled_surcharges, ...(r.enabled_surcharges || {}) },
      carrier_policies: { ...empty.carrier_policies, ...(r.carrier_policies || {}) },
      admin_carrier_markups: cleanedMarkups,
      admin_email: r.admin_email,
      admin_password: "",
    });
    setOpen(true);
  };

  const loadBillingReport = async (rid, fromDt = billingFrom, toDt = billingTo) => {
    setBillingLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDt) params.set("date_from", fromDt);
      if (toDt) params.set("date_to", toDt);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const resp = await api.get(`/super/resellers/${rid}/billing${qs}`);
      setBilling(resp.data);
    } catch {
      toast.error("Errore caricamento contabilità");
    } finally {
      setBillingLoading(false);
    }
  };

  const showBilling = async (r) => {
    setBillingResellerId(r.id);
    setBillingFrom("");
    setBillingTo("");
    await loadBillingReport(r.id, "", "");
  };

  const exportBillingXlsx = async () => {
    if (!billingResellerId) return;
    try {
      const params = new URLSearchParams();
      if (billingFrom) params.set("date_from", billingFrom);
      if (billingTo) params.set("date_to", billingTo);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const resp = await api.get(`/super/resellers/${billingResellerId}/billing/export${qs}`, { responseType: "blob" });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contabilita-${billing?.reseller?.slug || "reseller"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Report contabile Excel scaricato");
    } catch {
      toast.error("Errore esportazione Excel");
    }
  };

  const updateMasterRule = (cid, patch) => {
    setMasterRules((prev) => ({
      ...prev,
      [cid]: { ...normalizeRule(prev[cid], 5), ...patch },
    }));
  };

  const updateResellerCarrierMarkup = (cid, nextRuleOrNull) => {
    setForm((f) => ({
      ...f,
      admin_carrier_markups: {
        ...(f.admin_carrier_markups || {}),
        [cid]: nextRuleOrNull,
      },
    }));
  };

  const billingBadge = (r) => {
    const bt = r.billing_type || "prepaid";
    if (bt === "prepaid") {
      return {
        cls: "bg-green-100 text-green-800",
        label: `Prepagato · € ${Number(r.credit_balance || 0).toFixed(2)}`,
      };
    }
    if (bt === "instant") {
      return {
        cls: "bg-blue-100 text-blue-800",
        label: "Pagamento Istantaneo (Pay-per-Shipment)",
      };
    }
    return {
      cls: "bg-amber-100 text-amber-800",
      label: "Fatturazione Fine Mese",
    };
  };

  const canEnableClientPrepaid = form.billing_type === "postpaid";

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

      <div className="flex gap-2 mb-6 border-b border-slate-200 pb-3 flex-wrap">
        <Button variant={tab === "resellers" ? "default" : "outline"} onClick={() => setTab("resellers")}
          className={`rounded-sm ${tab === "resellers" ? "bg-slate-900" : ""}`}>
          <Buildings size={16} className="mr-2" /> Reseller & Permessi
        </Button>
        <Button variant={tab === "master_carriers" ? "default" : "outline"} onClick={() => setTab("master_carriers")}
          className={`rounded-sm ${tab === "master_carriers" ? "bg-slate-900" : ""}`}>
          <Key size={16} className="mr-2" /> I Miei Codici Corrieri (Master)
        </Button>
        <Button variant={tab === "settings" ? "default" : "outline"} onClick={() => setTab("settings")}
          className={`rounded-sm ${tab === "settings" ? "bg-slate-900" : ""}`}>
          <EnvelopeSimple size={16} className="mr-2" /> Notifiche & Email
        </Button>
      </div>

      {tab === "settings" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200 rounded-sm p-5 space-y-4">
            <div className="label-caps text-orange-600">Anagrafica Notifiche Super Admin</div>
            <div>
              <Label className="label-caps">Email Ricezione Notifiche Piattaforma</Label>
              <Input
                type="email"
                value={superNotifEmail}
                onChange={(e) => setSuperNotifEmail(e.target.value)}
                placeholder="notifiche@tuodominio.it"
                className="mt-1 rounded-sm h-10"
              />
              <p className="text-xs text-slate-500 mt-1">
                Indirizzo su cui vengono recapitati gli avvisi di sistema e le nuove registrazioni non associate a un reseller specifico.
              </p>
            </div>
            <Button onClick={saveSuperNotifEmail} className="bg-slate-900 hover:bg-slate-800 rounded-sm h-10">
              Salva Email Notifiche
            </Button>
          </div>

          <div className="bg-white border border-slate-200 rounded-sm p-5 space-y-4">
            <div className="label-caps text-orange-600">Verifica Invio Email (Resend API)</div>
            <div>
              <Label className="label-caps">Invia Email di Test a</Label>
              <Input
                type="email"
                value={testEmailTo}
                onChange={(e) => setTestEmailTo(e.target.value)}
                placeholder="tuaemail@esempio.it"
                className="mt-1 rounded-sm h-10"
              />
              <p className="text-xs text-slate-500 mt-1">
                Nota: se su Render usi <code>EMAIL_FROM=SpedPortal &lt;onboarding@resend.dev&gt;</code>, Resend invia solo all'email titolare dell'account Resend finché non verifichi il tuo dominio DNS.
              </p>
            </div>
            <Button onClick={sendTestEmail} disabled={testingEmail} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-10">
              <PaperPlaneTilt size={16} className="mr-2" /> {testingEmail ? "Invio in corso…" : "Invia Email di Test"}
            </Button>
          </div>
        </div>
      )}

      {tab === "resellers" && (
        <div className="grid gap-4">
          {resellers.map(r => {
            const pols = r.carrier_policies || {};
            const customMk = r.admin_carrier_markups || {};
            const isPre = (r.billing_type || "prepaid") === "prepaid";
            const badge = billingBadge(r);
            return (
              <div key={r.id} className="bg-white border border-slate-200 rounded-sm p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-900 text-white rounded-sm flex items-center justify-center"><Buildings size={22} weight="fill" /></div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-xl" style={{ fontFamily: "Chivo" }}>{r.company_name}</span>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm bg-slate-900 text-white">{r.plan}</span>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm ${badge.cls}`}>
                          {badge.label}
                        </span>
                        {r.allow_ddp && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm bg-red-100 text-red-800">DDP Attivo</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Login: <b>{r.admin_email}</b> · Notifiche: <b>{r.notification_email || r.admin_email}</b> {r.city && `· ${r.city} (${r.province})`} · sub-clienti: <b>{r.user_count}</b>
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        Commissione Piattaforma: <b>€ {Number(r.fee_on_admin_codes || 0).toFixed(2)}</b> (su codici Admin) · <b>€ {Number(r.per_shipment_fee || 0).toFixed(2)}</b> (su codici Reseller)
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {CARRIERS.map(c => {
                          const p = pols[c] || "admin_only";
                          const defRule = masterData.carriers?.[c]?.default_markup_rule || masterData.carriers?.[c]?.default_markup_percent || 5;
                          const effRule = customMk[c] !== undefined && customMk[c] !== null ? customMk[c] : defRule;
                          const bCls = p === "reseller_only" ? "bg-blue-100 text-blue-800" : p === "disabled" ? "bg-slate-100 text-slate-400 line-through" : "bg-orange-100 text-orange-800";
                          const label = p === "reseller_only" ? `Reseller (Comm. €${Number(r.per_shipment_fee || 0).toFixed(2)})` : p === "disabled" ? "Off" : `Admin (${formatRuleShort(effRule)} + €${Number(r.fee_on_admin_codes || 0).toFixed(2)})`;
                          return <span key={c} className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm ${bCls}`}>{c}: {label}</span>;
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
            const rule = normalizeRule(masterRules[cid], 5);
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
                  <div className="sm:col-span-2 bg-orange-50/60 border border-orange-200 p-3 rounded-sm space-y-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="label-caps text-orange-800">Margine Admin Default (%)</div>
                      <Select value={rule.mode} onValueChange={(m) => updateMasterRule(cid, { mode: m })}>
                        <SelectTrigger className="w-52 h-8 rounded-sm text-xs bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="flat">Margine unico (tutte le aree)</SelectItem>
                          <SelectItem value="area">Differenziato per Macro-Area</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {rule.mode === "flat" ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-600">Ricarico applicato su Italia, Europa e Mondo</span>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            step="0.5"
                            min="0"
                            value={rule.flat}
                            onChange={(e) => {
                              const v = Math.max(0, parseFloat(e.target.value) || 0);
                              updateMasterRule(cid, { flat: v, domestic: v, europe: v, world: v });
                            }}
                            className="w-24 rounded-sm h-8 text-xs font-bold text-right bg-white"
                          />
                          <span className="text-xs font-bold text-slate-600">%</span>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="label-caps text-[10px]">Italia %</Label>
                          <Input
                            type="number"
                            step="0.5"
                            min="0"
                            value={rule.domestic}
                            onChange={(e) => updateMasterRule(cid, { domestic: Math.max(0, parseFloat(e.target.value) || 0) })}
                            className="mt-0.5 rounded-sm h-8 text-xs font-bold text-right bg-white"
                          />
                        </div>
                        <div>
                          <Label className="label-caps text-[10px]">Europa %</Label>
                          <Input
                            type="number"
                            step="0.5"
                            min="0"
                            value={rule.europe}
                            onChange={(e) => updateMasterRule(cid, { europe: Math.max(0, parseFloat(e.target.value) || 0) })}
                            className="mt-0.5 rounded-sm h-8 text-xs font-bold text-right bg-white"
                          />
                        </div>
                        <div>
                          <Label className="label-caps text-[10px]">Mondo %</Label>
                          <Input
                            type="number"
                            step="0.5"
                            min="0"
                            value={rule.world}
                            onChange={(e) => updateMasterRule(cid, { world: Math.max(0, parseFloat(e.target.value) || 0) })}
                            className="mt-0.5 rounded-sm h-8 text-xs font-bold text-right bg-white"
                          />
                        </div>
                      </div>
                    )}
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
              <div><Label className="label-caps">Email Login Reseller*</Label><Input type="email" disabled={!!editing} value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} className="mt-1 rounded-sm h-10" /></div>
              <div><Label className="label-caps">Email Ricezione Notifiche (Registrazioni / Avvisi)</Label><Input type="email" value={form.notification_email || ""} onChange={(e) => setForm({ ...form, notification_email: e.target.value })} placeholder={form.admin_email || "notifiche@reseller.it"} className="mt-1 rounded-sm h-10" /></div>
              {!editing && <div><Label className="label-caps">Password*</Label><Input value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} className="mt-1 rounded-sm h-10" /></div>}
              <div>
                <Label className="label-caps">Pacchetto Commerciale</Label>
                <Select value={form.plan} onValueChange={handlePlanChange}>
                  <SelectTrigger className="mt-1 rounded-sm h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Basic (Essenziale: Rubrica + Manifest)</SelectItem>
                    <SelectItem value="full">Full (Basic + I miei pacchi)</SelectItem>
                    <SelectItem value="premium">Premium B2B2B (Sub-Clienti + Margini + Fatture)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="label-caps">Pagamento verso Piattaforma</Label>
                <Select value={form.billing_type} onValueChange={handleBillingTypeChange}>
                  <SelectTrigger className="mt-1 rounded-sm h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prepaid">Prepagato (Wallet Reseller)</SelectItem>
                    <SelectItem value="postpaid">Fatturazione Fine Mese</SelectItem>
                    <SelectItem value="instant">Pagamento Istantaneo (Pay-per-Shipment)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="bg-orange-50/60 border border-orange-200 rounded-sm p-3.5 space-y-3">
              <div className="label-caps text-orange-800">Commissioni Piattaforma per Lettera di Vettura (€)</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="label-caps text-xs">Commissione su Codici Admin (Master) (€)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.fee_on_admin_codes}
                    onChange={(e) => setForm({ ...form, fee_on_admin_codes: e.target.value })}
                    className="mt-1 rounded-sm h-10 bg-white font-mono"
                  />
                  <div className="text-[11px] text-slate-500 mt-0.5">Aggiunta ad ogni spedizione emessa sui tuoi codici Master</div>
                </div>
                <div>
                  <Label className="label-caps text-xs">Commissione su Codici Reseller (Propri) (€)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.per_shipment_fee}
                    onChange={(e) => setForm({ ...form, per_shipment_fee: e.target.value })}
                    className="mt-1 rounded-sm h-10 bg-white font-mono"
                  />
                  <div className="text-[11px] text-slate-500 mt-0.5">Aggiunta ad ogni spedizione emessa sui codici propri del Reseller</div>
                </div>
              </div>
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
                Per <b>Codice Admin (Master)</b> puoi lasciare il margine default dei tuoi codici Master oppure personalizzarlo (Unico o per Macro-Area). In aggiunta verrà applicata la rispettiva Commissione Piattaforma impostata sopra.
              </p>
              <div className="space-y-2.5">
                {CARRIERS.map(cid => {
                  const pol = form.carrier_policies?.[cid] || "admin_only";
                  const defRule = normalizeRule(
                    masterData.carriers?.[cid]?.default_markup_rule,
                    masterData.carriers?.[cid]?.default_markup_percent ?? 5
                  );
                  const customVal = form.admin_carrier_markups?.[cid];
                  const hasCustom = customVal !== undefined && customVal !== null;
                  const activeRule = hasCustom ? normalizeRule(customVal, defRule.flat) : defRule;

                  return (
                    <div key={cid} className="bg-slate-50 p-3 rounded-sm border border-slate-200 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
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
                        <div className="sm:col-span-4 flex justify-end">
                          {pol === "admin_only" ? (
                            <Select
                              value={hasCustom ? activeRule.mode : "default"}
                              onValueChange={(v) => {
                                if (v === "default") {
                                  updateResellerCarrierMarkup(cid, null);
                                } else {
                                  updateResellerCarrierMarkup(cid, { ...activeRule, mode: v });
                                }
                              }}
                            >
                              <SelectTrigger className="h-9 rounded-sm bg-white text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="default">Usa Default ({formatRuleShort(defRule)})</SelectItem>
                                <SelectItem value="flat">Personalizza · Unico %</SelectItem>
                                <SelectItem value="area">Personalizza · Macro-Area</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <div className="text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-1.5 rounded-sm">
                              {pol === "reseller_only" ? `Comm. € ${Number(form.per_shipment_fee || 0).toFixed(2)} / sped` : "Disabilitato"}
                            </div>
                          )}
                        </div>
                      </div>

                      {pol === "admin_only" && hasCustom && (
                        <div className="pt-2 border-t border-slate-200 flex justify-end">
                          {activeRule.mode === "flat" ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-600">Margine unico:</span>
                              <Input
                                type="number"
                                step="0.5"
                                min="0"
                                value={activeRule.flat}
                                onChange={(e) => {
                                  const num = Math.max(0, parseFloat(e.target.value) || 0);
                                  updateResellerCarrierMarkup(cid, { mode: "flat", flat: num, domestic: num, europe: num, world: num });
                                }}
                                className="h-8 w-24 rounded-sm bg-white text-xs text-right font-mono"
                              />
                              <span className="text-xs font-bold">%</span>
                            </div>
                          ) : (
                            <div className="grid grid-cols-3 gap-2 w-full sm:w-auto">
                              <div>
                                <Label className="label-caps text-[10px]">Italia %</Label>
                                <Input
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  value={activeRule.domestic}
                                  onChange={(e) => updateResellerCarrierMarkup(cid, { ...activeRule, mode: "area", domestic: Math.max(0, parseFloat(e.target.value) || 0) })}
                                  className="h-8 w-24 rounded-sm bg-white text-xs text-right font-mono"
                                />
                              </div>
                              <div>
                                <Label className="label-caps text-[10px]">Europa %</Label>
                                <Input
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  value={activeRule.europe}
                                  onChange={(e) => updateResellerCarrierMarkup(cid, { ...activeRule, mode: "area", europe: Math.max(0, parseFloat(e.target.value) || 0) })}
                                  className="h-8 w-24 rounded-sm bg-white text-xs text-right font-mono"
                                />
                              </div>
                              <div>
                                <Label className="label-caps text-[10px]">Mondo %</Label>
                                <Input
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  value={activeRule.world}
                                  onChange={(e) => updateResellerCarrierMarkup(cid, { ...activeRule, mode: "area", world: Math.max(0, parseFloat(e.target.value) || 0) })}
                                  className="h-8 w-24 rounded-sm bg-white text-xs text-right font-mono"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-4">
              <div>
                <div className="label-caps mb-2 text-slate-900">Moduli Piattaforma Inclusi</div>
                <div className="space-y-2">
                  {FEATURE_KEYS.map(([k, l]) => {
                    const isLockedClientPrepaid = k === "client_prepaid" && !canEnableClientPrepaid;
                    return (
                      <div key={k}>
                        <label
                          className={`flex items-center gap-2 text-sm ${
                            isLockedClientPrepaid ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                          }`}
                        >
                          <Checkbox
                            checked={!isLockedClientPrepaid && !!form.features[k]}
                            disabled={isLockedClientPrepaid}
                            onCheckedChange={(v) => {
                              if (isLockedClientPrepaid) return;
                              setForm({ ...form, features: { ...form.features, [k]: !!v } });
                            }}
                          />
                          <span>{l}</span>
                        </label>
                        {isLockedClientPrepaid && (
                          <div className="text-[11px] text-amber-700 pl-6">
                            Disponibile solo se il Reseller paga a Fine Mese.
                          </div>
                        )}
                      </div>
                    );
                  })}
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

      {/* DIALOG REPORT CONTABILITA' & ESTRATTO CONTO RESELLER */}
      <Dialog open={!!billing} onOpenChange={(o) => !o && setBilling(null)}>
        <DialogContent className="rounded-sm max-w-4xl max-h-[90vh] overflow-y-auto">
          {billing && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between gap-2 flex-wrap pr-6">
                  <DialogTitle style={{ fontFamily: "Chivo" }}>
                    Contabilità & Estratto Conto — {billing.reseller.company_name}
                  </DialogTitle>
                  <Button size="sm" variant="outline" onClick={exportBillingXlsx} className="rounded-sm">
                    <DownloadSimple size={15} className="mr-1.5" /> Esporta Excel
                  </Button>
                </div>
              </DialogHeader>

              <div className="bg-slate-50 border border-slate-200 rounded-sm p-3 flex flex-wrap items-end gap-3 text-xs">
                <div>
                  <Label className="label-caps text-[10px]">Dal</Label>
                  <Input type="date" value={billingFrom} onChange={(e) => setBillingFrom(e.target.value)} className="mt-1 h-8 rounded-sm bg-white text-xs" />
                </div>
                <div>
                  <Label className="label-caps text-[10px]">Al</Label>
                  <Input type="date" value={billingTo} onChange={(e) => setBillingTo(e.target.value)} className="mt-1 h-8 rounded-sm bg-white text-xs" />
                </div>
                <Button size="sm" onClick={() => loadBillingReport(billingResellerId, billingFrom, billingTo)} disabled={billingLoading} className="h-8 bg-slate-900 rounded-sm">
                  {billingLoading ? "Calcolo…" : "Filtra Periodo"}
                </Button>
                {(billingFrom || billingTo) && (
                  <Button size="sm" variant="ghost" onClick={() => { setBillingFrom(""); setBillingTo(""); loadBillingReport(billingResellerId, "", ""); }} className="h-8 text-xs">
                    Azzera
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-
