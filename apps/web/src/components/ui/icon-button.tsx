import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils";

type IconButtonProps = ComponentProps<"button"> & {
  label: string;
  children: ReactNode;
};

export function IconButton({ label, className, type = "button", children, ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        "tap inline-flex size-11 items-center justify-center rounded-control text-ink transition-colors duration-motion ease-out hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
