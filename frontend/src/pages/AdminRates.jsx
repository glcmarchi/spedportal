import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, PencilSimple, Trash, X } from "@phosphor-icons/react";

const ZONES = [
  { value: "NAZ", label: "NAZ — Italia (Nazionale)" },
  { value: "UE", label: "UE — Unione Europea (27 Paesi)" },
  { value: "EUR-EXTRA", label: "EUR-EXTRA — Europa Extra-UE (UK, CH, NO…)" },
  { value: "USA-CA", label: "USA-CA — Nord America (USA, Canada, Messico)" },
  { value: "WORLD", label: "WORLD — Resto del Mondo" },
];

const emptyBand = { zone: "NAZ", min_weight: 0, max_weight: 5, markup_percent: 20 };

export default function AdminRates() {
  const [tables, setTables] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [bands, setBands] = useState([{ ...emptyBand }]);

  const load = () => { api.get("/admin/rate-tables").then(r => setTables(r.data)); };
  useEffect(() => { load(); }, []);

  const startNew = () => { setEditing(null); setName(""); setBands([{ ...emptyBand }]); setOpen(true); };
  const startEdit = (t) => { setEditing(t); setName(t.name); setBands(t.bands.length ? t.bands : [{ ...emptyBand }]); setOpen(true); };

  const save = async () => {
    for (const b of bands) {
      if (b.min_weight < 0) {
        toast.error("Il peso minimo non può essere negativo");
        return;
      }
      if (b.max_weight <= b.min_weight) {
        toast.error("Il peso massimo deve essere maggiore del peso minimo");
        return;
      }
    }
    try {
      if (editing) await api.put(`/admin/rate-tables/${editing.id}`, { name, bands });
      else await api.post("/admin/rate-tables", { name, bands });
      toast.success("Listino clienti salvato"); setOpen(false); load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Errore"); }
  };

  const remove = async (id) => { if (window.confirm("Eliminare?")) { await api.delete(`/admin/rate-tables/${id}`); load(); } };
  const setBand = (i, k, v) => {
    const nb = [...bands];
    nb[i] = { ...nb[i], [k]: k === "zone" ? v : Math.max(0, parseFloat(v) || 0) };
    setBands(nb);
  };

  const zoneLabel = (code) => ZONES.find(z => z.value === code)?.label || code;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="label-caps text-orange-600 mb-1">Gestione Agenzia</div>
          <h1 className="text-4xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>Listini Clienti</h1>
          <p className="text-xs text-slate-500 mt-1">Definisci le percentuali di ricarico applicate ai tuoi sub-clienti sopra il tuo costo d'acquisto.</p>
        </div>
        <Button onClick={startNew} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11"><Plus size={16} className="mr-2" /> Nuovo Listino Clienti</Button>
      </div>
      <div className="grid gap-4">
        {tables.map(t => (
          <div key={t.id} className="bg-white border border-slate-200 rounded-sm p-6">
            <div className="flex items-start justify-between mb-4">
              <div><h3 className="text-xl font-bold" style={{ fontFamily: "Chivo" }}>{t.name}</h3></div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => startEdit(t)} className="rounded-sm h-8"><PencilSimple size={14} /></Button>
                <Button size="sm" variant="outline" onClick={() => remove(t.id)} className="rounded-sm h-8"><Trash size={14} /></Button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left label-caps"><tr><th className="py-2">Macro-Zona</th><th>Peso min</th><th>Peso max</th><th>Ricarico Cliente %</th></tr></thead>
              <tbody>
                {t.bands.map((b, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-2 font-semibold">{zoneLabel(b.zone)}</td>
                    <td>{b.min_weight} kg</td>
                    <td>{b.max_weight} kg</td>
                    <td className="font-bold text-orange-600">+{b.markup_percent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl rounded-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle style={{ fontFamily: "Chivo" }}>{editing ? "Modifica" : "Nuovo"} Listino Clienti</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="label-caps">Nome Listino (es. Listino Standard, Listino VIP)</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 rounded-sm h-11" /></div>
            {bands.map((b, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end border border-slate-200 rounded-sm p-3">
                <div className="sm:col-span-5">
                  <Label className="label-caps">Macro-Zona</Label>
                  <Select value={b.zone} onValueChange={(v) => setBand(i, "zone", v)}>
                    <SelectTrigger className="mt-1 rounded-sm h-10 bg-white text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ZONES.map(z => <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2"><Label className="label-caps">Min kg</Label><Input type="number" min="0" step="0.5" value={b.min_weight} onChange={(e) => setBand(i, "min_weight", e.target.value)} className="mt-1 rounded-sm h-10" /></div>
                <div className="sm:col-span-2"><Label className="label-caps">Max kg</Label><Input type="number" min="0.5" step="0.5" value={b.max_weight} onChange={(e) => setBand(i, "max_weight", e.target.value)} className="mt-1 rounded-sm h-10" /></div>
                <div className="sm:col-span-2"><Label className="label-caps">Ricarico %</Label><Input type="number" min="0" step="0.5" value={b.markup_percent} onChange={(e) => setBand(i, "markup_percent", e.target.value)} className="mt-1 rounded-sm h-10" /></div>
                <div className="sm:col-span-1 flex justify-end">{bands.length > 1 && <Button variant="outline" size="sm" onClick={() => setBands(bands.filter((_, x) => x !== i))} className="rounded-sm h-10 w-10 p-0"><X size={14} /></Button>}</div>
              </div>
            ))}
            <Button variant="outline" onClick={() => setBands([...bands, { ...emptyBand }])} className="rounded-sm"><Plus size={14} className="mr-2" /> Aggiungi fascia</Button>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Annulla</Button>
              <Button onClick={save} className="bg-orange-600 hover:bg-orange-700 rounded-sm">Salva Listino</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
