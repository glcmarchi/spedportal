import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Truck, ArrowRight } from "@phosphor-icons/react";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const me = await login(email, pw);
      toast.success("Accesso effettuato");
      if (me?.role === "super_admin") {
        nav("/super-admin");
      } else {
        nav("/dashboard");
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Errore di accesso");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="flex items-center justify-center p-6 lg:p-12 bg-white">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-11 h-11 bg-orange-600 flex items-center justify-center rounded-sm">
              <Truck size={26} weight="fill" className="text-white" />
            </div>
            <div>
              <div className="text-2xl font-black tracking-tight" style={{ fontFamily: "Chivo" }}>SpedPortal</div>
              <div className="label-caps">Console Spedizioni B2B</div>
            </div>
          </div>

          <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-slate-900 mb-2" style={{ fontFamily: "Chivo" }}>
            Accedi.
          </h1>
          <p className="text-slate-600 mb-8">La tua console spedizioni multi-corriere.</p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label className="label-caps">Email</Label>
              <Input data-testid="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1.5 rounded-sm h-11" placeholder="tu@azienda.it" />
            </div>
            <div>
              <Label className="label-caps">Password</Label>
              <Input data-testid="login-password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required className="mt-1.5 rounded-sm h-11" placeholder="••••••••" />
            </div>
            <Button data-testid="login-submit" type="submit" disabled={loading} className="w-full h-11 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-sm">
              {loading ? "Accesso…" : (<>Entra <ArrowRight size={16} className="ml-2" /></>)}
            </Button>
          </form>

          <div className="mt-6 text-sm text-slate-600 flex items-center justify-between">
            <Link data-testid="goto-register" to="/register" className="text-orange-600 font-semibold hover:underline">Richiedi accesso</Link>
            <Link data-testid="goto-forgot" to="/forgot-password" className="text-slate-500 hover:text-slate-900">Password dimenticata?</Link>
          </div>

          <div className="mt-8 p-4 bg-slate-50 border border-slate-200 rounded-sm text-xs text-slate-600 space-y-1">
            <div className="label-caps mb-1">Credenziali Demo</div>
            <div><b>Super Admin:</b> admin@spedportal.it / Admin@2026</div>
            <div><b>Reseller Admin:</b> reseller@spedportal.it / Reseller@2026</div>
          </div>
        </div>
      </div>

      <div className="hidden lg:block bg-slate-900 bg-cover bg-center relative"
        style={{ backgroundImage: "url('https://images.unsplash.com/photo-1616432043562-3671ea2e5242?crop=entropy&cs=srgb&fm=jpg&q=85')" }}>
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-900/90 via-slate-900/50 to-transparent" />
        <div className="absolute bottom-12 left-12 right-12 text-white">
          <div className="label-caps text-orange-400 mb-3">Multi-Carrier Platform</div>
          <div className="text-4xl font-black tracking-tighter leading-tight" style={{ fontFamily: "Chivo" }}>
            Il tuo hub logistico.<br />Un solo login, tutti i corrieri.
          </div>
        </div>
      </div>
    </div>
  );
}
