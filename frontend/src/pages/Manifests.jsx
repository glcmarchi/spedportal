import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ClipboardText, Plus, DownloadSimple, Truck } from "@phosphor-icons/react";

export default function Manifests() {
  const [manifests, setManifests] = useState([]);
  const [ships, setShips] = useState([]);
  const [carrierId, setCarrierId] = useState(null);
  const [selected, setSelected] = useState({});
  const [creating, setCreating] = useState(false);

  const load = () => {
    api.get("/manifests").then(r => setManifests(r.data));
    api.get("/shipments").then(r => setShips(r.data.filter(s => !s.manifest_id && ["created", "in_transit"].includes(s.status))));
  };
  useEffect(() => { load(); }, []);

  const carriers = [...new Set(ships.map(s => s.carrier_id))];
  const shipsForCarrier = carrierId ? ships.filter(s => s.carrier_id === carrierId) : [];
  const carrierName = ships.find(s => s.carrier_id === carrierId)?.carrier_name;

  const create = async () => {
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (ids.length === 0) { toast.error("Seleziona almeno una spedizione"); return; }
    try {
      const r = await api.post("/manifests", { carrier_id: carrierId, shipment_ids: ids });
      toast.success(`Manifest ${r.data.number} creato`);
      setCarrierId(null); setSelected({}); setCreating(false); load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Errore"); }
  };

  const dl = async (m) => {
    const r = await api.get(`/manifests/${m.id}/pdf`, { responseType: "blob" });
    const u = URL.createObjectURL(r.data);
    const a = document.createElement("a"); a.href = u; a.download = `${m.number}.pdf`; a.click(); URL.revokeObjectURL(u);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="label-caps text-orange-600 mb-1 flex items-center gap-2"><ClipboardText size={14} weight="fill" /> Manifest</div>
          <h1 className="text-4xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>Manifest per Ritiro</h1>
        </div>
        {!creating && <Button onClick={() => setCreating(true)} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11"><Plus size={16} className="mr-2" /> Nuovo Manifest</Button>}
      </div>
      {creating && (
        <div className="bg-white border border-slate-200 rounded-sm p-6 space-y-4">
          <h2 className="text-lg font-bold" style={{ fontFamily: "Chivo" }}>Seleziona corriere</h2>
          <div className="flex flex-wrap gap-2">
            {carriers.map(cid => {
              const name = ships.find(s => s.carrier_id === cid)?.carrier_name;
              const count = ships.filter(s => s.carrier_id === cid).length;
              return (<button key={cid} onClick={() => { setCarrierId(cid); setSelected({}); }} className={`px-4 py-2 rounded-sm text-sm font-semibold border ${carrierId === cid ? "bg-orange-600 text-white border-orange-600" : "bg-white border-slate-300"}`}>{name} ({count})</button>);
            })}
            {carriers.length === 0 && <div className="text-sm text-slate-500">Nessuna spedizione disponibile.</div>}
          </div>
          {carrierId && (
            <>
              <h3 className="font-bold mt-4">Spedizioni {carrierName}</h3>
              <div className="border border-slate-200 rounded-sm max-h-80 overflow-y-auto divide-y divide-slate-100">
                {shipsForCarrier.map(s => (
                  <label key={s.id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" checked={!!selected[s.id]} onChange={(e) => setSelected({ ...selected, [s.id]: e.target.checked })} />
                    <div className="flex-1"><div className="font-mono text-xs">{s.tracking_number}</div><div className="text-sm">{s.recipient?.company_name} · {s.recipient?.city}</div></div>
                    <div className="text-xs font-mono">{s.billed_weight} kg</div>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setCreating(false); setCarrierId(null); }} className="rounded-sm">Annulla</Button>
                <Button onClick={create} className="bg-orange-600 hover:bg-orange-700 rounded-sm">Crea Manifest</Button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-sm">
        <div className="px-5 py-4 border-b border-slate-200"><h2 className="text-lg font-bold" style={{ fontFamily: "Chivo" }}>Lista Manifest</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left label-caps"><th className="px-4 py-3">Numero</th><th className="px-4 py-3">Data</th><th className="px-4 py-3">Corriere</th><th className="px-4 py-3">Colli</th><th className="px-4 py-3">Peso</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody>
              {manifests.map(m => (
                <tr key={m.id} className="border-b border-slate-100">
                  <td className="px-4 py-2.5 font-mono font-semibold">{m.number}</td><td className="px-4 py-2.5 text-xs">{m.created_at?.slice(0, 10)}</td>
                  <td className="px-4 py-2.5"><span className="inline-flex items-center gap-1"><Truck size={14} /> {m.carrier_name}</span></td>
                  <td className="px-4 py-2.5">{m.total_parcels}</td><td className="px-4 py-2.5 font-mono">{m.total_weight} kg</td>
                  <td className="px-4 py-2.5 text-right"><Button variant="outline" size="sm" onClick={() => dl(m)} className="rounded-sm"><DownloadSimple size={14} className="mr-1" /> PDF</Button></td>
                </tr>
              ))}
              {manifests.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500">Nessun manifest.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
