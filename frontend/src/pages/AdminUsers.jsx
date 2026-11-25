import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  CheckCircle, Prohibit, FileText, Plus, Copy, Wallet,
  PencilSimple, EnvelopeSimple, FloppyDisk, ClockCounterClockwise,
} from "@phosphor-icons/react";

const ALL_CARRIERS = [
  { id: "brt", name: "BRT" },
  { id: "gls", name: "GLS Italy" },
  { id: "dhl", name: "DHL Express" },
  { id: "ups", name: "UPS" },
  { id: "tnt", name: "FedEx / TNT" },
  { id: "poste", name: "Poste Italiane" },
];

const emptyClientForm = {
  company_name: "",
  email: "",
  password: "",
  phone: "",
  address: "",
  postal_code: "",
  city: "",
  province: "",
  country: "IT",
  billing_type: "postpaid",
  rate_table_id: "none",
  allowed_carriers: ALL_CARRIERS.map((c) => c.id),
};

export default function AdminUsers() {
  const { user } = useAuth();
  const features = user?.features || {};
  const [users, setUsers] = useState([]);
  const [rates, setRates] = useState([]);
  const [availableCarriers, setAvailableCarriers] = useState(ALL_CARRIERS);

  // Profilo notifiche reseller
  const [notifEmail, setNotifEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Dialog crea / modifica sub-cliente
  const [openModal, setOpenModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState(emptyClientForm);

  // Dialog ricarica saldo sub-cliente
  const [topupTarget, setTopupTarget] = useState(null);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupNote, setTopupNote] = useState("");
  const [topupLoading, setTopupLoading] = useState(false);

  // Storico transazioni sub-clienti
  const [ledger, setLedger] = useState([]);
  const [ledgerFilterUser, setLedgerFilterUser] = useState("all");

  const load = async () => {
    try {
      const [uRes, rRes] = await Promise.all([
        api.get("/admin/users"),
        api.get("/admin/rate-tables"),
      ]);
      setUsers(uRes.data || []);
      setRates(rRes.data || []);
    } catch {}

    if (user?.role === "reseller_admin") {
      try {
        const pRes = await api.get("/reseller/profile");
        setNotifEmail(pRes.data?.notification_email || "");
      } catch {}
      try {
        const cRes = await api.get("/reseller/carriers");
        const list = (cRes.data?.carriers || []).map((c) => ({ id: c.carrier_id, name: c.name }));
        if (list.length > 0) setAvailableCarriers(list);
      } catch {}
    }
  };

  const loadLedger = async (uid = ledgerFilterUser) => {
    try {
      const q = uid && uid !== "all" ? `?user_id=${encodeURIComponent(uid)}` : "";
      const r = await api.get(`/admin/users-ledger${q}`);
      setLedger(r.data || []);
    } catch {}
  };

  useEffect(() => {
    load();
    loadLedger("all");
  }, [user]);

  const inviteUrl = `${window.location.origin}/register?reseller=${user?.reseller_slug || "demo"}`;

  const copyInvite = () => {
    navigator.clipboard.writeText(inviteUrl);
    toast.success("Link di registrazione copiato!");
  };

  const saveNotifEmail = async () => {
    setSavingProfile(true);
    try {
      await api.put("/reseller/profile", { notification_email: notifEmail });
      toast.success("Email ricezione notifiche aggiornata!");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore aggiornamento email");
    } finally {
      setSavingProfile(false);
    }
  };

  const lookupCap = async (cap) => {
    if (!cap) return;
    try {
      const cc = (form.country || "IT").toUpperCase();
      const r = await api.get(`/geo/lookup?country=${cc}&cap=${encodeURIComponent(cap)}`);
      if (r.data?.city || r.data?.province) {
        setForm((f) => ({
          ...f,
          postal_code: r.data.cap || f.postal_code,
          city: r.data.city || f.city,
          province: r.data.province || f.province,
        }));
      }
    } catch {}
  };

  const openCreateModal = () => {
    setEditingUser(null);
    setForm({
      ...emptyClientForm,
      allowed_carriers: availableCarriers.map((c) => c.id),
    });
    setOpenModal(true);
  };

  const openEditModal = (u) => {
    setEditingUser(u);
    setForm({
      company_name: u.company_name || "",
      email: u.email || "",
      password: "",
      phone: u.phone || "",
      address: u.address || "",
      postal_code: u.postal_code || "",
      city: u.city || "",
      province: u.province || "",
      country: u.country || "IT",
      billing_type: u.billing_type || "postpaid",
      rate_table_id: u.rate_table_id || "none",
      allowed_carriers: u.allowed_carriers || availableCarriers.map((c) => c.id),
    });
    setOpenModal(true);
  };

  const toggleCarrier = (cid, checked) => {
    setForm((f) => {
      const set = new Set(f.allowed_carriers || []);
      if (checked) set.add(cid);
      else set.delete(cid);
      return { ...f, allowed_carriers: Array.from(set) };
    });
  };

  const saveClientModal = async () => {
    if (!form.company_name.trim()) {
      toast.error("Inserisci la Ragione Sociale");
      return;
    }
    try {
      if (editingUser) {
        await api.patch(`/admin/users/${editingUser.id}`, {
          company_name: form.company_name,
          phone: form.phone,
          address: form.address,
          postal_code: form.postal_code,
          city: form.city,
          province: form.province,
          country: form.country,
          billing_type: form.billing_type,
          rate_table_id: form.rate_table_id === "none" ? null : form.rate_table_id,
          allowed_carriers: form.allowed_carriers,
        });
        toast.success("Sub-cliente aggiornato!");
      } else {
        if (!form.email.trim() || !form.password.trim()) {
          toast.error("Inserisci email e password iniziale");
          return;
        }
        await api.post("/admin/users", {
          ...form,
          rate_table_id: form.rate_table_id === "none" ? null : form.rate_table_id,
        });
        toast.success("Sub-cliente creato e attivo!");
      }
      setOpenModal(false);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore salvataggio cliente");
    }
  };

  const quickUpdate = async (id, patch) => {
    try {
      await api.patch(`/admin/users/${id}`, patch);
      toast.success("Cliente aggiornato");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore");
    }
  };

  const submitTopup = async () => {
    if (!topupTarget) return;
    const amt = parseFloat(topupAmount);
    if (!amt || isNaN(amt)) {
      toast.error("Inserisci un importo valido (positivo per accredito, negativo per storno)");
      return;
    }
    setTopupLoading(true);
    try {
      await api.post(`/admin/users/${topupTarget.id}/topup`, {
        amount: amt,
        note: topupNote,
      });
      toast.success(`Saldo aggiornato di € ${amt.toFixed(2)} per ${topupTarget.company_name}`);
      setTopupTarget(null);
      setTopupAmount("");
      setTopupNote("");
      load();
      loadLedger(ledgerFilterUser);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore aggiornamento saldo");
    } finally {
      setTopupLoading(false);
    }
  };

  const generate = async (id) => {
    try {
      const r = await api.post(`/admin/invoices/generate/${id}`);
      toast.success(`Fattura ${r.data.invoice_number} creata`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore");
    }
  };

  const ledgerTypeLabel = (t) => {
    if (t === "reseller_topup") return "Accredito Agenzia";
    if (t === "reseller_adjustment") return "Rettifica Agenzia";
    if (t === "topup") return "Ricarica Online";
    if (t === "shipment_refund") return "Rimborso Annullamento";
    return "Addebito Spedizione";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="label-caps text-orange-600 mb-1">Gestione Agenzia</div>
          <h1 className="text-4xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>Sub-Clienti</h1>
        </div>
        <Button onClick={openCreateModal} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11">
          <Plus size={16} className="mr-2" /> Nuovo Sub-Cliente
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 text-white rounded-sm p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs">
            <div className="label-caps text-orange-400">Link registrazione diretta per i tuoi clienti</div>
            <div className="font-mono text-slate-300 mt-1 break-all">{inviteUrl}</div>
          </div>
          <Button size="sm" onClick={copyInvite} className="bg-orange-600 hover:bg-orange-700 rounded-sm shrink-0">
            <Copy size={14} className="mr-1.5" /> Copia Link
          </Button>
        </div>

        {user?.role === "reseller_admin" && (
          <div className="bg-white border border-slate-200 rounded-sm p-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="flex-1">
              <Label className="label-caps text-slate-700 flex items-center gap-1.5">
                <EnvelopeSimple size={14} weight="fill" className="text-orange-600" />
                Email Ricezione Notifiche (Nuovi Clienti / Avvisi)
              </Label>
              <Input
                type="email"
                value={notifEmail}
                onChange={(e) => setNotifEmail(e.target.value)}
                placeholder="notifiche@tuaagenzia.it"
                className="mt-1.5 h-9 rounded-sm text-xs"
              />
            </div>
            <Button size="sm" onClick={saveNotifEmail} disabled={savingProfile} className="h-9 rounded-sm shrink-0">
              <FloppyDisk size={14} className="mr-1.5" /> {savingProfile ? "Salvataggio…" : "Salva Email"}
            </Button>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left label-caps">
                <th className="px-4 py-3">Azienda</th>
                <th className="px-4 py-3">Email & Sede</th>
                <th className="px-4 py-3">Stato</th>
                <th className="px-4 py-3">Modalità</th>
                <th className="px-4 py-3">Profilo Margini</th>
                <th className="px-4 py-3 text-right">Saldo</th>
                <th className="px-4 py-3">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100">
                  <td className="px-4 py-3 font-semibold">{u.company_name}</td>
                  <td className="px-4 py-3">
                    <div>{u.email}</div>
                    {u.city && (
                      <div className="text-[11px] text-slate-400">
                        {u.address ? `${u.address}, ` : ""}{u.postal_code} {u.city} ({u.country || "IT"})
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs rounded-sm border font-semibold ${
                      u.status === "approved" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-800 border-amber-200"
                    }`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Select value={u.billing_type} onValueChange={(v) => quickUpdate(u.id, { billing_type: v })}>
                      <SelectTrigger className="h-8 rounded-sm text-xs w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="postpaid">Fine mese</SelectItem>
                        {features.client_prepaid !== false && <SelectItem value="prepaid">Prepagato</SelectItem>}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <Select value={u.rate_table_id || "none"} onValueChange={(v) => quickUpdate(u.id, { rate_table_id: v === "none" ? null : v })}>
                      <SelectTrigger className="h-8 rounded-sm text-xs w-44"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Default (+20%)</SelectItem>
                        {rates.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold">
                    € {(u.credit_balance || 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => openEditModal(u)} className="rounded-sm h-8" title="Modifica Anagrafica, Sede e Corrieri">
                        <PencilSimple size={14} />
                      </Button>
                      {u.billing_type === "prepaid" && (
                        <Button
                          size="sm"
                          onClick={() => { setTopupTarget(u); setTopupAmount(""); setTopupNote(""); }}
                          className="bg-orange-600 hover:bg-orange-700 rounded-sm h-8 text-xs px-2.5"
                          title="Ricarica Saldo Prepagato"
                        >
                          <Wallet size={14} className="mr-1" /> Ricarica
                        </Button>
                      )}
                      {u.status !== "approved" && (
                        <Button size="sm" onClick={() => quickUpdate(u.id, { status: "approved" })} className="bg-green-600 hover:bg-green-700 rounded-sm h-8" title="Approva">
                          <CheckCircle size={14} weight="fill" />
                        </Button>
                      )}
                      {u.status !== "rejected" && (
                        <Button size="sm" variant="outline" onClick={() => quickUpdate(u.id, { status: "rejected" })} className="rounded-sm h-8" title="Sospendi">
                          <Prohibit size={14} />
                        </Button>
                      )}
                      {u.billing_type === "postpaid" && features.client_billing && (
                        <Button size="sm" variant="outline" onClick={() => generate(u.id)} className="rounded-sm h-8" title="Genera Fattura">
                          <FileText size={14} />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-slate-500">Nessun sub-cliente registrato.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Storico Transazioni Sub-Clienti */}
      <div className="bg-white border border-slate-200 rounded-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ClockCounterClockwise size={20} weight="fill" className="text-orange-600" />
            <h2 className="text-lg font-bold tracking-tight" style={{ fontFamily: "Chivo" }}>
              Storico Transazioni Sub-Clienti
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Filtra per cliente:</span>
            <Select
              value={ledgerFilterUser}
              onValueChange={(v) => {
                setLedgerFilterUser(v);
                loadLedger(v);
              }}
            >
              <SelectTrigger className="h-9 rounded-sm text-xs w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i sub-clienti</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.company_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left label-caps">
                <th className="px-5 py-3">Data</th>
                <th className="px-5 py-3">Sub-Cliente</th>
                <th className="px-5 py-3">Movimento</th>
                <th className="px-5 py-3">Note / Riferimento</th>
                <th className="px-5 py-3 text-right">Importo</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id} className="border-b border-slate-100">
                  <td className="px-5 py-2.5 text-xs font-mono text-slate-500">
                    {l.created_at?.slice(0, 19).replace("T", " ")}
                  </td>
                  <td className="px-5 py-2.5 font-semibold">{l.company_name || "-"}</td>
                  <td className="px-5 py-2.5 text-xs font-semibold">{ledgerTypeLabel(l.type)}</td>
                  <td className="px-5 py-2.5 text-xs text-slate-600">{l.note || "-"}</td>
                  <td className={`px-5 py-2.5 text-right font-mono font-bold ${l.amount > 0 ? "text-green-600" : "text-slate-900"}`}>
                    {l.amount > 0 ? "+" : ""}€ {Number(l.amount || 0).toFixed(2)}
                  </td>
                </tr>
              ))}
              {ledger.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-slate-500 text-xs">Nessuna transazione registrata.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dialog Crea / Modifica Sub-Cliente */}
      <Dialog open={openModal} onOpenChange={setOpenModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-sm">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Chivo" }}>
              {editingUser ? `Modifica Sub-Cliente · ${editingUser.company_name}` : "Crea Nuovo Sub-Cliente"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="label-caps">Ragione Sociale*</Label>
                <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} className="mt-1 rounded-sm h-10" />
              </div>
              <div>
                <Label className="label-caps">Telefono</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 rounded-sm h-10" />
              </div>
              {!editingUser && (
                <>
                  <div>
                    <Label className="label-caps">Email Accesso*</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 rounded-sm h-10" />
                  </div>
                  <div>
                    <Label className="label-caps">Password Iniziale*</Label>
                    <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1 rounded-sm h-10" />
                  </div>
                </>
              )}
            </div>

            <div className="border-t border-slate-200 pt-3 space-y-3">
              <div className="label-caps text-orange-600">Indirizzo Sede Predefinito ("Il mio indirizzo" in Nuova Spedizione)</div>
              <div>
                <Label className="label-caps">Via e Numero Civico</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1 rounded-sm h-10" placeholder="es. Via Roma 10" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <Label className="label-caps">CAP</Label>
                  <Input value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} onBlur={(e) => lookupCap(e.target.value)} className="mt-1 rounded-sm h-10" placeholder="20121" />
                </div>
                <div className="col-span-2">
                  <Label className="label-caps">Città</Label>
                  <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="mt-1 rounded-sm h-10" placeholder="Milano" />
                </div>
                <div>
                  <Label className="label-caps">Prov. / Nazione</Label>
                  <div className="flex gap-1.5 mt-1">
                    <Input maxLength={2} value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value.toUpperCase() })} className="rounded-sm h-10 w-14 text-center" placeholder="MI" />
                    <Input maxLength={2} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} className="rounded-sm h-10 w-14 text-center" placeholder="IT" />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <Label className="label-caps">Profilo Margini Assegnato</Label>
                <Select value={form.rate_table_id} onValueChange={(v) => setForm({ ...form, rate_table_id: v })}>
                  <SelectTrigger className="mt-1 rounded-sm h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Default (+20%)</SelectItem>
                    {rates.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-3 space-y-2">
              <div className="label-caps text-slate-700">Corrieri Abilitati per questo Sub-Cliente</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {availableCarriers.map((c) => {
                  const checked = (form.allowed_carriers || []).includes(c.id);
                  return (
                    <label key={c.id} className="flex items-center gap-2 border border-slate-200 rounded-sm px-3 py-2 cursor-pointer hover:bg-slate-50 text-xs font-semibold">
                      <Checkbox checked={checked} onCheckedChange={(v) => toggleCarrier(c.id, !!v)} />
                      <span>{c.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <Button variant="outline" onClick={() => setOpenModal(false)} className="rounded-sm">Annulla</Button>
              <Button onClick={saveClientModal} className="bg-orange-600 hover:bg-orange-700 rounded-sm">
                {editingUser ? "Salva Modifiche" : "Crea Cliente"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Ricarica Saldo Prepagato Sub-Cliente */}
      <Dialog open={!!topupTarget} onOpenChange={(v) => !v && setTopupTarget(null)}>
        <DialogContent className="max-w-md rounded-sm">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Chivo" }}>
              Ricarica Saldo · {topupTarget?.company_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="bg-slate-50 border border-slate-200 rounded-sm p-3 flex items-center justify-between">
              <span className="text-xs text-slate-500">Saldo attuale cliente:</span>
              <span className="font-mono font-black text-lg text-slate-900">
                € {(topupTarget?.credit_balance || 0).toFixed(2)}
              </span>
            </div>
            <div>
              <Label className="label-caps">Importo da accreditare (€)*</Label>
              <Input
                type="number"
                step="0.01"
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                placeholder="es. 250.00 (usa - per storno)"
                className="mt-1 rounded-sm h-10 font-mono"
              />
            </div>
            <div>
              <Label className="label-caps">Causale / Note (opzionale)</Label>
              <Input
                value={topupNote}
                onChange={(e) => setTopupNote(e.target.value)}
                placeholder="es. Bonifico ricevuto il 25/11"
                className="mt-1 rounded-sm h-10"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setTopupTarget(null)} className="rounded-sm">Annulla</Button>
              <Button onClick={submitTopup} disabled={topupLoading} className="bg-orange-600 hover:bg-orange-700 rounded-sm">
                {topupLoading ? "Salvataggio…" : "Conferma Ricarica"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
