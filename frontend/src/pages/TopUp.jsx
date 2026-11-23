import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CreditCard, Bank, PaypalLogo, Wallet } from "@phosphor-icons/react";

export default function CustomTopUp() {
  const nav = useNavigate();
  const [amount, setAmount] = useState(100);
  const [method, setMethod] = useState("card");
  const [loading, setLoading] = useState(false);
  const [bonifico, setBonifico] = useState(null);

  const buy = async () => {
    if (amount < 10) { toast.error("Minimo € 10"); return; }
    setLoading(true);
    try {
      const r = await api.post("/wallet/topup-custom", { amount: parseFloat(amount), method, origin_url: window.location.origin });
      if (method === "bonifico") setBonifico(r.data);
      else window.location.href = r.data.checkout_url;
    } catch (err) { toast.error(err?.response?.data?.detail || "Errore"); }
    finally { setLoading(false); }
  };

  if (bonifico) {
    return (
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-4xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>Bonifico registrato</h1>
        <div className="bg-white border border-slate-200 rounded-sm p-6 space-y-3">
          <div className="label-caps">Effettua il bonifico con questi dati</div>
          {Object.entries(bonifico.instructions).map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-slate-100 py-2">
              <div className="label-caps">{k}</div>
              <div className="font-mono font-semibold text-slate-900">{v}</div>
            </div>
          ))}
          <div className="pt-4 text-sm text-slate-600">Il credito verrà accreditato dopo la ricezione del bonifico (1-3 giorni lavorativi).</div>
        </div>
        <Button onClick={() => nav("/billing")} className="bg-orange-600 hover:bg-orange-700 rounded-sm">Torna a Fatturazione</Button>
      </div>
    );
  }

  const Method = ({ id, icon: Icon, label, desc }) => (
    <button onClick={() => setMethod(id)}
      className={`text-left border rounded-sm p-4 transition-all ${method === id ? "border-orange-600 border-l-[3px] bg-orange-50/40" : "border-slate-200 bg-white hover:border-slate-400"}`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${method === id ? "bg-orange-600 text-white" : "bg-slate-100 text-slate-700"}`}>
          <Icon size={20} weight="fill" />
        </div>
        <div><div className="font-bold">{label}</div><div className="text-xs text-slate-500">{desc}</div></div>
      </div>
    </button>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <div className="label-caps text-orange-600 mb-1">Ricarica Prepagato</div>
        <h1 className="text-4xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>Ricarica personalizzata</h1>
      </div>
      <div className="bg-white border border-slate-200 rounded-sm p-6 space-y-5">
        <div>
          <Label className="label-caps">Importo (€)</Label>
          <Input type="number" min="10" step="10" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 rounded-sm h-12 text-2xl font-bold" />
          <div className="flex gap-2 mt-2 flex-wrap">
            {[50, 100, 250, 500, 1000, 2500].map(v => (
              <button key={v} onClick={() => setAmount(v)} className="text-xs bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-sm font-semibold">€ {v}</button>
            ))}
          </div>
        </div>
        <div>
          <Label className="label-caps">Metodo di pagamento</Label>
          <div className="grid gap-3 sm:grid-cols-3 mt-2">
            <Method id="card" icon={CreditCard} label="Carta" desc="Visa, Mastercard, Amex" />
            <Method id="paypal" icon={PaypalLogo} label="PayPal" desc="Conto PayPal" />
            <Method id="bonifico" icon={Bank} label="Bonifico" desc="Accredito 1-3 gg" />
          </div>
        </div>
        <Button onClick={buy} disabled={loading} className="w-full bg-orange-600 hover:bg-orange-700 rounded-sm h-12 text-base">
          <Wallet size={18} className="mr-2" weight="fill" />
          {loading ? "Attendere…" : `Ricarica € ${parseFloat(amount || 0).toFixed(2)}`}
        </Button>
      </div>
    </div>
  );
}
