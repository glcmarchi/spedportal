import React from "react";
import { cn } from "@/lib/utils";
export const Input = React.forwardRef(({ className, type = "text", ...props }, ref) => (
  <input type={type} ref={ref} className={cn("flex h-10 w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-600 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />
));
Input.displayName = "Input";
