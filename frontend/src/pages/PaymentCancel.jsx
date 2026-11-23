import React from "react";
import { Link } from "react-router-dom";
export default function PaymentCancel() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md w-full text-center bg-white p-10 border border-slate-200 rounded-sm">
        <h1 className="text-2xl font-black tracking-tight" style={{ fontFamily: "Chivo" }}>Pagamento annullato</h1>
        <p className="text-slate-600 mt-2 text-sm">Nessun addebito effettuato.</p>
        <Link to="/topup" className="inline-block mt-6 border border-slate-300 px-5 h-11 rounded-sm font-semibold leading-[44px]">Torna alle ricariche</Link>
      </div>
    </div>
  );
}
