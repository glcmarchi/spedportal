import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Megaphone, PaperPlaneTilt } from "@phosphor-icons/react";

export default function AdminBroadcast() {
  const [users, setUsers] = useState([]);
  const [msgs, setMsgs] = useState([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [visibleFrom, setVisibleFrom] = useState("");
  const [targetAll, setTargetAll] = useState(true);
  const [selected, setSelected] = useState({});

  const load = () => { api.get("/admin/users").then(r => setUsers(r.data)); api.get("/admin/broadcasts").then(r => setMsgs(r.data)); };
  useEffect(() => { load(); }, []);

  const send = async () => {
    if (!title || !body) { toast.error("Compila titolo e messaggio"); return; }
    const target_user_ids = targetAll ? null : Object.keys(selected).filter(k => selected[k]);
    try {
      const body_iso = visibleFrom ? new Date(visibleFrom).toISOString() : null;
      await api.post("/admin/broadcasts", { title, body, visible_from: body_iso, target_user_ids });
      toast.success("Messaggio inviato"); setTitle(""); setBody(""); setVisibleFrom(""); setSelected({}); load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Errore"); }
  };

  return (
    <div className="space-y-6">
      <div><div className="label-caps text-orange-600 mb-1 flex items-center gap-2"><Megaphone size={14} weight="fill" /> Admin</div><h1 className="text-4xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>Comunicazioni Clienti</h1></div>
      <div className="bg-white border border-slate-200 rounded-sm p-6 space-y-4 max-w-3xl">
        <div><Label className="label-caps">Titolo</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 rounded-sm h-11" /></div>
        <div><Label className="label-caps">Messaggio</Label><Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="mt-1 rounded-sm" /></div>
        <div><Label className="label-caps">Visibile da</Label><Input type="datetime-local" value={visibleFrom} onChange={(e) => setVisibleFrom(e.target.value)} className="mt-1 rounded-sm h-11 max-w-xs" /></div>
        <label className="flex items-center gap-2 cursor-pointer"><Checkbox checked={targetAll} onCheckedChange={(v) => setTargetAll(!!v)} /><span className="text-sm font-semibold">Invia a tutti i clienti</span></label>
        {!targetAll && (
          <div className="border border-slate-200 rounded-sm p-3 max-h-60 overflow-y-auto space-y-1">
            {users.map(u => (<label key={u.id} className="flex items-center gap-2 py-1 cursor-pointer text-sm"><Checkbox checked={!!selected[u.id]} onCheckedChange={(v) => setSelected({ ...selected, [u.id]: !!v })} /><span>{u.company_name}</span></label>))}
          </div>
        )}
        <Button onClick={send} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11"><PaperPlaneTilt size={16} className="mr-2" weight="fill" /> Invia Comunicazione</Button>
      </div>
    </div>
  );
}
