import React from "react";
import { cn } from "@/lib/utils";
export const Button = React.forwardRef(({ className, variant = "default", size = "default", ...props }, ref) => {
  const variants = {
    default: "bg-slate-900 text-white hover:bg-slate-800",
    outline: "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
    ghost: "hover:bg-slate-100 text-slate-900",
  };
  const sizes = { default: "h-10 px-4 py-2", sm: "h-8 px-3 text-xs", lg: "h-11 px-8" };
  return (
    <button ref={ref} className={cn("inline-flex items-center justify-center rounded-sm text-sm font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none", variants[variant] || variants.default, sizes[size] || sizes.default, className)} {...props} />
  );
});
Button.displayName = "Button";
