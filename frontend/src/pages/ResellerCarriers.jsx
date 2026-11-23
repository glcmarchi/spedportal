import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Key, CheckCircle, ShieldCheck, Lock } from "@phosphor-icons/react";

export default function ResellerCarriers() {
  const [carriers, setCarriers] = useState([]);
  const [fee, setFee] = useState(0);
  const [drafts, setDrafts] = useState({});

  const load = () => {
    api.get("/reseller/carriers").then(r => {
      setCarriers(r.data.carriers || []);
      setFee(r.data.per_shipment_fee || 0);
      const d = {};
      (r.data.carriers || []).forEach(c => {
        d[c.carrier_id] = { ...(c.own_config?.values || {}) };
      });
      setDrafts(d);
    }).catch(() => toast.error("Errore caricamento corrieri"));
  };

  useEffect(() => { load(); }, []);

  const save = async (c) => {
    try {
      await api.put(`/reseller/carriers/${c.carrier_id}`, { values: drafts[c.carrier_id] || {} });
      toast.success(`Credenziali ${c.name} salvate`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore salvataggio");
    }
  };

  const authenticate = async (c) => {
    try {
      await api.put(`/reseller/carriers/${c.carrier_id}`, { values: drafts[c.carrier_id] || {} });
      await api.post(`/reseller/carriers/${c.carrier_id}/authenticate`);
      toast.success(`Account ${c.name} verificato e attivo!`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore verifica account");
    }
  };

  const setDefault = async (cid, src) => {
    try {
      await api.patch(`/reseller/carriers/${cid}/default`, { default_source: src });
      toast.success("Contratto predefinito aggiornato");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Impossibile cambiare il default");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="label-caps text-orange-600 mb-1 flex items-center gap-1.5"><Key size={14} weight="fill" /> Contratti Corrieri</div>
        <h1 className="text-4xl font-black tracking-tighter text-slate-900" style={{ fontFamily: "Chivo" }}>I Miei Corrieri</h1>
        <p className="text-sm text-slate-500 mt-1">
          Configura i tuoi codici contrattuali sui corrieri abilitati (fee piattaforma per spedizioni su codice proprio: <b>€ {Number(fee).toFixed(2)}</b>).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {carriers.map(c => {
          const own = c.own_config || {};
          const draft = drafts[c.carrier_id] || {};
          const isVerified = own.status === "verified";

          return (
            <div key={c.carrier_id} className="bg-white border border-slate-200 rounded-sm p-5 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-black text-xl" style={{ fontFamily: "Chivo" }}>{c.name}</div>
                  <div className="text-xs text-slate-500">
                    Modalità: <b>{c.policy === "hybrid" ? "Ibrido (Tuo codice + Piattaforma)" : c.policy === "reseller_only" ? "Solo Tuo Codice" : "Contratto Piattaforma"}</b>
                  </div>
                </div>
                {c.can_configure_own ? (
                  isVerified ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold bg-green-100 text-green-800 px-2.5 py-1 rounded-sm">
                      <CheckCircle size={14} weight="fill" /> Attivo ({own.primary_code})
                    </span>
                  ) : (
                    <span className="text-xs font-bold bg-amber-100 text-amber-800 px-2.5 py-1 rounded-sm">Non configurato</span>
                  )
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-sm">
                    <Lock size={13} /> Gestito da Piattaforma
                  </span>
                )}
              </div>

              {c.policy === "hybrid" && (
                <div className="bg-slate-50 border border-slate-200 rounded-sm p-3 flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-slate-700">Contratto Default:</span>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant={c.default_source === "admin" ? "default" : "outline"}
                      onClick={() => setDefault(c.carrier_id, "admin")}
                      className={`h-7 text-xs rounded-sm ${c.default_source === "admin" ? "bg-slate-900" : ""}`}>
                      Piattaforma
                    </Button>
                    <Button size="sm" variant={c.default_source === "reseller" ? "default" : "outline"}
                      disabled={!isVerified}
                      onClick={() => setDefault(c.carrier_id, "reseller")}
                      className={`h-7 text-xs rounded-sm ${c.default_source === "reseller" ? "bg-orange-600 hover:bg-orange-700" : ""}`}>
                      Il Mio Codice
                    </Button>
                  </div>
                </div>
              )}

              {c.can_configure_own ? (
                <>
                  {c.auth_note && (
                    <div className="text-xs bg-blue-50 border border-blue-100 text-blue-800 p-2.5 rounded-sm">{c.auth_note}</div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {c.fields.map(f => (
                      <div key={f.key}>
                        <Label className="label-caps">{f.label}{f.required && "*"}</Label>
                        <Input
                          type={f.type === "password" ? "password" : "text"}
                          value={draft[f.key] || ""}
                          onChange={(e) => setDrafts({ ...drafts, [c.carrier_id]: { ...draft, [f.key]: e.target.value } })}
                          className="mt-1 rounded-sm h-9 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end pt-1">
                    {c.auth_type === "account_link" ? (
                      <Button onClick={() => authenticate(c)} className="bg-slate-900 hover:bg-slate-800 rounded-sm h-9 text-xs">
                        <ShieldCheck size={15} className="mr-1.5" /> Salva & Autentica Account
                      </Button>
                    ) : (
                      <Button onClick={() => save(c)} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-9 text-xs">
                        Salva Credenziali
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-xs text-slate-500">
                  Questo corriere utilizza automaticamente il contratto centrale fornito dall'amministratore.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
