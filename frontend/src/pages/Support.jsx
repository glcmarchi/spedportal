import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Headset, Paperclip, X } from "@phosphor-icons/react";

const CATS = [["technical","Problema tecnico"],["usage","Domanda sull'uso"],["billing","Fatturazione e credito"],["shipping","Spedizioni e corrieri"],["feature","Proposta nuova funzionalità"],["other","Altro"]];

export default function Support() {
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("technical");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [tickets, setTickets] = useState([]);

  const load = () => { api.get("/support/tickets").then(r => setTickets(r.data)); };
  useEffect(() => { load(); }, []);

  const onFiles = (e) => { setFiles(Array.from(e.target.files || []).slice(0, 3)); e.target.value = ""; };
  const submit = async () => {
    if (!subject || !description) { toast.error("Compila tutti i campi obbligatori"); return; }
    setSending(true);
    try {
      const fd = new FormData(); fd.append("subject", subject); fd.append("category", category); fd.append("description", description);
      files.forEach(f => fd.append("attachments", f));
      await api.post("/support/tickets", fd);
      toast.success("Richiesta inviata"); setSubject(""); setDescription(""); setFiles([]); load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Errore invio"); }
    finally { setSending(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="label-caps text-orange-600 mb-1 flex items-center gap-2"><Headset size={14} weight="fill" /> Supporto</div>
        <h1 className="text-4xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>Come possiamo aiutarti?</h1>
      </div>
      <div className="bg-white border border-slate-200 rounded-sm p-6 space-y-4 max-w-3xl">
        <div><Label className="label-caps">Oggetto *</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 rounded-sm h-11" /></div>
        <div><Label className="label-caps">Categoria *</Label>
          <Select value={category} onValueChange={setCategory}><SelectTrigger className="mt-1 rounded-sm h-11"><SelectValue /></SelectTrigger>
            <SelectContent>{CATS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label className="label-caps">Descrizione *</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className="mt-1 rounded-sm" /></div>
        <div>
          <Label className="label-caps">Allegati (max 3)</Label>
          <label className="mt-1 inline-flex items-center gap-2 border border-dashed border-slate-300 rounded-sm h-11 px-4 cursor-pointer text-sm">
            <Paperclip size={16} /> Seleziona file <input type="file" multiple onChange={onFiles} className="hidden" />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {files.map((f, i) => (<span key={i} className="inline-flex items-center gap-1 text-xs bg-slate-100 border border-slate-200 px-2 py-1 rounded-sm">{f.name} <button onClick={() => setFiles(files.filter((_, x) => x !== i))}><X size={12} /></button></span>))}
          </div>
        </div>
        <Button onClick={submit} disabled={sending} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11">{sending ? "Invio…" : "Invia Richiesta"}</Button>
      </div>
      {tickets.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-sm max-w-3xl divide-y divide-slate-100">
          {tickets.map(t => (
            <div key={t.id} className="p-4">
              <div className="flex items-center justify-between"><div className="font-semibold">{t.subject}</div><span className="text-xs bg-slate-100 px-2 py-0.5 rounded-sm">{t.status}</span></div>
              <div className="text-sm text-slate-700 mt-2">{t.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
