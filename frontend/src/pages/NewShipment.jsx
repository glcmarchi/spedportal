import React, { useState, useEffect, useMemo } from "react";
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
import {
  ArrowLeft, ArrowRight, Package, Plus, X, Printer, CheckCircle,
  User, AddressBook, Question, UploadSimple, Warning, FloppyDisk, Eraser,
  MagnifyingGlass, Clock,
} from "@phosphor-icons/react";

export const COUNTRIES = [
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

export const PROVINCE_COUNTRIES = new Set(["IT", "US", "CA", "AU"]);

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
    hs_code: "",
    customs_value: 100,
    customs_currency: "EUR",
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
  const [transitInfo, setTransitInfo] = useState(null);
  const [loadingTransit, setLoadingTransit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(null);
  const [addressbook, setAddressbook] = useState([]);
  const [savedParcels, setSavedParcels] = useState([]);

  const destCountry = (recipient.country || "IT").toUpperCase();
  const isExtraEu = destCountry.length === 2 && !EU_COUNTRIES.has(destCountry);

  useEffect(() => {
    setCustoms(c => ({ ...c, required: isExtraEu, incoterms: allowDdp ? c.incoterms : "DAP" }));
  }, [isExtraEu, allowDdp]);

  const reloadBook = () => {
    if (features.address_book !== false) {
      api.get("/addressbook").then(r => setAddressbook(r.data)).catch(() => {});
    }
  };

  useEffect(() => {
    reloadBook();
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

  const getOptKey = (q) => q.option_key || `${q.carrier_id}:${q.service_type || ""}`;

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

  const handleCheckTransit = async () => {
    setLoadingTransit(true);
    try {
      const r = await api.post("/shipments/transit-times", buildBody());
      const list = r.data?.services || [];
      setTransitInfo(list);
      if (list.length === 0) {
        toast.info("Nessun dettaglio cut-off aggiuntivo restituito per questa tratta.");
      }
    } catch {
      toast.error("Errore verifica tempi di resa");
    } finally {
      setLoadingTransit(false);
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
    if (isExtraEu && !goods.trim()) {
      toast.error("Inserisci la descrizione della merce (obbligatoria per spedizioni Extra-UE)");
      setStep(2);
      return;
    }
    if (isExtraEu && !customs.proforma_name?.trim()) {
      toast.error("Per spedizioni Extra-UE è obbligatorio caricare la Fattura Proforma / Commerciale");
      return;
    }
    if (isExtraEu && (!customs.customs_value || customs.customs_value <= 0)) {
      toast.error("Inserisci un valore doganale dichiarato maggiore di 0");
      return;
    }
    setLoading(true); setChosen(null); setAddrCheck(null); setTransitInfo(null);
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
      const r = await api.post("/shipments", {
        quote: buildBody(),
        carrier_id: chosen.carrier_id,
        service_type: chosen.service_type || "",
        expect_live: !!chosen.is_live,
      });
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
    if (step === 2) {
      const validParcels = parcels.length > 0 && parcels.every(p => p.length > 0 && p.width > 0 && p.height > 0 && p.weight > 0);
      if (!validParcels) return false;
      if (isExtraEu && !goods.trim()) return false;
      return true;
    }
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
        {step === 0 && (
          <AddressForm
            title="Dati Mittente"
            data={sender}
            setData={setSender}
            addressbook={addressbook}
            onSavedToBook={reloadBook}
            canSaveToBook={features.address_book !== false}
            onClient={loadMyAddress}
          />
        )}
        {step === 1 && (
          <AddressForm
            title="Dati Destinatario"
            data={recipient}
            setData={setRecipient}
            addressbook={addressbook}
            onSavedToBook={reloadBook}
            canSaveToBook={features.address_book !== false}
          />
        )}
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
            <div>
              <Label className="label-caps">
                Descrizione merce {isExtraEu && <span className="text-orange-600">* (obbligatoria per dogana Extra-UE)</span>}
              </Label>
              <Textarea
                value={goods}
                onChange={(e) => setGoods(e.target.value)}
                placeholder={isExtraEu ? "Es. Cotton T-Shirts / Electronic Components (descrizione dettagliata in inglese)" : "Descrizione contenuto del collo"}
                className="mt-1.5 rounded-sm"
                rows={3}
              />
              {isExtraEu && !goods.trim() && (
                <div className="text-xs text-orange-600 font-semibold mt-1">Compila la descrizione della merce per poter proseguire.</div>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "Chivo" }}>Servizi Accessori & Documentazione</h2>

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
                        <Question size={16} weight="fill" /> Guida Dogana, HS & EORI
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-[26rem] text-xs space-y-2 p-4 rounded-sm leading-relaxed">
                      <div className="font-bold text-slate-900 text-sm">Guida Documenti & Dati Doganali Extra-UE</div>
                      <p><b>• DAP (Delivered At Place):</b> dazi e IVA d'importazione sono pagati dal <b>destinatario</b> alla consegna.</p>
                      <p><b>• DDP (Delivered Duty Paid):</b> dazi e IVA d'importazione sono addebitati al <b>mittente</b> (richiede abilitazione espressa).</p>
                      <p><b>• Fattura Commerciale o Proforma (Obbligatoria):</b> documento che descrive la merce, quantità, valore unitario e totale, valuta e paese d'origine.</p>
                      <p><b>• Codice Doganale HS Code (6-10 cifre):</b> codice tariffario internazionale (Harmonized System, es. <i>850440</i> o <i>620342</i>) che identifica la categoria merceologica per calcolare i dazi. Non sempre bloccante in fase di etichetta, ma fondamentale verso USA, UK e Svizzera per evitare fermi in dogana.</p>
                      <p><b>• Codice EORI:</b> codice identificativo dog
