import { Slot } from "@radix-ui/react-slot";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

const variants = {
  primary: "bg-navy text-canvas hover:bg-navy-2",
  secondary: "border border-hairline bg-surface text-ink hover:bg-surface-2",
  ghost: "bg-transparent text-ink hover:bg-surface-2",
} as const;

const sizes = {
  md: "min-h-11 px-4 text-sm",
  sm: "min-h-11 px-3 text-sm md:min-h-9",
} as const;

type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  asChild?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  asChild = false,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  const classNames = cn(
    "inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors duration-motion ease-out disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );
  if (asChild) {
    return <Slot className={classNames} {...props} />;
  }
  return <button type={type} className={classNames} {...props} />;
}
