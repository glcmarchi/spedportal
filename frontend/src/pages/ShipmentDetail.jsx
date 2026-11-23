import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/pages/Dashboard";
import { ArrowLeft, Printer } from "@phosphor-icons/react";

export default function ShipmentDetail() {
  const { id } = useParams();
  const [s, setS] = useState(null);
  useEffect(() => { api.get(`/shipments/${id}`).then(r => setS(r.data)); }, [id]);
  if (!s) return <div className="text-slate-500">Caricamento…</div>;

  const label = async () => {
    const r = await api.get(`/shipments/${id}/label`, { responseType: "blob" });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a"); a.href = url; a.download = `label-${s.tracking_number}.pdf`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <Link to="/shipments" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft size={16} /> Torna alle spedizioni</Link>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="label-caps text-orange-600 mb-1">{s.carrier_name}</div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tighter text-slate-900 font-mono" style={{ fontFamily: "Chivo" }}>{s.tracking_number}</h1>
          <div className="mt-2"><StatusBadge status={s.status} /></div>
        </div>
        <Button onClick={label} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11"><Printer size={16} className="mr-2" /> Stampa Etichetta</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Mittente" data={s.sender} />
        <Card title="Destinatario" data={s.recipient} />
      </div>
      <div className="bg-white border border-slate-200 rounded-sm p-6">
        <h3 className="text-lg font-bold tracking-tight mb-4" style={{ fontFamily: "Chivo" }}>Colli & Dettagli</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <Kv k="Tipo" v={s.parcel_type} /><Kv k="Peso tassato" v={`${s.billed_weight} kg`} /><Kv k="Zona" v={s.zone} /><Kv k="Prezzo" v={`€ ${s.price.toFixed(2)}`} />
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <table className="w-full text-sm">
            <thead className="text-left label-caps"><tr><th>Collo</th><th>Lung.</th><th>Larg.</th><th>Prof.</th><th>Peso</th></tr></thead>
            <tbody>{s.parcels.map((p, i) => (<tr key={i} className="border-t border-slate-100"><td className="py-2">#{i + 1}</td><td>{p.length} cm</td><td>{p.width} cm</td><td>{p.height} cm</td><td>{p.weight} kg</td></tr>))}</tbody>
          </table>
        </div>
        {s.goods_description && <div className="mt-4 text-sm"><span className="label-caps">Merce: </span>{s.goods_description}</div>}
      </div>
    </div>
  );
}
function Card({ title, data }) {
  return (
    <div className="bg-white border border-slate-200 rounded-sm p-6">
      <div className="label-caps mb-3">{title}</div>
      <div className="font-bold text-slate-900">{data.company_name}</div>
      <div className="text-sm text-slate-700 mt-1">{data.address}</div>
      <div className="text-sm text-slate-700">{data.postal_code} {data.city} · {data.country}</div>
    </div>
  );
}
function Kv({ k, v }) { return <div><div className="label-caps">{k}</div><div className="font-semibold text-slate-900">{v}</div></div>; }
