import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      suppressHydrationWarning
      className={cn(
        "h-8 w-full rounded-[var(--radius-sm)] border border-border bg-bg px-2 text-[13px] text-fg outline-none placeholder:text-subtle focus:border-cold/60 focus:ring-1 focus:ring-cold/40",
        className,
      )}
      {...props}
    />
  );
}
