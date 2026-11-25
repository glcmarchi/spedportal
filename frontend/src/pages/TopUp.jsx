import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  CreditCard, Bank, PaypalLogo, Wallet, ArrowUpRight,
  ArrowDownRight, ArrowsClockwise, ClockCounterClockwise,
} from "@phosphor-icons/react";

const TYPE_LABELS = {
  admin_topup: { label: "Ricarica da Amministratore", cat: "topup" },
  admin_adjustment: { label: "Rettifica Amministratore", cat: "topup" },
  stripe_topup: { label: "Ricarica Online (Carta / PayPal)", cat: "topup" },
  topup: { label: "Ricarica Credito", cat: "topup" },
  shipment_charge: { label: "Addebito Spedizione", cat: "charge" },
  label_fee: { label: "Fee Lettera di Vettura", cat: "charge" },
  shipment_refund: { label: "Rimborso Spedizione Annullata", cat: "refund" },
};

export default function CustomTopUp() {
  const { user, refresh } = useAuth();
  const isReseller = user?.role === "reseller_admin";
  const [amount, setAmount] = useState(100);
  const [method, setMethod] = useState("card");
  const [loading, setLoading] = useState(false);
  const [bonifico, setBonifico] = useState(null);

  const [wallet, setWallet] = useState({ balance: user?.credit_balance ?? 0, ledger: [] });
  const [loadingLedger, setLoadingLedger] = useState(true);
  const [filter, setFilter] = useState("all");

  const loadWallet = async () => {
    setLoadingLedger(true);
    try {
      const r = await api.get("/wallet/balance");
      setWallet({
        balance: Number(r.data?.balance ?? 0),
        ledger: r.data?.ledger || [],
      });
    } catch {
      // fallback silenzioso
    } finally {
      setLoadingLedger(false);
    }
  };

  useEffect(() => {
    loadWallet();
  }, []);

  const buy = async () => {
    if (amount < 10) {
      toast.error("Minimo € 10");
      return;
    }
    setLoading(true);
    try {
      const r = await api.post("/wallet/topup-custom", {
        amount: parseFloat(amount),
        method,
        origin_url: window.location.origin,
      });
      if (method === "bonifico") {
        setBonifico(r.data);
      } else {
        window.location.href = r.data.checkout_url;
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore");
    } finally {
      setLoading(false);
    }
  };

  const enrichedLedger = useMemo(() => {
    let running = Number(wallet.balance || 0);
    return (wallet.ledger || []).map((entry) => {
      const amt = Number(entry.amount || 0);
      const after = running;
      running = round2(running - amt);
      const meta = TYPE_LABELS[entry.type] || {
        label: amt >= 0 ? "Accredito" : "Addebito",
        cat: amt >= 0 ? "topup" : "charge",
      };
      const isSubclientOrigin =
        entry.created_by_role === "user" ||
        (entry.note || "").toLowerCase().startsWith("sub-cliente");
      const isShipmentMovement = ["shipment_charge", "label_fee", "shipment_refund"].includes(entry.type);

      return {
        ...entry,
        amount: amt,
        balanceAfter: after,
        typeLabel: meta.label,
        category: meta.cat,
        isSubclientOrigin,
        isShipmentMovement,
      };
    });
  }, [wallet]);

  const totals = useMemo(() => {
    let topups = 0;
    let spent = 0;
    for (const item of enrichedLedger) {
      if (item.amount > 0 && item.category === "topup") topups += item.amount;
      if (item.amount < 0) spent += Math.abs(item.amount);
    }
    return { topups: round2(topups), spent: round2(spent) };
  }, [enrichedLedger]);

  const filteredLedger = useMemo(() => {
    if (filter === "all") return enrichedLedger;
    if (filter === "subclients") {
      return enrichedLedger.filter((item) => item.isShipmentMovement && item.isSubclientOrigin);
    }
    if (filter === "direct") {
      return enrichedLedger.filter((item) => item.isShipmentMovement && !item.isSubclientOrigin);
    }
    return enrichedLedger.filter((item) => item.category === filter);
  }, [enrichedLedger, filter]);

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
          <div className="pt-4 text-sm text-slate-600">
            Il credito verrà accreditato dall'amministratore dopo la ricezione del bonifico (1-3 giorni lavorativi).
          </div>
        </div>
        <Button onClick={() => { setBonifico(null); loadWallet(); refresh(); }} className="bg-orange-600 hover:bg-orange-700 rounded-sm">
          Torna al Wallet
        </Button>
      </div>
    );
  }

  const Method = ({ id, icon: Icon, label, desc }) => (
    <button
      type="button"
      onClick={() => setMethod(id)}
      className={`text-left border rounded-sm p-4 transition-all ${method === id ? "border-orange-600 border-l-[3px] bg-orange-50/40" : "border-slate-200 bg-white hover:border-slate-400"}`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${method === id ? "bg-orange-600 text-white" : "bg-slate-100 text-slate-700"}`}>
          <Icon size={20} weight="fill" />
        </div>
        <div>
          <div className="font-bold">{label}</div>
          <div className="text-xs text-slate-500">{desc}</div>
        </div>
      </div>
    </button>
  );

  const filterTabs = isReseller
    ? [
        ["all", "Tutti"],
        ["topup", "Ricariche"],
        ["direct", "Spese Dirette Reseller"],
        ["subclients", "Spese Sub-Clienti"],
        ["refund", "Rimborsi"],
      ]
    : [
        ["all", "Tutti"],
        ["topup", "Ricariche"],
        ["charge", "Spese"],
        ["refund", "Rimborsi"],
      ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="label-caps text-orange-600 mb-1">Conto Prepagato</div>
          <h1 className="text-4xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>Wallet & Movimenti</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => { loadWallet(); refresh(); }}
          disabled={loadingLedger}
          className="rounded-sm h-10"
        >
          <ArrowsClockwise size={16} className={`mr-2 ${loadingLedger ? "animate-spin" : ""}`} />
          Aggiorna Estratto Conto
        </Button>
      </div>

      {/* KPI SALDO E RIEPILOGO MOVIMENTI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 text-white rounded-sm p-5">
          <div className="label-caps text-slate-400">Credito Residuo Attuale</div>
          <div className="text-4xl font-black tracking-tighter text-orange-400 mt-2" style={{ fontFamily: "Chivo" }}>
            € {wallet.balance.toFixed(2)}
          </div>
          <div className="text-xs text-slate-400 mt-1">Disponibile per nuove spedizioni</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-sm p-5">
          <div className="label-caps text-slate-500 flex items-center gap-1.5">
            <ArrowUpRight size={14} className="text-green-600" weight="bold" /> Totale Ricaricato
          </div>
          <div className="text-3xl font-black tracking-tighter text-green-700 mt-2" style={{ fontFamily: "Chivo" }}>
            + € {totals.topups.toFixed(2)}
          </div>
          <div className="text-xs text-slate-500 mt-1">Somma accrediti registrati</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-sm p-5">
          <div className="label-caps text-slate-500 flex items-center gap-1.5">
            <ArrowDownRight size={14} className="text-red-600" weight="bold" /> Totale Speso
          </div>
          <div className="text-3xl font-black tracking-tighter text-slate-900 mt-2" style={{ fontFamily: "Chivo" }}>
            - € {totals.spent.toFixed(2)}
          </div>
          <div className="text-xs text-slate-500 mt-1">Trasporti e fee lettere di vettura</div>
        </div>
      </div>

      {/* RIQUADRO RICARICA */}
      <div className="bg-white border border-slate-200 rounded-sm p-6 space-y-5">
        <div className="label-caps text-orange-600">Effettua una Nuova Ricarica</div>
        <div>
          <Label className="label-caps">Importo (€)</Label>
          <Input
            type="number"
            min="10"
            step="10"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 rounded-sm h-12 text-2xl font-bold max-w-xs"
          />
          <div className="flex gap-2 mt-2 flex-wrap">
            {[50, 100, 250, 500, 1000, 2500].map((v) => (
              <button
                type="button"
                key={v}
                onClick={() => setAmount(v)}
                className="text-xs bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-sm font-semibold"
              >
                € {v}
              </button>
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
        <Button onClick={buy} disabled={loading} className="bg-orange-600 hover:bg-orange-700 rounded-sm h-12 px-8 text-base">
          <Wallet size={18} className="mr-2" weight="fill" />
          {loading ? "Attendere…" : `Ricarica € ${parseFloat(amount || 0).toFixed(2)}`}
        </Button>
      </div>

      {/* CRONOSTORY MOVIMENTI (ESTRATTO CONTO) */}
      <div className="bg-white border border-slate-200 rounded-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <ClockCounterClockwise size={20} weight="fill" className="text-orange-600" />
            <h2 className="text-lg font-bold tracking-tight" style={{ fontFamily: "Chivo" }}>
              Cronostoria Ricariche & Spese
            </h2>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {filterTabs.map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={`text-xs px-3 py-1.5 rounded-sm font-semibold border transition-colors ${
                  filter === k
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left label-caps">
                <th className="px-5 py-3">Data / Ora</th>
                <th className="px-5 py-3">Operazione</th>
                {isReseller && <th className="px-5 py-3">Origine</th>}
                <th className="px-5 py-3">Dettaglio / Causale</th>
                <th className="px-5 py-3 text-right">Importo</th>
                <th className="px-5 py-3 text-right">Saldo Residuo</th>
              </tr>
            </thead>
            <tbody>
              {loadingLedger ? (
                <tr>
                  <td colSpan={isReseller ? 6 : 5} className="px-5 py-10 text-center text-slate-500">
                    Caricamento movimenti…
                  </td>
                </tr>
              ) : filteredLedger.length === 0 ? (
                <tr>
                  <td colSpan={isReseller ? 6 : 5} className="px-5 py-10 text-center text-slate-500">
                    Nessun movimento registrato per questo filtro.
                  </td>
                </tr>
              ) : (
                filteredLedger.map((m, idx) => {
                  const isPositive = m.amount >= 0;
                  return (
                    <tr key={m.id || idx} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {(m.created_at || "").replace("T", " ").slice(0, 16)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-sm ${
                            m.category === "topup"
                              ? "bg-green-100 text-green-800"
                              : m.category === "refund"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-slate-100 text-slate-800"
                          }`}
                        >
                          {m.typeLabel}
                        </span>
                      </td>
                      {isReseller && (
                        <td className="px-5 py-3 text-xs">
                          {m.isShipmentMovement ? (
                            m.isSubclientOrigin ? (
                              <span className="inline-block bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded-sm font-semibold">
                                Sub-cliente{m.client_company_name ? `: ${m.client_company_name}` : ""}
                              </span>
                            ) : (
                              <span className="inline-block bg-slate-100 text-slate-700 px-2 py-0.5 rounded-sm font-semibold">
                                Diretta Reseller
                              </span>
                            )
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-5 py-3 text-slate-700">
                        {m.note || (m.shipment_id ? `Spedizione #${m.shipment_id.slice(0, 8)}` : "Movimento conto")}
                      </td>
                      <td
                        className={`px-5 py-3 text-right font-mono font-bold whitespace-nowrap ${
                          isPositive ? "text-green-700" : "text-red-600"
                        }`}
                      >
                        {isPositive ? `+ € ${m.amount.toFixed(2)}` : `- € ${Math.abs(m.amount).toFixed(2)}`}
                      </td>
                      <td className="px-5 py-3 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                        € {m.balanceAfter.toFixed(2)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
