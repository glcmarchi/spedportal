import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COUNTRIES, PROVINCE_COUNTRIES, CountryFlag } from "@/pages/NewShipment";
import { toast } from "sonner";
import {
  Lightning, Plus, X, ArrowRight, FileText, Cube, Package,
} from "@phosphor-icons/react";

const QUICK_PRESETS = [
  { id: "busta_documenti", label: "Busta Docs 0,5 kg", category: "documents", parcel_type: "busta_documenti", length: 35, width: 25, height: 2, weight: 0.5 },
  { id: "pacco_s", label: "Pacco S · 2 kg", category: "goods", parcel_type: "pacco", length: 25, width: 20, height: 15, weight: 2 },
  { id: "pacco_m", label: "Pacco M · 5 kg", category: "goods", parcel_type: "pacco", length: 40, width: 30, height: 20, weight: 5 },
  { id: "pacco_l", label: "Pacco L · 10 kg", category: "goods", parcel_type: "pacco", length: 50, width: 40, height: 30, weight: 10 },
];

export default function QuickQuote() {
  const nav = useNavigate();
  const location = useLocation();
  const dashPreset = location.state || null;

  const { user } = useAuth();
  const isResellerOrAdmin = ["reseller_admin", "super_admin", "admin"].includes(user?.role);
  const enabledSurcharges = user?.enabled_surcharges || {
    insurance: true, cod: true, saturday_delivery: true, neutral_delivery: true, residential_delivery: true,
  };

  const [fromCountry, setFromCountry] = useState("IT");
  const [fromCap, setFromCap] = useState("");
  const [fromCity, setFromCity] = useState("");
  const [fromProv, setFromProv] = useState("");

  const [toCountry, setToCountry] = useState(dashPreset?.presetDestCountry || "IT");
  const [toCap, setToCap] = useState(dashPreset?.presetDestCap || "");
  const [toCity, setToCity] = useState("");
  const [toProv, setToProv] = useState("");
  const [toCityOptions, setToCityOptions] = useState([]);

  const [category, setCategory] = useState("goods");
  const [parcelType, setParcelType] = useState("pacco");
  const [parcels, setParcels] = useState([
    { length: 30, width: 20, height: 15, weight: dashPreset?.presetWeight || 1 },
  ]);
  const [savedParcels, setSavedParcels] = useState([]);

  const [residential, setResidential] = useState(false);
  const [insurance, setInsurance] = useState(false);
  const [insuranceVal, setInsuranceVal] = useState(100);
  const [cod, setCod] = useState(false);
  const [codAmount, setCodAmount] = useState(50);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const ra = user?.reseller_address || {};
    if (ra.country) setFromCountry(ra.country.toUpperCase());
    if (ra.postal_code) setFromCap(ra.postal_code);
    if (ra.city) setFromCity(ra.city);
    if (ra.province) setFromProv(ra.province);
  }, [user]);

  useEffect(() => {
    api.get("/parcels").then((r) => {
      const list = r.data || [];
      setSavedParcels(list);
      if (!dashPreset?.presetWeight) {
        const def = list.find((p) => p.is_default);
        if (def) {
          setParcelType("pacco");
          setParcels([{ length: def.length, width: def.width, height: def.height, weight: def.weight }]);
        }
      }
    }).catch(() => {});
  }, [dashPreset]);

  useEffect(() => {
    if (dashPreset?.presetDestCap) {
      lookupCap("to", dashPreset.presetDestCap, dashPreset.presetDestCountry || "IT");
    }
  }, [dashPreset]);

  const lookupCap = async (side, capVal, countryCode) => {
    const cleanCap = (capVal || "").trim();
    if (!cleanCap) return;
    try {
      const cc = (countryCode || "IT").toUpperCase();
      const r = await api.get(`/geo/lookup?country=${cc}&cap=${encodeURIComponent(cleanCap)}`);
      if (r.data?.valid === false) {
        toast.warning(`Il CAP "${cleanCap}" non risulta valido per ${cc}`);
      }
      if (side === "from") {
        setFromCity(r.data?.city || "");
        setFromProv(PROVINCE_COUNTRIES.has(cc) ? (r.data?.province || "") : "");
      } else {
        const list = r.data?.cities || (r.data?.city ? [r.data.city] : []);
        setToCityOptions(list);
        setToCity(r.data?.city || "");
        setToProv(PROVINCE_COUNTRIES.has(cc) ? (r.data?.province || "") : "");
      }
    } catch {}
  };

  const applyPreset = (pr) => {
    setCategory(pr.category);
    setParcelType(pr.parcel_type);
    setParcels([{ length: pr.length, width: pr.width, height: pr.height, weight: pr.weight }]);
  };

  const calculate = async () => {
    if (!fromCap.trim() || !toCap.trim()) {
      toast.error("Inserisci almeno il CAP di partenza e quello di destinazione");
      return;
    }
    if (parcels.some((p) => p.length <= 0 || p.width <= 0 || p.height <= 0 || p.weight <= 0)) {
      toast.error("Verifica dimensioni e peso dei colli");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        sender: {
          company_name: user?.reseller_address?.company_name || user?.company_name || "Mittente",
          address: user?.reseller_address?.address || "Via Principale 1",
          postal_code: fromCap.trim(),
          city: fromCity.trim() || "Città",
          province: PROVINCE_COUNTRIES.has(fromCountry) ? (fromProv || "") : "",
          country: fromCountry,
        },
        recipient: {
          company_name: "Destinatario",
          address: "Via Destinazione 1",
          postal_code: toCap.trim(),
          city: toCity.trim() || "Città",
          province: PROVINCE_COUNTRIES.has(toCountry) ? (toProv || "") : "",
          country: toCountry,
        },
        shipment_category: category,
        parcel_type: parcelType,
        parcels,
        goods_description: category === "documents" ? "Documenti" : "Merce",
        customs: { required: false, incoterms: "DAP", customs_value: 0, customs_currency: "EUR" },
        services: {
          insurance: category !== "documents" && insurance,
          insurance_value: insurance ? (parseFloat(insuranceVal) || 0) : 0,
          neutral_delivery: false,
          cod,
          cod_amount: cod ? (parseFloat(codAmount) || 0) : 0,
          saturday_delivery: false,
          residential_delivery: residential,
        },
      };
      const r = await api.post("/shipments/quote", payload);
      setResult(r.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore calcolo preventivo");
    } finally {
      setLoading(false);
    }
  };

  const convertToShipment = (quoteOption) => {
    const ra = user?.reseller_address || {};
    nav("/shipments/new", {
      state: {
        fromQuickQuote: true,
        sender: {
          company_name: ra.company_name || user?.company_name || "",
          address: ra.address || "",
          postal_code: fromCap.trim(),
          city: fromCity.trim(),
          province: fromProv,
          country: fromCountry,
          reference: "",
          email: ra.email || user?.email || "",
          phone: ra.phone || user?.phone || "",
        },
        recipient: {
          company_name: "",
          address: "",
          postal_code: toCap.trim(),
          city: toCity.trim(),
          province: toProv,
          country: toCountry,
          reference: "",
          email: "",
          phone: "",
        },
        shipment_category: category,
        parcel_type: parcelType,
        parcels,
        services: {
          insurance: category !== "documents" && insurance,
          insurance_value: insurance ? (parseFloat(insuranceVal) || 0) : 0,
          neutral_delivery: false,
          cod,
          cod_amount: cod ? (parseFloat(codAmount) || 0) : 0,
          saturday_delivery: false,
          residential_delivery: residential,
        },
        preselectedQuote: quoteOption,
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="label-caps text-orange-600 mb-1 flex items-center gap-1.5">
          <Lightning size={14} weight="fill" /> Calcolo Immediato
        </div>
        <h1 className="text-4xl font-black tracking-tighter text-slate-900" style={{ fontFamily: "Chivo" }}>
          Preventivo Rapido
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Inserisci CAP di destinazione e misure del collo per confrontare subito tutte le tariffe in 2 clic.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-sm p-6 space-y-5">
        {/* Partenza & Destinazione affiancati */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Partenza */}
          <div className="bg-slate-50 border border-slate-200 rounded-sm p-4 space-y-3">
            <div className="label-caps text-slate-700">1. Partenza (Mittente)</div>
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-5">
                <Label className="label-caps text-[10px]">Nazione</Label>
                <div className="flex items-center gap-1.5 mt-1">
                  <CountryFlag code={fromCountry} />
                  <Select
                    value={fromCountry}
                    onValueChange={(v) => {
                      setFromCountry(v);
                      setFromCap("");
                      setFromCity("");
                      setFromProv("");
                    }}
                  >
                    <SelectTrigger className="h-10 rounded-sm bg-white text-xs flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          <span className="inline-flex items-center gap-2">
                            <CountryFlag code={c.code} />
                            <span>{c.name} ({c.code})</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="col-span-3">
                <Label className="label-caps text-[10px]">CAP*</Label>
                <Input
                  value={fromCap}
                  onChange={(e) => setFromCap(e.target.value)}
                  onBlur={(e) => lookupCap("from", e.target.value, fromCountry)}
                  placeholder="20121"
                  className="mt-1 h-10 rounded-sm bg-white text-xs"
                />
              </div>
              <div className="col-span-4">
                <Label className="label-caps text-[10px]">Città</Label>
                <Input
                  value={fromCity}
                  onChange={(e) => setFromCity(e.target.value)}
                  placeholder="Milano"
                  className="mt-1 h-10 rounded-sm bg-white text-xs"
                />
              </div>
            </div>
          </div>

          {/* Destinazione */}
          <div className="bg-orange-50/40 border border-orange-200 rounded-sm p-4 space-y-3">
            <div className="label-caps text-orange-800">2. Destinazione</div>
            <div className="grid grid-cols-12 gap-2">
              <div className={PROVINCE_COUNTRIES.has(toCountry) ? "col-span-4" : "col-span-5"}>
                <Label className="label-caps text-[10px]">Nazione</Label>
                <div className="flex items-center gap-1.5 mt-1">
                  <CountryFlag code={toCountry} />
                  <Select
                    value={toCountry}
                    onValueChange={(v) => {
                      setToCountry(v);
                      setToCap("");
                      setToCity("");
                      setToProv("");
                      setToCityOptions([]);
                    }}
                  >
                    <SelectTrigger className="h-10 rounded-sm bg-white text-xs flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          <span className="inline-flex items-center gap-2">
                            <CountryFlag code={c.code} />
                            <span>{c.name} ({c.code})</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="col-span-3">
                <Label className="label-caps text-[10px]">CAP*</Label>
                <Input
                  value={toCap}
                  onChange={(e) => setToCap(e.target.value)}
                  onBlur={(e) => lookupCap("to", e.target.value, toCountry)}
                  placeholder="00100"
                  className="mt-1 h-10 rounded-sm bg-white text-xs"
                />
              </div>
              <div className={PROVINCE_COUNTRIES.has(toCountry) ? "col-span-3" : "col-span-4"}>
                <Label className="label-caps text-[10px]">Città</Label>
                <Input
                  value={toCity}
                  onChange={(e) => setToCity(e.target.value)}
                  placeholder="Roma"
                  className="mt-1 h-10 rounded-sm bg-white text-xs"
                />
              </div>
              {PROVINCE_COUNTRIES.has(toCountry) && (
                <div className="col-span-2">
                  <Label className="label-caps text-[10px]">Prov/St</Label>
                  <Input
                    maxLength={2}
                    value={toProv}
                    onChange={(e) => setToProv(e.target.value.toUpperCase())}
                    placeholder={toCountry === "IT" ? "RM" : "NY"}
                    className="mt-1 h-10 rounded-sm bg-white text-xs text-center"
                  />
                </div>
              )}
            </div>
            {toCityOptions.length > 1 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[11px] text-slate-500">Località:</span>
                {toCityOptions.map((cn) => (
                  <button
                    type="button"
                    key={cn}
                    onClick={() => setToCity(cn)}
                    className={`text-[11px] px-2 py-0.5 rounded-sm border font-semibold ${
                      toCity.toLowerCase() === cn.toLowerCase() ? "bg-orange-600 text-white border-orange-600" : "bg-white text-slate-700 border-slate-200"
                    }`}
                  >
                    {cn}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tipologia + Preset rapidi */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setCategory("goods"); setParcelType("pacco"); }}
              className={`inline-flex items-center gap-1.5 px-3.5 h-9 rounded-sm text-xs font-bold border ${
                category === "goods" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200"
              }`}
            >
              <Cube size={15} weight="fill" /> Merce / Colli
            </button>
            <button
              type="button"
              onClick={() => {
                setCategory("documents");
                setParcelType("busta_documenti");
                setParcels([{ length: 35, width: 25, height: 2, weight: 0.5 }]);
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 h-9 rounded-sm text-xs font-bold border ${
                category === "documents" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200"
              }`}
            >
              <FileText size={15} weight="fill" /> Documenti
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {QUICK_PRESETS.map((pr) => (
              <button
                type="button"
                key={pr.id}
                onClick={() => applyPreset(pr)}
                className="text-xs bg-slate-100 hover:bg-orange-100 text-slate-800 px-2.5 py-1.5 rounded-sm font-semibold"
              >
                {pr.label}
              </button>
            ))}
            {savedParcels.map((sp) => (
              <button
                type="button"
                key={sp.id}
                onClick={() => {
                  setCategory("goods");
                  setParcelType("pacco");
                  setParcels([{ length: sp.length, width: sp.width, height: sp.height, weight: sp.weight }]);
                }}
                className="text-xs bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-200 px-2.5 py-1.5 rounded-sm font-semibold"
              >
                {sp.name} ({sp.weight}kg)
              </button>
            ))}
          </div>
        </div>

        {/* Colli compatti */}
        <div className="space-y-2">
          {parcels.map((p, idx) => (
            <div key={idx} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end bg-slate-50 border border-slate-200 rounded-sm p-3">
              <div className="sm:col-span-2 text-xs font-bold text-slate-600 self-center">Collo #{idx + 1}</div>
              <div className="sm:col-span-2">
                <Label className="label-caps text-[10px]">Lung. (cm)</Label>
                <Input type="number" min="1" value={p.length} onChange={(e) => {
                  const np = [...parcels]; np[idx] = { ...np[idx], length: Math.max(0, parseFloat(e.target.value) || 0) }; setParcels(np);
                }} className="mt-1 h-9 rounded-sm bg-white text-xs" />
              </div>
              <div className="sm:col-span-2">
                <Label className="label-caps text-[10px]">Larg. (cm)</Label>
                <Input type="number" min="1" value={p.width} onChange={(e) => {
                  const np = [...parcels]; np[idx] = { ...np[idx], width: Math.max(0, parseFloat(e.target.value) || 0) }; setParcels(np);
                }} className="mt-1 h-9 rounded-sm bg-white text-xs" />
              </div>
              <div className="sm:col-span-2">
                <Label className="label-caps text-[10px]">Prof. (cm)</Label>
                <Input type="number" min="1" value={p.height} onChange={(e) => {
                  const np = [...parcels]; np[idx] = { ...np[idx], height: Math.max(0, parseFloat(e.target.value) || 0) }; setParcels(np);
                }} className="mt-1 h-9 rounded-sm bg-white text-xs" />
              </div>
              <div className="sm:col-span-3">
                <Label className="label-caps text-[10px]">Peso (kg)</Label>
                <Input type="number" min="0.1" step="0.1" value={p.weight} onChange={(e) => {
                  const np = [...parcels]; np[idx] = { ...np[idx], weight: Math.max(0, parseFloat(e.target.value) || 0) }; setParcels(np);
                }} className="mt-1 h-9 rounded-sm bg-white text-xs font-bold" />
              </div>
              <div className="sm:col-span-1 flex justify-end">
                {parcels.length > 1 && (
                  <button type="button" onClick={() => setParcels(parcels.filter((_, x) => x !== idx))} className="text-slate-400 hover:text-red-600 p-1.5">
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => setParcels([...parcels, { ...parcels[0] }])} className="rounded-sm">
              <Plus size={14} className="mr-1" /> Aggiungi collo
            </Button>

            {/* Opzioni rapide */}
            <div className="flex flex-wrap items-center gap-4 text-xs">
              {enabledSurcharges.residential_delivery !== false && (
                <label className="flex items-center gap-1.5 cursor-pointer font-semibold">
                  <Checkbox checked={residential} onCheckedChange={(v) => setResidential(!!v)} /> Privato / Residenziale
                </label>
              )}
              {enabledSurcharges.insurance !== false && category !== "documents" && (
                <div className="flex items-center gap-1.5">
                  <label className="flex items-center gap-1.5 cursor-pointer font-semibold">
                    <Checkbox checked={insurance} onCheckedChange={(v) => setInsurance(!!v)} /> Assicurazione
                  </label>
                  {insurance && (
                    <Input type="number" min="1" value={insuranceVal} onChange={(e) => setInsuranceVal(e.target.value)} className="w-20 h-7 text-xs rounded-sm" placeholder="€" />
                  )}
                </div>
              )}
              {enabledSurcharges.cod !== false && (
                <div className="flex items-center gap-1.5">
                  <label className="flex items-center gap-1.5 cursor-pointer font-semibold">
                    <Checkbox checked={cod} onCheckedChange={(v) => setCod(!!v)} /> Contrassegno
                  </label>
                  {cod && (
                    <Input type="number" min="1" value={codAmount} onChange={(e) => setCodAmount(e.target.value)} className="w-20 h-7 text-xs rounded-sm" placeholder="€" />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-200">
          <Button onClick={calculate} disabled={loading} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11 px-8 text-sm font-bold">
            <Lightning size={16} weight="fill" className="mr-2" />
            {loading ? "Calcolo tariffe…" : "Calcola Tariffe Subito"}
          </Button>
        </div>
      </div>

      {/* Risultati Preventivo */}
      {result && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-xl font-black tracking-tight" style={{ fontFamily: "Chivo" }}>
              Tariffe Disponibili ({result.quotes.length})
            </h2>
            <div className="text-xs text-slate-600">
              Zona: <b>{result.zone}</b> · Peso tassato: <b>{result.billed_weight} kg</b>
            </div>
          </div>

          {result.warnings?.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-sm p-3 text-xs space-y-1">
              {result.warnings.map((w, idx) => <div key={idx}>• {w}</div>)}
            </div>
          )}

          {result.quotes.map((q, idx) => (
            <div key={q.option_key || `${q.carrier_id}:${idx}`} className="bg-white border border-slate-200 hover:border-orange-500 rounded-sm p-4 transition-all">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-sm flex items-center justify-center font-black text-white shrink-0" style={{ backgroundColor: q.color, fontFamily: "Chivo" }}>
                    {q.carrier_name.slice(0, 3).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900">{q.carrier_name}</span>
                      {idx === 0 && <span className="text-[10px] font-black uppercase bg-orange-100 text-orange-800 px-2 py-0.5 rounded-sm">Miglior Prezzo</span>}
                      {isResellerOrAdmin && q.is_live && (
                        <span className="text-[10px] font-bold bg-green-100 text-green-800 px-1.5 py-0.5 rounded-sm">API REALE</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      Consegna stimata: <b>{q.transit_days} {q.transit_days === 1 ? "giorno" : "giorni"} lav.</b>
                      {q.commit_hint && <span className="text-slate-500"> · {q.commit_hint}</span>}
                    </div>
                    {isResellerOrAdmin && q.reseller_base_freight !== undefined && (
                      <div className="text-[11px] text-slate-500 mt-1">
                        Nolo € {q.reseller_base_freight.toFixed(2)} + Suppl. € {(q.reseller_surcharges_total ?? 0).toFixed(2)} + Comm. Piatt. € {Number(q.platform_fee || 0).toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-3 sm:pt-0">
                  <div className="text-left sm:text-right">
                    <div className="text-2xl font-black text-slate-900" style={{ fontFamily: "Chivo" }}>€ {q.price.toFixed(2)}</div>
                    <div className="text-[10px] text-slate-400">IVA esclusa</div>
                  </div>
                  <Button onClick={() => convertToShipment(q)} className="bg-slate-900 hover:bg-orange-600 text-white rounded-sm h-10 text-xs font-bold">
                    <Package size={15} className="mr-1.5" weight="fill" /> Spedisci <ArrowRight size={14} className="ml-1" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
