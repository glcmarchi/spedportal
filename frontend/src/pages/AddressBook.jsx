import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { AddressBook, Plus, PencilSimple, Trash, DownloadSimple, UploadSimple } from "@phosphor-icons/react";

export default function AddressBookPage() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const empty = { label: "", company_name: "", address: "", postal_code: "", city: "", country: "IT", reference: "", email: "", phone: "" };
  const [form, setForm] = useState(empty);

  const load = () => { api.get("/addressbook").then(r => setItems(r.data)); };
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      if (editing) await api.put(`/addressbook/${editing.id}`, form);
      else await api.post("/addressbook", form);
      toast.success("Salvato"); setOpen(false); load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Errore"); }
  };
  const remove = async (id) => { if (window.confirm("Eliminare?")) { await api.delete(`/addressbook/${id}`); load(); } };
  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (it) => { setEditing(it); setForm(it); setOpen(true); };

  const downloadTemplate = async () => {
    const r = await api.get("/addressbook/template", { responseType: "blob" });
    const u = URL.createObjectURL(r.data);
    const a = document.createElement("a"); a.href = u; a.download = "rubrica_template.csv"; a.click(); URL.revokeObjectURL(u);
  };
  const upload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try { const r = await api.post("/addressbook/import", fd); toast.success(`Importati ${r.data.imported} indirizzi`); load(); }
    catch { toast.error("Errore import"); }
    e.target.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="label-caps text-orange-600 mb-1 flex items-center gap-2"><AddressBook size={14} weight="fill" /> Rubrica</div>
          <h1 className="text-4xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>La mia rubrica</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={downloadTemplate} className="rounded-sm h-11"><DownloadSimple size={16} className="mr-2" /> Template CSV</Button>
          <label className="inline-flex items-center gap-2 border border-slate-300 bg-white hover:bg-slate-50 rounded-sm h-11 px-4 cursor-pointer text-sm font-semibold">
            <UploadSimple size={16} /> Importa CSV
            <input type="file" accept=".csv" onChange={upload} className="hidden" />
          </label>
          <Button onClick={startNew} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11"><Plus size={16} className="mr-2" /> Nuovo Indirizzo</Button>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left label-caps"><th className="px-4 py-3">Etichetta</th><th className="px-4 py-3">Ragione Sociale</th><th className="px-4 py-3">Indirizzo</th><th className="px-4 py-3">CAP</th><th className="px-4 py-3">Città</th><th className="px-4 py-3">Naz.</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 text-slate-500">{it.label}</td><td className="px-4 py-2.5 font-semibold">{it.company_name}</td>
                  <td className="px-4 py-2.5">{it.address}</td><td className="px-4 py-2.5 font-mono">{it.postal_code}</td>
                  <td className="px-4 py-2.5">{it.city}</td><td className="px-4 py-2.5 font-mono">{it.country}</td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => startEdit(it)} className="text-slate-500 hover:text-orange-600 mr-2"><PencilSimple size={16} /></button>
                    <button onClick={() => remove(it.id)} className="text-slate-500 hover:text-red-600"><Trash size={16} /></button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-slate-500">Nessun indirizzo salvato.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl rounded-sm">
          <DialogHeader><DialogTitle style={{ fontFamily: "Chivo" }}>{editing ? "Modifica" : "Nuovo"} Indirizzo</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[["label","Etichetta"],["company_name","Ragione Sociale *"],["address","Indirizzo *","sm:col-span-2"],["country","Nazione (IT)"],["postal_code","CAP *"],["city","Città *"],["reference","Riferimento"],["email","Email"],["phone","Telefono"]].map(([k,l,cls]) => (
              <div key={k} className={cls || ""}><Label className="label-caps">{l}</Label><Input value={form[k] || ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1 rounded-sm h-10" /></div>
            ))}
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
