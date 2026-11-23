import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { EnvelopeSimple, ArrowLeft } from "@phosphor-icons/react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setLoading(true);
    try { await api.post("/auth/forgot-password", { email }); setSent(true); }
    catch { toast.error("Errore"); } finally { setLoading(false); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-sm p-8">
        <Link to="/login" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-6"><ArrowLeft size={14} /> Torna al login</Link>
        <h1 className="text-3xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>Password dimenticata</h1>
        <p className="text-sm text-slate-600 mt-2 mb-6">Inserisci la tua email: ti manderemo un link per reimpostare la password.</p>
        {sent ? (
          <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-sm text-sm">
            Se l'email è registrata, hai ricevuto un link di reset. Controlla la tua casella (o il log del server in modalità locale).
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div><Label className="label-caps">Email</Label>
              <Input data-testid="fp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 rounded-sm h-11" /></div>
            <Button data-testid="fp-submit" type="submit" disabled={loading} className="w-full bg-orange-600 hover:bg-orange-700 rounded-sm h-11">
              <EnvelopeSimple size={16} className="mr-2" /> {loading ? "Invio…" : "Invia link di reset"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
