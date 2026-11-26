import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/pages/Dashboard";
import { toast } from "sonner";
import { ArrowLeft, Printer, ArrowsClockwise, MapPin, Clock, XCircle, Truck, CheckCircle } from "@phosphor-icons/react";

export default function ShipmentDetail() {
  const { id } = useParams();
  const { user, refresh } = useAuth();
  const isResellerOrAdmin = ["reseller_admin", "super_admin", "admin"].includes(user?.role);

  const [s, setS] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);
  const [pickupLoading, setPickupLoading] = useState(false);

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [pickupForm, setPickupForm] = useState({
    pickup_date: tomorrow,
    ready_time: "10:00",
    close_time: "18:00",
    remarks: "",
  });

  useEffect(() => {
    api.get(`/shipments/${id}`).then(r => setS(r.data));
  }, [id]);

  if (!s) return <div className="text-slate-500">Caricamento…</div>;

  const label = async () => {
    const r = await api.get(`/shipments/${id}/label`, { responseType: "blob" });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `label-${s.tracking_number}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const refreshTracking = async () => {
    setSyncing(true);
    try {
      const r = await api.post(`/shipments/${id}/track/refresh`);
      setS(r.data);
      toast.success("Tracking aggiornato");
    } catch {
      toast.error("Errore aggiornamento tracking");
    } finally {
      setSyncing(false);
    }
  };

  const cancelShipment = async () => {
    if (!window.confirm("Confermi di voler annullare questa spedizione prima del ritiro?")) return;
    setCancelling(true);
    try {
      const r = await api.post(`/shipments/${id}/cancel`);
      setS(r.data);
      await refresh();
      toast.success("Spedizione annullata con successo");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore durante l'annullamento");
    } finally {
      setCancelling(false);
    }
  };

  const bookPickup = async () => {
    setPickupLoading(true);
    try {
      const r = await api.post(`/shipments/${id}/pickup`, pickupForm);
      setS(r.data);
      setPickupOpen(false);
      toast.success(`Ritiro prenotato! Codice: ${r.data.pickup?.confirmation_code}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore prenotazione ritiro");
    } finally {
      setPickupLoading(false);
    }
  };

  const cancelPickup = async () => {
    if (!window.confirm("Vuoi annullare la prenotazione del ritiro?")) return;
    setPickupLoading(true);
    try {
      const r = await api.post(`/shipments/${id}/pickup/cancel`);
      setS(r.data);
      toast.success("Ritiro annullato");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore annullamento ritiro");
    } finally {
      setPickupLoading(false);
    }
  };

  const events = s.tracking_events || [];
  const hasActivePickup = s.pickup?.status === "scheduled";
  const isClientShip = s.created_by_role === "user";
  const resellerCost = Number(s.reseller_cost ?? s.cost ?? 0);
  const clientPrice = Number(s.price ?? 0);
  const marginEarned = Math.round((clientPrice - resellerCost) * 100) / 100;

  return (
    <div className="space-y-6">
      <Link to="/shipments" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft size={16} /> Torna alle spedizioni
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="label-caps text-orange-600 mb-1 flex items-center gap-2 flex-wrap">
            <span>{s.carrier_name}</span>
            {s.is_live && <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded-sm text-[10px]">API LIVE</span>}
            {isResellerOrAdmin && (
              <span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold ${isClientShip ? "bg-blue-100 text-blue-800" : "bg-slate-200 text-slate-800"}`}>
                {isClientShip ? `Cliente: ${s.user_company_name || "Sub-cliente"}` : "Reseller"}
              </span>
            )}
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tighter text-slate-900 font-mono" style={{ fontFamily: "Chivo" }}>
            {s.tracking_number}
          </h1>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <StatusBadge status={s.status} />
            {s.status === "cancelled" && s.cancelled_by_role && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-sm ${
                s.cancelled_by_role === "reseller_admin"
                  ? "bg-orange-100 text-orange-800"
                  : "bg-slate-100 text-slate-700"
              }`}>
                {s.cancelled_by_role === "reseller_admin"
                  ? "Annullata dall'Agenzia (Reseller)"
                  : s.cancelled_by_role === "super_admin"
                  ? "Annullata dall'Amministratore"
                  : "Annullata dal Cliente"}
              </span>
            )}
            {s.estimated_delivery && (
              <span className="text-xs text-slate-600">Consegna prevista: <b>{s.estimated_delivery.slice(0, 10)}</b></span>
            )}
            {s.signed_by && (
              <span className="text-xs text-green-700 font-semibold">Firmato da: {s.signed_by}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {s.status === "created" && !hasActivePickup && (
            <Button variant="outline" onClick={() => setPickupOpen(true)} className="rounded-sm h-11">
              <Truck size={16} className="mr-2" /> Prenota Ritiro
            </Button>
          )}
          {s.status === "created" && (
            <Button variant="outline" onClick={cancelShipment} disabled={cancelling}
              className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 rounded-sm h-11">
              <XCircle size={16} className="mr-2" />
              {cancelling ? "Annullamento…" : "Annulla Spedizione"}
            </Button>
          )}
          {s.status !== "cancelled" && (
            <>
              <Button variant="outline" onClick={refreshTracking} disabled={syncing} className="rounded-sm h-11">
                <ArrowsClockwise size={16} className={`mr-2 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Aggiornamento…" : "Aggiorna Tracking"}
              </Button>
              <Button onClick={label} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11">
                <Printer size={16} className="mr-2" /> Stampa Etichetta
              </Button>
            </>
          )}
        </div>
      </div>

      {hasActivePickup && (
        <div className="bg-green-50 border border-green-200 rounded-sm p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <CheckCircle size={22} weight="fill" className="text-green-600 shrink-0" />
            <div className="text-sm">
              <div className="font-bold text-green-900">
                Ritiro prenotato per il {s.pickup.scheduled_date} ({s.pickup.ready_time} – {s.pickup.close_time})
              </div>
              <div className="text-xs text-green-800">
                Codice conferma corriere: <span className="font-mono font-bold">{s.pickup.confirmation_code}</span>
                {s.pickup.remarks && ` · Note: ${s.pickup.remarks}`}
              </div>
            </div>
          </div>
          {s.status === "created" && (
            <Button size="sm" variant="outline" onClick={cancelPickup} disabled={pickupLoading}
              className="border-red-200 text-red-600 hover:bg-red-50 rounded-sm">
              Annulla Ritiro
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Mittente" data={s.sender} />
        <Card title="Destinatario" data={s.recipient} />
      </div>

      <div className="bg-white border border-slate-200 rounded-sm p-6">
        <h3 className="text-lg font-bold tracking-tight mb-4" style={{ fontFamily: "Chivo" }}>Cronologia Tracking</h3>
        {events.length === 0 ? (
          <div className="text-sm text-slate-500">Nessun evento disponibile al momento.</div>
        ) : (
          <div className="space-y-3">
            {events.map((ev, idx) => (
              <div key={idx} className="flex items-start gap-3 pb-3 border-b border-slate-100 last:border-none last:pb-0">
                <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${idx === 0 ? "bg-orange-600" : "bg-slate-300"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{ev.label}</div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5 flex-wrap">
                    {ev.ts && (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} /> {ev.ts.replace("T", " ").slice(0, 16)}
                      </span>
                    )}
                    {ev.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={12} /> {ev.location}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-sm p-6">
        <h3 className="text-lg font-bold tracking-tight mb-4" style={{ fontFamily: "Chivo" }}>Colli & Dettaglio Costi</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <Kv k="Imballaggio" v={s.parcel_type} />
          <Kv k="Peso tassato" v={`${s.billed_weight} kg`} />
          <Kv k="Zona" v={s.zone} />
          <Kv k={isResellerOrAdmin && isClientShip ? "Prezzo Cliente" : "Prezzo Totale"} v={`€ ${clientPrice.toFixed(2)}`} />
        </div>

        {/* Riquadro Costo & Margine riservato al Reseller sulle spedizioni dei Sub-Clienti */}
        {isResellerOrAdmin && isClientShip && (
          <div className="mt-4 bg-orange-50/60 border border-orange-200 rounded-sm p-4 space-y-2">
            <div className="label-caps text-orange-800">Riepilogo Economico Reseller (Sub-Cliente: {s.user_company_name})</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm pt-1">
              <div className="bg-white border border-slate-200 rounded-sm p-3">
                <div className="label-caps text-slate-500">Costo Totale Reseller</div>
                <div className="text-xl font-black font-mono text-slate-900 mt-0.5">€ {resellerCost.toFixed(2)}</div>
                {s.reseller_base_freight !== undefined && (
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Nolo € {Number(s.reseller_base_freight).toFixed(2)} + Suppl. € {Number(s.reseller_surcharges_total || 0).toFixed(2)}
                  </div>
                )}
              </div>
              <div className="bg-white border border-slate-200 rounded-sm p-3">
                <div className="label-caps text-slate-500">Prezzo Applicato al Cliente</div>
                <div className="text-xl font-black font-mono text-slate-900 mt-0.5">€ {clientPrice.toFixed(2)}</div>
                {s.reseller_markup_percent !== undefined && (
                  <div className="text-[11px] text-slate-500 mt-0.5">Ricarico: +{Number(s.reseller_markup_percent).toFixed(1)}%</div>
                )}
              </div>
              <div className="bg-white border border-green-200 rounded-sm p-3">
                <div className="label-caps text-green-800">Margine Totale Maturato</div>
                <div className={`text-xl font-black font-mono mt-0.5 ${marginEarned >= 0 ? "text-green-700" : "text-red-600"}`}>
                  {marginEarned >= 0 ? `+ € ${marginEarned.toFixed(2)}` : `- € ${Math.abs(marginEarned).toFixed(2)}`}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">IVA esclusa</div>
              </div>
            </div>
            {s.reseller_surcharge_items?.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 pt-1">
                {s.reseller_surcharge_items.map((sc, idx) => (
                  <span key={idx}>• {sc.label}: € {Number(sc.amount).toFixed(2)}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Dettaglio nolo/supplementi per spedizioni dirette del Reseller */}
        {isResellerOrAdmin && !isClientShip && s.reseller_base_freight !== undefined && (
          <div className="mt-4 bg-slate-50 border border-slate-200 rounded-sm p-3.5 text-xs space-y-1.5">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>Nolo base: <b className="text-slate-900">€ {Number(s.reseller_base_freight).toFixed(2)}</b></span>
              <span>Supplementi totali: <b className="text-slate-900">€ {Number(s.reseller_surcharges_total || 0).toFixed(2)}</b></span>
              <span>Costo / Totale: <b className="text-orange-600">€ {clientPrice.toFixed(2)}</b></span>
            </div>
            {s.reseller_surcharge_items?.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-500 pt-1 border-t border-slate-200">
                {s.reseller_surcharge_items.map((sc, idx) => (
                  <span key={idx}>• {sc.label}: € {Number(sc.amount).toFixed(2)}</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 border-t border-slate-100 pt-4">
          <table className="w-full text-sm">
            <thead className="text-left label-caps">
              <tr><th>Collo</th><th>Lung.</th><th>Larg.</th><th>Prof.</th><th>Peso</th></tr>
            </thead>
            <tbody>
              {s.parcels.map((p, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-2">#{i + 1}</td>
                  <td>{p.length} cm</td>
                  <td>{p.width} cm</td>
                  <td>{p.height} cm</td>
                  <td>{p.weight} kg</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.goods_description && <div className="mt-4 text-sm"><span className="label-caps">Contenuto: </span>{s.goods_description}</div>}
      </div>

      <Dialog open={pickupOpen} onOpenChange={setPickupOpen}>
        <DialogContent className="rounded-sm max-w-md">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Chivo" }}>Prenota Ritiro Corriere</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="bg-slate-50 border border-slate-200 rounded-sm p-3 text-xs text-slate-600">
              Indirizzo ritiro: <b>{s.sender?.company_name}</b> — {s.sender?.address}, {s.sender?.postal_code} {s.sender?.city}
            </div>
            <div>
              <Label className="label-caps">Data Ritiro</Label>
              <Input type="date" value={pickupForm.pickup_date}
                onChange={(e) => setPickupForm({ ...pickupForm, pickup_date: e.target.value })}
                className="mt-1 rounded-sm h-10" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="label-caps">Merce pronta dalle</Label>
                <Input type="time" value={pickupForm.ready_time}
                  onChange={(e) => setPickupForm({ ...pickupForm, ready_time: e.target.value })}
                  className="mt-1 rounded-sm h-10" />
              </div>
              <div>
                <Label className="label-caps">Chiusura sede alle</Label>
                <Input type="time" value={pickupForm.close_time}
                  onChange={(e) => setPickupForm({ ...pickupForm, close_time: e.target.value })}
                  className="mt-1 rounded-sm h-10" />
              </div>
            </div>
            <div>
              <Label className="label-caps">Note per l'autista (opzionale)</Label>
              <Input maxLength={60} placeholder="Es. Citofonare magazzino sul retro"
                value={pickupForm.remarks}
                onChange={(e) => setPickupForm({ ...pickupForm, remarks: e.target.value })}
                className="mt-1 rounded-sm h-10" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setPickupOpen(false)} className="rounded-sm">Annulla</Button>
              <Button onClick={bookPickup} disabled={pickupLoading} className="bg-orange-600 hover:bg-orange-700 rounded-sm">
                {pickupLoading ? "Prenotazione…" : "Conferma Ritiro"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Card({ title, data }) {
  return (
    <div className="bg-white border border-slate-200 rounded-sm p-6">
      <div className="label-caps mb-3">{title}</div>
      <div className="font-bold text-slate-900">{data.company_name}</div>
      <div className="text-sm text-slate-700 mt-1">{data.address}</div>
      <div className="text-sm text-slate-700">{data.postal_code} {data.city} {data.province ? `(${data.province})` : ""} · {data.country}</div>
    </div>
  );
}

function Kv({ k, v }) {
  return (
    <div>
      <div className="label-caps">{k}</div>
      <div className="font-semibold text-slate-900">{v}</div>
    </div>
  );
}
