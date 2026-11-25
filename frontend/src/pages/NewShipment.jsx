import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Package, Plus, X, Printer, CheckCircle, User, AddressBook, Question, UploadSimple, Warning } from "@phosphor-icons/react";

const COUNTRIES = [
  { code: "IT", name: "Italia" },
  { code: "FR", name: "Francia" },
  { code: "DE", name: "Germania" },
  { code: "ES", name: "Spagna" },
  { code: "IE", name: "Irlanda" },
  { code: "GB", name: "Regno Unito (UK)" },
  { code: "CH", name: "Svizzera" },
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgio" },
  { code: "NL", name: "Paesi Bassi (Olanda)" },
  { code: "PT", name: "Portogallo" },
  { code: "PL", name: "Polonia" },
  { code: "SE", name: "Svezia" },
  { code: "DK", name: "Danimarca" },
  { code: "FI", name: "Finlandia" },
  { code: "GR", name: "Grecia" },
  { code: "RO", name: "Romania" },
  { code: "CZ", name: "Repubblica Ceca" },
  { code: "HU", name: "Ungheria" },
  { code: "HR", name: "Croazia" },
  { code: "SI", name: "Slovenia" },
  { code: "SK", name: "Slovacchia" },
  { code: "BG", name: "Bulgaria" },
  { code: "LU", name: "Lussemburgo" },
  { code: "MT", name: "Malta" },
  { code: "CY", name: "Cipro" },
  { code: "EE", name: "Estonia" },
  { code: "LV", name: "Lettonia" },
  { code: "LT", name: "Lituania" },
  { code: "NO", name: "Norvegia" },
  { code: "US", name: "Stati Uniti (USA)" },
  { code: "CA", name: "Canada" },
  { code: "MX", name: "Messico" },
  { code: "AU", name: "Australia" },
  { code: "JP", name: "Giappone" },
  { code: "CN", name: "Cina" },
  { code: "AE", name: "Emirati Arabi Uniti" },
  { code: "BR", name: "Brasile" },
];

const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
]);

const PROVINCE_COUNTRIES = new Set(["IT", "US", "CA", "AU"]);

const emptyAddr = { company_name: "", address: "", postal_code: "", city: "", province: "", country: "IT", reference: "", email: "", phone: "" };
const emptyParcel = { length: 30, width: 20, height: 15, weight: 1 };
const STEPS = ["Mittente", "Destinatario", "Colli", "Servizi & Dogana", "Preventivo", "Conferma"];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function NewShipment() {
  const nav = useNavigate();
  const { user, refresh } = useAuth();
  const features = user?.features || {};
  const enabledSurcharges = user?.enabled_surcharges || {
    insurance: true, cod: true, saturday_delivery: true, neutral_delivery: true, residential_delivery: true,
  };
  const allowDdp = !!user?.allow_ddp;
  const isResellerOrAdmin = ["reseller_admin", "super_admin", "admin"].includes(user?.role);

  const [step, setStep] = useState(0);
  const [sender, setSender] = useState({ ...emptyAddr });
  const [recipient, setRecipient] = useState({ ...emptyAddr });
  const [parcelType, setParcelType] = useState("pacco");
  const [parcels, setParcels] = useState([{ ...emptyParcel }]);
  const [goods, setGoods] = useState("");
  const [customs, setCustoms] = useState({
    required: false,
    incoterms: "DAP",
    proforma_name: "",
    proforma_base64: "",
    dae_name: "",
    dae_base64: "",
    eori_number: "",
    customs_value: 0,
  });
  const [services, setServices] = useState({
    insurance: false, insurance_value: 0,
    neutral_delivery: false,
    cod: false, cod_amount: 0,
    saturday_delivery: false,
    residential_delivery: false,
  });
  const [quotes, setQuotes] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [addrCheck, setAddrCheck] = useState(null);
  const [checkingAddr, setCheckingAddr] = useState(false);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(null);
  const [addressbook, setAddressbook] = useState([]);
  const [savedParcels, setSavedParcels] = useState([]);

  const destCountry = (recipient.country || "IT").toUpperCase();
  const isExtraEu = destCountry.length === 2 && !EU_COUNTRIES.has(destCountry);

  useEffect(() => {
    setCustoms(c => ({ ...c, required: isExtraEu, incoterms: allowDdp ? c.incoterms : "DAP" }));
  }, [isExtraEu, allowDdp]);

  useEffect(() => {
    if (features.address_book !== false) api.get("/addressbook").then(r => setAddressbook(r.data)).catch(() => {});
    if (features.parcels) {
      api.get("/parcels").then(r => {
        setSavedParcels(r.data);
        const def = r.data.find(p => p.is_default);
        if (def) setParcels([{ length: def.length, width: def.width, height: def.height, weight: def.weight }]);
      }).catch(() => {});
    }
  }, [features.address_book, features.parcels]);

  const loadMyAddress = () => {
    const ra = user?.reseller_address || {};
    setSender({
      ...emptyAddr,
      company_name: ra.company_name || user?.company_name || "",
      address: ra.address || "",
      postal_code: ra.postal_code || "",
      city: ra.city || "",
      province: ra.province || "",
      country: ra.country || "IT",
      phone: ra.phone || user?.phone || "",
      email: ra.email || user?.email || "",
    });
    if (!ra.address) {
      toast.info("Indirizzo sede non ancora compilato dall'amministratore: completa Via, CAP e Città.");
    }
  };

  const handleSelectCarrier = async (q) => {
    setChosen(q);
    setAddrCheck(null);
    if (q.carrier_id === "tnt") {
      setCheckingAddr(true);
      try {
        const r = await api.post("/shipments/validate-address", {
          carrier_id: q.carrier_id,
          address: recipient,
        });
        setAddrCheck(r.data);
      } catch {
        setAddrCheck(null);
      } finally {
        setCheckingAddr(false);
      }
    }
  };

  const handlePdfUpload = async (fieldPrefix, file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File troppo grande (max 5 MB)");
      return;
    }
    const b64 = await fileToBase64(file);
    setCustoms(c => ({
      ...c,
      [`${fieldPrefix}_name`]: file.name,
      [`${fieldPrefix}_base64`]: b64,
    }));
    toast.success(`Documento "${file.name}" allegato`);
  };

  const buildBody = () => ({
    sender,
    recipient,
    parcel_type: parcelType,
    parcels,
    goods_description: goods,
    customs: { ...customs, required: isExtraEu },
    services,
  });

  const fetchQuotes = async () => {
    if (isExtraEu && !customs.proforma_name?.trim()) {
      toast.error("Per spedizioni Extra-UE è obbligatorio caricare o indicare la Fattura Proforma / Commerciale");
      return;
    }
    setLoading(true); setChosen(null); setAddrCheck(null);
    try {
      const r = await api.post("/shipments/quote", buildBody());
      setQuotes(r.data); setStep(4);
    } catch (err) { toast.error(err?.response?.data?.detail || "Errore preventivo"); }
    finally { setLoading(false); }
  };

  const confirm = async () => {
    if (!chosen) return;
    setLoading(true);
    try {
      const r = await api.post("/shipments", { quote: buildBody(), carrier_id: chosen.carrier_id });
      setCreated(r.data); await refresh(); setStep(5); toast.success("Spedizione creata!");
    } catch (err) { toast.error(err?.response?.data?.detail || "Errore creazione"); }
    finally { setLoading(false); }
  };

  const downloadLabel = async () => {
    const r = await api.get(`/shipments/${created.id}/label`, { responseType: "blob" });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a"); a.href = url; a.download = `label-${created.tracking_number}.pdf`; a.click(); URL.revokeObjectURL(url);
  };

  const canNext = () => {
    if (step === 0) return sender.company_name && sender.address && sender.postal_code && sender.city;
    if (step === 1) return recipient.company_name && recipient.address && recipient.postal_code && recipient.city;
    if (step === 2) return parcels.length > 0 && parcels.every(p => p.length > 0 && p.width > 0 && p.height > 0 && p.weight > 0);
    return true;
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="label-caps text-orange-600 mb-1">Wizard</div>
        <h1 className="text-4xl font-black tracking-tighter text-slate-900" style={{ fontFamily: "Chivo" }}>Nuova Spedizione</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className={`text-xs px-3 py-1.5 border rounded-sm font-semibold ${
            i === step ? "bg-orange-600 text-white border-orange-600" : i < step ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"
          }`}>{i + 1}. {s}</div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-sm p-6 sm:p-8">
        {step === 0 && <AddressForm title="Dati Mittente" data={sender} setData={setSender} addressbook={addressbook} onClient={loadMyAddress} />}
        {step === 1 && <AddressForm title="Dati Destinatario" data={recipient} setData={setRecipient} addressbook={addressbook} />}
        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "Chivo" }}>Colli</h2>
            <div>
              <Label className="label-caps">Tipo di spedizione</Label>
              <Select value={parcelType} onValueChange={setParcelType}>
                <SelectTrigger className="mt-1.5 rounded-sm max-w-xs h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pacco">Pacco</SelectItem>
                  <SelectItem value="busta">Busta</SelectItem>
                  <SelectItem value="documenti">Documenti</SelectItem>
                  <SelectItem value="pallet">Pallet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {parcels.map((p, i) => (
              <div key={i} className="border border-slate-200 rounded-sm p-4 bg-slate-50/50 relative">
                <div className="flex items-center justify-between mb-3">
                  <div className="label-caps">Collo #{i + 1}</div>
                  {parcels.length > 1 && <button onClick={() => setParcels(parcels.filter((_, x) => x !== i))} className="text-slate-500 hover:text-red-600"><X size={16} /></button>}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {["length", "width", "height", "weight"].map((k) => (
                    <div key={k}>
                      <Label className="label-caps">{{length: "Lung. (cm)", width: "Larg. (cm)", height: "Prof. (cm)", weight: "Peso (kg)"}[k]}</Label>
                      <Input type="number" min="0.1" step="0.1" value={p[k]}
                        onChange={(e) => { const np = [...parcels]; np[i] = { ...np[i], [k]: Math.max(0, parseFloat(e.target.value) || 0) }; setParcels(np); }}
                        className="mt-1.5 rounded-sm h-10" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <Button variant="outline" onClick={() => setParcels([...parcels, { ...emptyParcel }])} className="rounded-sm"><Plus size={16} className="mr-2" /> Aggiungi collo</Button>
            {savedParcels.length > 0 && (
              <div>
                <Label className="label-caps">Applica pacco salvato</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {savedParcels.map(sp => (
                    <button key={sp.id} onClick={() => setParcels([{ length: sp.length, width: sp.width, height: sp.height, weight: sp.weight }])}
                      className="text-xs bg-slate-100 hover:bg-orange-100 border border-slate-200 px-3 py-1.5 rounded-sm font-semibold">
                      {sp.name} · {sp.length}×{sp.width}×{sp.height} · {sp.weight}kg{sp.is_default && " ★"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div><Label className="label-caps">Descrizione merce {isExtraEu && <span className="text-orange-600">* (obbligatoria per dogana)</span>}</Label><Textarea value={goods} onChange={(e) => setGoods(e.target.value)} className="mt-1.5 rounded-sm" rows={3} /></div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "Chivo" }}>Servizi Accessori & Documentazione</h2>

            {/* SEZIONE 1: SERVIZI EXTRA CORRIERE */}
            <div className="border border-slate-200 rounded-sm p-5 space-y-4">
              <div className="label-caps text-orange-600">Servizi Accessori & Supplementi</div>

              {enabledSurcharges.insurance !== false && (
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox checked={services.insurance} onCheckedChange={(v) => setServices({ ...services, insurance: !!v })} className="mt-1" />
                  <div className="flex-1">
                    <div className="font-semibold text-sm">Assicurazione Merce</div>
                    <div className="text-xs text-slate-500">Copertura assicurativa sul valore dichiarato del contenuto.</div>
                    {services.insurance && (
                      <div className="mt-2 max-w-xs">
                        <Label className="label-caps">Valore assicurato (€)*</Label>
                        <Input type="number" min="1" value={services.insurance_value} onChange={(e) => setServices({ ...services, insurance_value: Math.max(0, parseFloat(e.target.value) || 0) })} className="mt-1 rounded-sm h-10" />
                      </div>
                    )}
                  </div>
                </label>
              )}

              {enabledSurcharges.cod !== false && (
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox checked={services.cod} onCheckedChange={(v) => setServices({ ...services, cod: !!v })} className="mt-1" />
                  <div className="flex-1">
                    <div className="font-semibold text-sm">Contrassegno (COD)</div>
                    <div className="text-xs text-slate-500">Incasso alla consegna da parte del corriere.</div>
                    {services.cod && (
                      <div className="mt-2 max-w-xs">
                        <Label className="label-caps">Importo da incassare (€)*</Label>
                        <Input type="number" min="1" step="0.01" value={services.cod_amount} onChange={(e) => setServices({ ...services, cod_amount: Math.max(0, parseFloat(e.target.value) || 0) })} className="mt-1 rounded-sm h-10" />
                      </div>
                    )}
                  </div>
                </label>
              )}

              {enabledSurcharges.saturday_delivery !== false && (
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox checked={services.saturday_delivery} onCheckedChange={(v) => setServices({ ...services, saturday_delivery: !!v })} className="mt-1" />
                  <div>
                    <div className="font-semibold text-sm">Consegna al Sabato</div>
                    <div className="text-xs text-slate-500">Richiede il tentativo di consegna nella giornata di sabato (ove disponibile).</div>
                  </div>
                </label>
              )}

              {enabledSurcharges.residential_delivery !== false && (
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox checked={services.residential_delivery} onCheckedChange={(v) => setServices({ ...services, residential_delivery: !!v })} className="mt-1" />
                  <div>
                    <div className="font-semibold text-sm">Consegna a Indirizzo Privato / Residenziale</div>
                    <div className="text-xs text-slate-500">Seleziona se il destinatario è un'abitazione privata (evita addebiti postumi di rettifica).</div>
                  </div>
                </label>
              )}

              {enabledSurcharges.neutral_delivery !== false && (
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox checked={services.neutral_delivery} onCheckedChange={(v) => setServices({ ...services, neutral_delivery: !!v })} className="mt-1" />
                  <div>
                    <div className="font-semibold text-sm">Consegna Neutra</div>
                    <div className="text-xs text-slate-500">Nessun riferimento commerciale del mittente reale sulla bolla di consegna.</div>
                  </div>
                </label>
              )}
            </div>

            {/* SEZIONE 2: DOCUMENTI DOGANALI (SOLO DESTINAZIONE EXTRA-UE) */}
            {isExtraEu ? (
              <div className="border-2 border-amber-300 bg-amber-50/40 rounded-sm p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="label-caps text-amber-800">Documenti Doganali Obbligatori (Destinazione Extra-UE: {destCountry})</div>
                    <p className="text-xs text-slate-600 mt-0.5">Carica i documenti in PDF: verranno trasmessi elettronicamente (Paperless ETD) ai corrieri che lo supportano.</p>
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="inline-flex items-center gap-1 text-xs font-bold bg-amber-100 hover:bg-amber-200 text-amber-900 px-3 py-1.5 rounded-sm shrink-0">
                        <Question size={16} weight="fill" /> Guida Dogana & DAP/DDP
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-96 text-xs space-y-2 p-4 rounded-sm">
                      <div className="font-bold text-slate-900 text-sm">Documenti & Termini di Resa Extra-UE</div>
                      <p><b>• DAP (Delivered At Place):</b> dazi e IVA d'importazione sono pagati dal <b>destinatario</b> alla consegna.</p>
                      <p><b>• DDP (Delivered Duty Paid):</b> dazi e IVA d'importazione sono addebitati al <b>mittente</b> (richiede abilitazione espressa).</p>
                      <p><b>• Fattura Commerciale o Proforma (Obbligatoria):</b> indica valore della merce, valuta, codice doganale (HS Code), paese d'origine e causale.</p>
                      <p><b>• DAE:</b> obbligatorio se il valore esportato supera i <b>1.000 €</b>.</p>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label className="label-caps">Termini di Resa Doganale (Incoterms)*</Label>
                    <Select value={customs.incoterms} onValueChange={(v) => setCustoms({ ...customs, incoterms: v })}>
                      <SelectTrigger className="mt-1 rounded-sm h-10 bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DAP">DAP — Dazi e oneri doganali a carico del Destinatario</SelectItem>
                        {allowDdp && <SelectItem value="DDP">DDP — Dazi e oneri doganali a carico del Mittente</SelectItem>}
                      </SelectContent>
                    </Select>
                    {!allowDdp && (
                      <div className="text-[11px] text-slate-500 mt-1">Resa DDP disabilitata di default: per spedire in DDP richiedi l'abilitazione all'amministratore.</div>
                    )}
                  </div>

                  <div>
                    <Label className="label-caps">Fattura Proforma / Commerciale (PDF)*</Label>
                    <label className="mt-1 flex items-center justify-between gap-2 border border-slate-300 bg-white hover:bg-slate-50 rounded-sm h-10 px-3 cursor-pointer text-xs">
                      <span className="truncate font-medium text-slate-700">
                        {customs.proforma_name || "Carica PDF Proforma / Commerciale…"}
                      </span>
                      <UploadSimple size={16} className="text-orange-600 shrink-0" />
                      <input type="file" accept=".pdf,application/pdf" onChange={(e) => handlePdfUpload("proforma", e.target.files?.[0])} className="hidden" />
                    </label>
                  </div>

                  <div>
                    <Label className="label-caps">DAE (PDF — Obbligatorio oltre € 1.000)</Label>
                    <label className="mt-1 flex items-center justify-between gap-2 border border-slate-300 bg-white hover:bg-slate-50 rounded-sm h-10 px-3 cursor-pointer text-xs">
                      <span className="truncate font-medium text-slate-700">
                        {customs.dae_name || "Carica PDF DAE (se previsto)…"}
                      </span>
                      <UploadSimple size={16} className="text-orange-600 shrink-0" />
                      <input type="file" accept=".pdf,application/pdf" onChange={(e) => handlePdfUpload("dae", e.target.files?.[0])} className="hidden" />
                    </label>
                  </div>

                  <div>
                    <Label className="label-caps">Codice EORI Mittente</Label>
                    <Input value={customs.eori_number} onChange={(e) => setCustoms({ ...customs, eori_number: e.target.value.toUpperCase() })} className="mt-1 rounded-sm h-10 bg-white" placeholder="es. IT12345678901" />
                  </div>
                  <div>
                    <Label className="label-caps">Valore Doganale Dichiarato (€)*</Label>
                    <Input type="number" min="1" value={customs.customs_value} onChange={(e) => setCustoms({ ...customs, customs_value: Math.max(0, parseFloat(e.target.value) || 0) })} className="mt-1 rounded-sm h-10 bg-white" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-sm p-3">
                Destinazione <b>{destCountry}</b> (Italia / Unione Europea): nessun documento doganale richiesto.
              </div>
            )}
          </div>
        )}

        {step === 4 && quotes && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "Chivo" }}>Preventivo</h2>
            <div className="text-sm text-slate-600">Macro-Zona: <b>{quotes.zone}</b> · Peso tassato: <b>{quotes.billed_weight} kg</b></div>
            {quotes.quotes.map((q, i) => (
              <div key={q.carrier_id} onClick={() => handleSelectCarrier(q)}
                className={`bg-white border rounded-sm p-4 cursor-pointer transition-all hover:shadow-md ${chosen?.carrier_id === q.carrier_id ? "border-l-[3px] border-orange-600 border-y border-r border-slate-200" : "border-slate-200"}`}>
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-sm flex items-center justify-center font-black text-white shrink-0" style={{ backgroundColor: q.color, fontFamily: "Chivo" }}>
                    {q.carrier_name.slice(0, 3).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900">{q.carrier_name}</span>
                      {isResellerOrAdmin && q.is_live && (
                        <span className="text-[10px] font-bold bg-green-100 text-green-800 px-1.5 py-0.5 rounded-sm">TARIFFA API REALE</span>
                      )}
                      {isResellerOrAdmin && q.contract_owner && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm ${q.contract_owner === "admin" ? "bg-orange-100 text-orange-800" : "bg-blue-100 text-blue-800"}`}>
                          {q.contract_owner === "admin" ? "Codice Piattaforma" : "Tuo Codice"}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">Consegna stimata: {q.transit_days} {q.transit_days === 1 ? "giorno" : "giorni"} lav.</div>
                    {i === 0 && <div className="mt-1 label-caps text-orange-600">Miglior prezzo</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-slate-900" style={{ fontFamily: "Chivo" }}>€ {q.price.toFixed(2)}</div>
                    <div className="text-[10px] text-slate-400">IVA esclusa</div>
                  </div>
                </div>

                {isResellerOrAdmin && q.reseller_base_freight !== undefined && (
                  <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 bg-slate-50/70 px-3 py-2 rounded-sm">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>Nolo base: <b className="text-slate-900">€ {q.reseller_base_freight.toFixed(2)}</b></span>
                      <span>Supplementi totali: <b className="text-slate-900">€ {(q.reseller_surcharges_total ?? 0).toFixed(2)}</b></span>
                      {q.reseller_surcharge_items?.map((sc, idx) => (
                        <span key={idx} className="text-slate-500">
                          • {sc.label}: € {sc.amount.toFixed(2)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* RISULTATO VALIDAZIONE INDIRIZZO FEDEX DOPO LA SELEZIONE DEL CORRIERE */}
            {checkingAddr && (
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-sm p-3">
                Verifica indirizzo destinatario su database FedEx in corso…
              </div>
            )}
            {addrCheck && addrCheck.supported && (
              <div className={`border rounded-sm p-3.5 text-xs space-y-1 ${addrCheck.resolved ? "bg-blue-50/60 border-blue-200 text-blue-900" : "bg-amber-50 border-amber-300 text-amber-900"}`}>
                <div className="font-bold flex items-center gap-1.5">
                  <Warning size={15} weight="fill" />
                  Verifica Indirizzo FedEx: {addrCheck.resolved ? "Indirizzo Riconosciuto" : "Attenzione: Indirizzo da verificare"}
                </div>
                <div>
                  Tipologia rilevata: <b>{addrCheck.classification === "RESIDENTIAL" ? "RESIDENZIALE (Privato)" : addrCheck.classification === "BUSINESS" ? "AZIENDA / COMMERCIALE" : addrCheck.classification}</b>
                  {addrCheck.is_residential && !services.residential_delivery && (
                    <span className="text-amber-800 font-semibold"> — Nota: FedEx classifica questo civico come residenziale e potrebbe applicare il supplemento consegna privato.</span>
                  )}
                </div>
                {addrCheck.warning && <div>{addrCheck.warning}</div>}
                {addrCheck.messages?.map((m, idx) => <div key={idx}>• {m}</div>)}
              </div>
            )}
          </div>
        )}

        {step === 5 && created && (
          <div className="space-y-6 text-center py-6">
            <div className="w-16 h-16 mx-auto rounded-sm bg-green-100 flex items-center justify-center"><CheckCircle size={32} weight="fill" className="text-green-600" /></div>
            <div>
              <h2 className="text-3xl font-black tracking-tight" style={{ fontFamily: "Chivo" }}>Spedizione creata!</h2>
              <p className="text-slate-600 mt-1">Tracking: <span className="font-mono font-bold">{created.tracking_number}</span></p>
              <p className="text-slate-600">Corriere: <b>{created.carrier_name}</b> · <b>€ {created.price.toFixed(2)}</b></p>
            </div>

            {created.customs?.required && (
              <div className={`max-w-xl mx-auto text-left border rounded-sm p-4 text-xs ${created.customs?.paperless_ok ? "bg-green-50 border-green-200 text-green-900" : "bg-amber-50 border-amber-300 text-amber-900"}`}>
                {created.customs?.paperless_ok ? (
                  <div>
                    <b>Dogana Elettronica (Paperless ETD) attiva:</b> i documenti PDF sono stati trasmessi elettronicamente al corriere.
                  </div>
                ) : (
                  <div>
                    <b>Attenzione — Documentazione Cartacea Richiesta:</b> per questa destinazione o corriere l'invio doganale elettronico (Paperless) non è disponibile. Nonostante il caricamento dei file, è <b>obbligatorio stampare e allegare fisicamente 3 copie della Fattura Proforma/Commerciale (e DAE se presente)</b> nella busta portadocumenti sul collo.
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 justify-center flex-wrap">
              <Button onClick={downloadLabel} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11"><Printer size={16} className="mr-2" /> Stampa Etichetta</Button>
              <Button variant="outline" onClick={() => nav("/shipments")} className="rounded-sm h-11">Vai a Spedizioni</Button>
            </div>
          </div>
        )}
      </div>

      {step < 5 && (
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} className="rounded-sm"><ArrowLeft size={16} className="mr-2" /> Indietro</Button>
          {step < 3 && <Button disabled={!canNext()} onClick={() => setStep(step + 1)} className="bg-orange-600 hover:bg-orange-700 rounded-sm">Avanti <ArrowRight size={16} className="ml-2" /></Button>}
          {step === 3 && <Button disabled={loading} onClick={fetchQuotes} className="bg-orange-600 hover:bg-orange-700 rounded-sm">{loading ? "Calcolo…" : "Calcola tariffe"} <ArrowRight size={16} className="ml-2" /></Button>}
          {step === 4 && <Button disabled={!chosen || loading} onClick={confirm} className="bg-orange-600 hover:bg-orange-700 rounded-sm">{loading ? "Creazione…" : "Conferma & Crea"} <Package size={16} className="ml-2" weight="fill" /></Button>}
        </div>
      )}
    </div>
  );
}

function AddressForm({ title, data, setData, addressbook = [], onClient }) {
  const set = (k) => (e) => setData({ ...data, [k]: e.target.value });
  const cc = (data.country || "IT").toUpperCase();
  const showProvince = PROVINCE_COUNTRIES.has(cc);

  const pickFromBook = (b) => setData({
    company_name: b.company_name,
    address: b.address,
    postal_code: b.postal_code,
    city: b.city,
    province: b.province || "",
    country: b.country,
    reference: b.reference || "",
    email: b.email || "",
    phone: b.phone || "",
  });

  const handleCountryChange = (newCountry) => {
    const up = newCountry.toUpperCase();
    setData(d => ({
      ...d,
      country: up,
      province: PROVINCE_COUNTRIES.has(up) ? d.province : "",
    }));
  };

  const lookupCap = async (cap) => {
    if (!cap) return;
    try {
      const r = await api.get(`/geo/lookup?country=${cc}&cap=${encodeURIComponent(cap)}`);
      if (r.data.valid === false) {
        toast.warning(`Il CAP "${cap}" non risulta valido per ${cc}`);
      }
      if (r.data.city || r.data.province) {
        setData(d => ({
          ...d,
          postal_code: r.data.cap || d.postal_code,
          city: r.data.city || d.city,
          province: PROVINCE_COUNTRIES.has(cc) ? (r.data.province || d.province) : "",
        }));
      }
    } catch {}
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "Chivo" }}>{title}</h2>
        <div className="flex gap-2">
          {onClient && (
            <button type="button" onClick={onClient} className="inline-flex items-center gap-1 px-3 h-9 bg-slate-100 hover:bg-slate-200 rounded-sm text-xs font-semibold">
              <User size={14} weight="fill" /> Il mio indirizzo
            </button>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="inline-flex items-center gap-1 px-3 h-9 bg-slate-100 hover:bg-slate-200 rounded-sm text-xs font-semibold">
                <AddressBook size={14} weight="fill" /> Rubrica
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0 rounded-sm max-h-80 overflow-y-auto">
              {addressbook.length === 0 && <div className="p-4 text-sm text-slate-500">Rubrica vuota.</div>}
              {addressbook.map(b => (
                <button type="button" key={b.id} onClick={() => pickFromBook(b)} className="block w-full text-left p-3 border-b border-slate-100 hover:bg-orange-50 text-sm">
                  <div className="font-semibold">{b.company_name} {b.label && <span className="text-xs text-slate-400">({b.label})</span>}</div>
                  <div className="text-xs text-slate-500">{b.address} · {b.postal_code} {b.city} {b.province} {b.country}</div>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Ragione Sociale" required><Input value={data.company_name} onChange={set("company_name")} className="rounded-sm h-11" /></Field>
        <Field label="Riferimento (opzionale)"><Input value={data.reference} onChange={set("reference")} className="rounded-sm h-11" /></Field>
        <Field label="Indirizzo" required className="sm:col-span-2"><Input value={data.address} onChange={set("address")} className="rounded-sm h-11" /></Field>
        <Field label="Nazione" required>
          <Select value={cc} onValueChange={handleCountryChange}>
            <SelectTrigger className="rounded-sm h-11 bg-white"><SelectValue placeholder="Seleziona nazione" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {COUNTRIES.map(c => (
                <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="CAP / Codice Postale" required><Input value={data.postal_code} onChange={set("postal_code")} onBlur={(e) => lookupCap(e.target.value)} className="rounded-sm h-11" placeholder={cc === "IE" ? "es. D02 XY45" : cc === "IT" ? "es. 20121" : ""} /></Field>
        <Field label="Città" required className={showProvince ? "" : "sm:col-span-2"}><Input value={data.city} onChange={set("city")} className="rounded-sm h-11" /></Field>
        {showProvince && (
          <Field label={cc === "IT" ? "Provincia (sigla, es. MI)" : "Stato / Provincia (2 lettere)"}>
            <Input value={data.province || ""} maxLength={2} onChange={(e) => setData({ ...data, province: e.target.value.toUpperCase() })} className="rounded-sm h-11" placeholder={cc === "IT" ? "MI" : "NY"} />
          </Field>
        )}
        <Field label="Email (opzionale)"><Input type="email" value={data.email} onChange={set("email")} className="rounded-sm h-11" /></Field>
        <Field label="Telefono (opzionale)"><Input value={data.phone} onChange={set("phone")} className="rounded-sm h-11" /></Field>
      </div>
    </div>
  );
}

function Field({ label, required, className = "", children }) {
  return (
    <div className={className}>
      <Label className="label-caps">{label}{required && <span className="text-orange-600">*</span>}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
