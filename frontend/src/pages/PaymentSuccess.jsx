import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CheckCircle, Spinner } from "@phosphor-icons/react";

export default function PaymentSuccess() {
  const [params] = useSearchParams();
  const sid = params.get("session_id");
  const { refresh } = useAuth();
  const [status, setStatus] = useState("pending");
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    if (!sid) return;
    let cancelled = false;
    let count = 0;
    const poll = async () => {
      if (cancelled || count > 12) return;
      count += 1;
      try {
        const r = await api.get(`/payments/status/${sid}`);
        if (r.data.payment_status === "paid") { setStatus("paid"); setAmount(r.data.amount); await refresh(); return; }
        if (r.data.status === "expired" || r.data.payment_status === "failed") { setStatus("failed"); return; }
      } catch {}
      setTimeout(poll, 2000);
    };
    poll();
    return () => { cancelled = true; };
  }, [sid, refresh]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md w-full text-center bg-white p-10 border border-slate-200 rounded-sm">
        {status === "pending" && (<><Spinner size={48} className="mx-auto animate-spin text-orange-600 mb-4" /><h1 className="text-2xl font-black" style={{ fontFamily: "Chivo" }}>Elaborazione pagamento…</h1></>)}
        {status === "paid" && (<><div className="w-14 h-14 mx-auto rounded-sm bg-green-100 flex items-center justify-center mb-4"><CheckCircle size={28} weight="fill" className="text-green-600" /></div><h1 className="text-3xl font-black" style={{ fontFamily: "Chivo" }}>Ricarica completata!</h1><p className="text-slate-600 mt-2">+ € {amount.toFixed(2)} aggiunti al tuo credito.</p><Link to="/billing" className="inline-block mt-6 bg-orange-600 text-white px-5 h-11 rounded-sm font-semibold leading-[44px]">Torna a Fatturazione</Link></>)}
        {status === "failed" && (<><h1 className="text-2xl font-black text-red-600" style={{ fontFamily: "Chivo" }}>Pagamento fallito</h1><Link to="/topup" className="inline-block mt-6 border border-slate-300 px-5 h-11 rounded-sm font-semibold leading-[44px]">Riprova</Link></>)}
      </div>
    </div>
  );
}
