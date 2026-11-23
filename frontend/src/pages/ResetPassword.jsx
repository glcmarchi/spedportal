import React, { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const nav = useNavigate();
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (pw !== pw2) { toast.error("Le password non coincidono"); return; }
    if (pw.length < 6) { toast.error("Minimo 6 caratteri"); return; }
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: pw });
      toast.success("Password aggiornata"); nav("/login");
    } catch (err) { toast.error(err?.response?.data?.detail || "Token non valido o scaduto"); }
    finally { setLoading(false); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-sm p-8">
        <h1 className="text-3xl font-black tracking-tighter" style={{ fontFamily: "Chivo" }}>Nuova password</h1>
        <p className="text-sm text-slate-600 mt-2 mb-6">Scegli la tua nuova password.</p>
        <form onSubmit={submit} className="space-y-4">
          <div><Label className="label-caps">Nuova password</Label><Input data-testid="rp-pw" type="password" required value={pw} onChange={(e) => setPw(e.target.value)} className="mt-1 rounded-sm h-11" /></div>
          <div><Label className="label-caps">Conferma password</Label><Input data-testid="rp-pw2" type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)} className="mt-1 rounded-sm h-11" /></div>
          <Button data-testid="rp-submit" type="submit" disabled={loading || !token} className="w-full bg-orange-600 hover:bg-orange-700 rounded-sm h-11">
            {loading ? "Aggiornamento…" : "Aggiorna password"}
          </Button>
        </form>
        <div className="mt-4 text-sm text-center"><Link to="/login" className="text-orange-600 font-semibold hover:underline">Torna al login</Link></div>
      </div>
    </div>
  );
}
