import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Percent, Plus, PencilSimple, Trash } from "@phosphor-icons/react";

const ALL_CARRIER_IDS = ["brt", "gls", "dhl", "ups", "tnt", "poste"];
const CARRIER_LABELS = {
  brt: "BRT",
  gls: "GLS Italy",
  dhl: "DHL Express",
  ups: "UPS",
  tnt: "FedEx / TNT",
  poste: "Poste Italiane / SDA",
};

const emptyRule = (val = 20) => ({
  mode: "flat",
  flat: val,
  domestic: val,
  europe: val,
  world: val,
});

function buildDefaultMarkups(val = 20) {
  const out = {};
  ALL_CARRIER_IDS.forEach((cid) => {
    out[cid] = emptyRule(val);
  });
  return out;
}

export default function AdminRates() {
  const { user } = useAuth();
  const [tables, setTables] = useState([]);
  const [enabledCarriers, setEnabledCarriers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [markups, setMarkups] = useState(buildDefaultMarkups(20));
  const [bulkPct, setBulkPct] = useState("20");

  const load = async () => {
    try {
      const r = await api.get("/admin/rate-tables");
      setTables(r.data);
    } catch {}
    if (user?.role === "reseller_admin") {
      try {
        const rc = await api.get("/reseller/carriers");
        setEnabledCarriers(rc.data?.carriers || []);
      } catch {
        setEnabledCarriers(ALL_CARRIER_IDS.map((cid) => ({ carrier_id: cid, name: CARRIER_LABELS[cid] })));
      }
    } else {
      setEnabledCarriers(ALL_CARRIER_IDS.map((cid) => ({ carrier_id: cid, name: CARRIER_LABELS[cid] })));
    }
  };

  useEffect(() => {
    load();
  }, [user]);

  const visibleCarrierIds = enabledCarriers.length > 0
    ? enabledCarriers.map((c) => c.carrier_id)
    : ALL_CARRIER_IDS;

  const startNew = () => {
    setEditing(null);
    setName("");
    setMarkups(buildDefaultMarkups(20));
    setBulkPct("20");
    setOpen(true);
  };

  const startEdit = (t) => {
    setEditing(t);
    setName(t.name || "");
    const base = buildDefaultMarkups(20);
    const existing = t.carrier_markups || {};
    ALL_CARRIER_IDS.forEach((cid) => {
      if (existing[cid]) {
        base[cid] = { ...emptyRule(20), ...existing[cid] };
      }
    });
    setMarkups(base);
    setOpen(true);
  };

  const updateRule = (cid, patch) => {
    setMarkups((prev) => ({
      ...prev,
      [cid]: { ...prev[cid], ...patch },
    }));
  };

  const applyAllFlat = () => {
    const val = Math.max(0, parseFloat(bulkPct) || 0);
    setMarkups(buildDefaultMarkups(val));
    toast.success(`Applicato +${val}% a tutti i corrieri`);
  };

  const save = async () => {
    if (!name.trim()) {
      toast.error("Inserisci il nome del profilo margini");
      return;
    }
    try {
      const payload = { name: name.trim(), carrier_markups: markups };
      if (editing) {
        await api.put(`/admin/rate-tables/${editing.id}`, payload);
      } else {
        await api.post("/admin/rate-tables", payload);
      }
      toast.success("Profilo margini salvato");
      setOpen(false);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore salvataggio");
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Eliminare questo profilo margini?")) return;
    await api.delete(`/admin/rate-tables/${id}`);
    toast.success("Profilo eliminato");
    load();
  };

  const formatRuleBadge = (r) => {
    if (!r) return "+20%";
    if (r.mode === "area") {
      return `IT +${r.domestic}% · UE +${r.europe}% · Mondo +${r.world}%`;
    }
    return `+${r.flat}% (Tutte le aree)`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="label-caps text-orange-600 mb-1 flex items-center gap-2">
            <Percent size={14} weight="fill" /> Marginalità Clienti
          </div>
          <h1 className="text-4xl font-black tracking-tighter text-slate-900" style={{ fontFamily: "Chivo" }}>
            Profili Margini Corrieri
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Crea i tuoi profili di ricarico (es. <i>Tutto +20%</i> oppure differenziati per Italia, Europa e Mondo) da abbinare ai sub-clienti.
          </p>
        </div>
        <Button onClick={startNew} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11">
          <Plus size={16} className="mr-2" /> Nuovo Profilo Margini
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tables.map((t) => (
          <div key={t.id} className="bg-white border border-slate-200 rounded-sm p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-xl font-bold text-slate-900" style={{ fontFamily: "Chivo" }}>{t.name}</h2>
                <div className="text-xs text-slate-400">Creato il {t.created_at?.slice(0, 10)}</div>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" onClick={() => startEdit(t)} className="rounded-sm h-8">
                  <PencilSimple size={14} className="mr-1" /> Modifica
                </Button>
                <Button size="sm" variant="outline" onClick={() => remove(t.id)} className="rounded-sm h-8 text-red-600 hover:text-red-700">
                  <Trash size={14} />
                </Button>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
              {visibleCarrierIds.map((cid) => (
                <div key={cid} className="flex items-center justify-between py-1 border-b border-slate-50 last:border-0">
                  <span className="font-semibold text-slate-800">{CARRIER_LABELS[cid] || cid.toUpperCase()}</span>
                  <span className="font-mono font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-sm">
                    {formatRuleBadge(t.carrier_markups?.[cid])}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {tables.length === 0 && (
          <div className="col-span-full bg-white border border-slate-200 rounded-sm p-10 text-center text-slate-500 text-sm">
            Nessun profilo margini configurato. Clicca su <b>Nuovo Profilo Margini</b> per crearne uno.
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-sm">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Chivo" }}>
              {editing ? "Modifica Profilo Margini" : "Nuovo Profilo Margini"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <div>
              <Label className="label-caps">Nome Profilo (es. Tutto +20%, Listino Standard)*</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="es. Tutto +20%"
                className="mt-1 rounded-sm h-10"
              />
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-sm p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-700">
                <b>Impostazione rapida:</b> applica la stessa percentuale unica a tutti i corrieri
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={bulkPct}
                  onChange={(e) => setBulkPct(e.target.value)}
                  className="w-24 h-9 rounded-sm bg-white text-right font-mono"
                />
                <span className="text-xs font-bold">%</span>
                <Button type="button" size="sm" variant="outline" onClick={applyAllFlat} className="h-9 rounded-sm">
                  Applica a tutti
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {visibleCarrierIds.map((cid) => {
                const rule = markups[cid] || emptyRule(20);
                return (
                  <div key={cid} className="border border-slate-200 rounded-sm p-3.5 bg-white space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="font-bold text-slate-900">{CARRIER_LABELS[cid] || cid.toUpperCase()}</div>
                      <Select
                        value={rule.mode}
                        onValueChange={(m) => updateRule(cid, { mode: m })}
                      >
                        <SelectTrigger className="w-56 h-8 rounded-sm text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="flat">Margine unico (tutte le aree)</SelectItem>
                          <SelectItem value="area">Differenziato per Macro-Area</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {rule.mode === "flat" ? (
                      <div className="flex items-center gap-2 max-w-xs">
                        <Label className="label-caps text-[11px] shrink-0">Margine %:</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.5"
                          value={rule.flat}
                          onChange={(e) => {
                            const v = Math.max(0, parseFloat(e.target.value) || 0);
                            updateRule(cid, { flat: v, domestic: v, europe: v, world: v });
                          }}
                          className="h-9 rounded-sm font-mono text-right"
                        />
                        <span className="text-xs font-bold text-slate-500">%</span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label className="label-caps text-[11px]">Italia (Domestico) %</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.5"
                            value={rule.domestic}
                            onChange={(e) => updateRule(cid, { domestic: Math.max(0, parseFloat(e.target.value) || 0) })}
                            className="mt-1 h-9 rounded-sm font-mono text-right"
                          />
                        </div>
                        <div>
                          <Label className="label-caps text-[11px]">Europa (UE) %</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.5"
                            value={rule.europe}
                            onChange={(e) => updateRule(cid, { europe: Math.max(0, parseFloat(e.target.value) || 0) })}
                            className="mt-1 h-9 rounded-sm font-mono text-right"
                          />
                        </div>
                        <div>
                          <Label className="label-caps text-[11px]">Mondo (Extra-UE) %</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.5"
                            value={rule.world}
                            onChange={(e) => updateRule(cid, { world: Math.max(0, parseFloat(e.target.value) || 0) })}
                            className="mt-1 h-9 rounded-sm font-mono text-right"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <Button variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Annulla</Button>
              <Button onClick={save} className="bg-orange-600 hover:bg-orange-700 rounded-sm">Salva Profilo</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
