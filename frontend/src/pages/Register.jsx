import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Truck } from "@phosphor-icons/react";

export default function Register() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const resellerSlug = params.get("reseller") || "";
  const [form, setForm] = useState({ email: "", password: "", company_name: "", phone: "" });
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/register", { ...form, reseller_slug: resellerSlug || null });
      toast.success("Registrazione ricevuta! Attendi l'approvazione admin.");
      nav("/login");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore registrazione");
    } finally { setLoading(false); }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-sm p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-orange-600 flex items-center justify-center rounded-sm">
            <Truck size={22} weight="fill" className="text-white" />
          </div>
          <div className="text-xl font-black tracking-tight" style={{ fontFamily: "Chivo" }}>SpedPortal</div>
        </div>
        <h1 className="text-3xl font-black tracking-tighter text-slate-900 mb-2" style={{ fontFamily: "Chivo" }}>Richiedi accesso.</h1>
        <p className="text-sm text-slate-600 mb-6">Il tuo account sarà attivato dopo verifica admin.</p>
        <form onSubmit={submit} className="space-y-4">
          <div><Label className="label-caps">Ragione Sociale</Label><Input data-testid="reg-company" required value={form.company_name} onChange={set("company_name")} className="mt-1.5 rounded-sm h-11" /></div>
          <div><Label className="label-caps">Email</Label><Input data-testid="reg-email" type="email" required value={form.email} onChange={set("email")} className="mt-1.5 rounded-sm h-11" /></div>
          <div><Label className="label-caps">Telefono</Label><Input data-testid="reg-phone" value={form.phone} onChange={set("phone")} className="mt-1.5 rounded-sm h-11" /></div>
          <div><Label className="label-caps">Password</Label><Input data-testid="reg-password" type="password" required value={form.password} onChange={set("password")} className="mt-1.5 rounded-sm h-11" /></div>
          <Button data-testid="reg-submit" type="submit" disabled={loading} className="w-full h-11 bg-orange-600 hover:bg-orange-700 rounded-sm">
            {loading ? "Invio…" : "Registrati"}
          </Button>
        </form>
        <div className="mt-6 text-sm text-slate-600 text-center">
          Hai già un account? <Link to="/login" className="text-orange-600 font-semibold hover:underline">Accedi</Link>
        </div>
      </div>
    </div>
  );
}
