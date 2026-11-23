import React from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { HourglassMedium } from "@phosphor-icons/react";

export default function PendingApproval() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md text-center bg-white p-10 border border-slate-200 rounded-sm">
        <div className="w-14 h-14 rounded-sm bg-orange-100 mx-auto flex items-center justify-center mb-4">
          <HourglassMedium size={28} className="text-orange-600" weight="fill" />
        </div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight mb-2" style={{ fontFamily: "Chivo" }}>Account in attesa</h1>
        <p className="text-slate-600 text-sm mb-6">L'admin sta verificando <b>{user?.email}</b>. Riceverai accesso alla console non appena approvato.</p>
        <Button data-testid="pending-logout" variant="outline" onClick={logout} className="rounded-sm">Esci</Button>
      </div>
    </div>
  );
}
