import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { CheckCircle, Spinner, Printer } from "@phosphor-icons/react";

export default function PaymentSuccess() {
  const [params] = useSearchParams();
  const sid = params.get("session_id");
  const { refresh } = useAuth();
  const [status, setStatus] = useState("pending");
  const [amount, setAmount] = useState(0);
  const [kind, setKind] = useState("wallet_topup");
  const [shipment, setShipment] = useState(null);

  useEffect(() => {
    if (!sid) return;
    let cancelled = false;
    let count = 0;
    const poll = async () => {
      if (cancelled || count > 15) return;
      count += 1;
      try {
        const r = await api.get(`/payments/status/${sid}`);
        if (r.data.payment_status === "paid") {
          setStatus("paid");
          setAmount(Number(r.data.amount || 0));
          setKind(r.data.kind || "wallet_topup");
          if (r.data.shipment) setShipment(r.data.shipment);
          await refresh();
          return;
        }
        if (r.data.status === "expired" || r.data.payment_status === "failed") {
          setStatus("failed");
          return;
        }
      } catch {}
      setTimeout(poll, 2000);
    };
    poll();
    return () => { cancelled = true; };
  }, [sid, refresh]);

  const downloadLabel = async () => {
    if (!shipment?.id) return;
    const r = await api.get(`/shipments/${shipment.id}/label`, { responseType: "blob" });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `label-${shipment.tracking_number}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-lg w-full text-center bg-white p-10 border border-slate-200 rounded-sm">
        {status === "pending" && (
          <>
            <Spinner size={48} className="mx-auto animate-spin text-orange-600 mb-4" />
            <h1 className="text-2xl font-black" style={{ fontFamily: "Chivo" }}>Elaborazione pagamento ed emissione…</h1>
            <p className="text-xs text-slate-500 mt-2">Attendere qualche secondo senza chiudere la pagina.</p>
          </>
        )}

        {status === "paid" && kind === "shipment_instant" && (
          <>
            <div className="w-14 h-14 mx-auto rounded-sm bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle size={28} weight="fill" className="text-green-600" />
            </div>
            <h1 className="text-3xl font-black" style={{ fontFamily: "Chivo" }}>Spedizione confermata!</h1>
            <p className="text-slate-600 mt-2">
              Pagamento ricevuto: <b>€ {amount.toFixed(2)}</b>
            </p>
            {shipment && (
              <div className="mt-4 bg-slate-50 border border-slate-200 rounded-sm p-4 text-sm space-y-1">
                <div>Corriere: <b>{shipment.carrier_name}</b></div>
                <div>Tracking: <span className="font-mono font-bold text-orange-600">{shipment.tracking_number}</span></div>
                <div className="text-xs text-slate-500 pt-1">
                  La fattura/ricevuta è stata emessa automaticamente nella sezione <b>Fatturazione</b>.
                </div>
              </div>
            )}
            <div className="flex gap-3 justify-center flex-wrap mt-6">
              {shipment?.id && (
                <Button onClick={downloadLabel} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-11">
                  <Printer size={16} className="mr-2" /> Stampa Etichetta
                </Button>
              )}
              <Link to="/shipments" className="inline-flex items-center border border-slate-300 hover:bg-slate-50 px-5 h-11 rounded-sm font-semibold text-sm">
                Vai a Spedizioni
              </Link>
            </div>
          </>
        )}

        {status === "paid" && kind !== "shipment_instant" && (
          <>
            <div className="w-14 h-14 mx-auto rounded-sm bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle size={28} weight="fill" className="text-green-600" />
            </div>
            <h1 className="text-3xl font-black" style={{ fontFamily: "Chivo" }}>Ricarica completata!</h1>
            <p className="text-slate-600 mt-2">+ € {amount.toFixed(2)} aggiunti al tuo credito.</p>
            <Link to="/billing" className="inline-block mt-6 bg-orange-600 text-white px-5 h-11 rounded-sm font-semibold leading-[44px]">
              Torna a Fatturazione
            </Link>
          </>
        )}

        {status === "failed" && (
          <>
            <h1 className="text-2xl font-black text-red-600" style={{ fontFamily: "Chivo" }}>Pagamento non completato</h1>
            <p className="text-xs text-slate-500 mt-2">Nessun addebito è stato effettuato e nessuna lettera di vettura è stata emessa.</p>
            <Link to="/shipments/new" className="inline-block mt-6 border border-slate-300 px-5 h-11 rounded-sm font-semibold leading-[44px]">
              Torna a Nuova Spedizione
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
