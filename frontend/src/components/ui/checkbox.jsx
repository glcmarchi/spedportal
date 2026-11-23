import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
export const Checkbox = React.forwardRef(({ className, checked, onCheckedChange, ...props }, ref) => (
  <button type="button" role="checkbox" aria-checked={!!checked} ref={ref} onClick={() => onCheckedChange && onCheckedChange(!checked)}
    className={cn("h-4 w-4 shrink-0 rounded-sm border border-slate-400 flex items-center justify-center transition-colors", checked ? "bg-orange-600 border-orange-600 text-white" : "bg-white", className)} {...props}>
    {checked && <Check className="h-3 w-3 stroke-[3]" />}
  </button>
));
Checkbox.displayName = "Checkbox";
