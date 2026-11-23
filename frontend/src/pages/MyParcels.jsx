import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Package, Plus, PencilSimple, Trash, Star } from "@phosphor-icons/react";

export default function MyParcels() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const empty = { name: "", length: 30, width: 20, height: 15, weight: 1, is_default: false };
  const [form, setForm] = useState(empty);

  const load = () => { api.get("/parcels").then(r => setItems(r.data)); };
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      if (editing) await api.put(`/parcels/${editing.id}`, form);
      else await api.post("/parcels", form);
      toast.success("Salvato"); setOpen(false); load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Errore"); }
  };
  const remove = async (id) => { if (window.confirm("Eliminare?")) { await api.delete(`/parcels/${id}`); load(); } };
  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (it) => { setEditing(it); setForm(it); setOpen(true); };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="label-caps text-orange-600 mb-1">Preferiti</div>
          <h1 className="text-4xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>I miei pacchi</h1>
        </div>
        <Button onClick={startNew} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11"><Plus size={16} className="mr-2" /> Nuovo Pacco</Button>
      </div>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(p => (
          <div key={p.id} className="bg-white border border-slate-200 rounded-sm p-5 relative">
            {p.is_default && <span className="absolute top-3 right-3 inline-flex items-center gap-1 text-[10px] bg-orange-600 text-white px-2 py-0.5 rounded-sm font-semibold"><Star size={10} weight="fill" /> Predefinito</span>}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-slate-100 rounded-sm flex items-center justify-center"><Package size={20} className="text-slate-700" /></div>
              <div className="font-bold">{p.name}</div>
            </div>
            <div className="text-sm text-slate-700 font-mono">{p.length}×{p.width}×{p.height} cm · {p.weight} kg</div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => startEdit(p)} className="rounded-sm"><PencilSimple size={14} /></Button>
              <Button size="sm" variant="outline" onClick={() => remove(p.id)} className="rounded-sm"><Trash size={14} /></Button>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="col-span-full text-center text-slate-500 py-10 bg-white border border-slate-200 rounded-sm">Nessun pacco salvato.</div>}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg rounded-sm">
          <DialogHeader><DialogTitle style={{ fontFamily: "Chivo" }}>{editing ? "Modifica" : "Nuovo"} Pacco</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="label-caps">Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 rounded-sm h-10" /></div>
            <div className="grid grid-cols-4 gap-2">
              {["length","width","height","weight"].map(k => (
                <div key={k}><Label className="label-caps">{{length:"Lung.",width:"Larg.",height:"Alt.",weight:"Peso"}[k]}</Label>
                  <Input type="number" min="0" step="0.1" value={form[k]} onChange={(e) => setForm({ ...form, [k]: parseFloat(e.target.value) || 0 })} className="mt-1 rounded-sm h-10" /></div>
              ))}
            </div>
            <label className="flex items-center gap-2 cursor-pointer pt-2"><Checkbox checked={form.is_default} onCheckedChange={(v) => setForm({ ...form, is_default: !!v })} /><span className="text-sm">Imposta come predefinito</span></label>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Annulla</Button>
            <Button onClick={save} className="bg-orange-600 hover:bg-orange-700 rounded-sm">Salva</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
