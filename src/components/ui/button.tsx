import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] text-[13px] font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cold/50",
  {
    variants: {
      variant: {
        default: "bg-fg text-accent-fg hover:bg-accent",
        ghost: "bg-transparent text-fg hover:bg-raised",
        outline: "border border-border bg-transparent text-fg hover:bg-raised",
        danger: "bg-crit text-fg hover:opacity-90",
        cold: "bg-cold/20 text-cold hover:bg-cold/30",
      },
      size: {
        sm: "h-8 px-2.5",
        md: "h-9 px-3",
        icon: "size-8 p-0",
      },
    },
    defaultVariants: { variant: "ghost", size: "sm" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
