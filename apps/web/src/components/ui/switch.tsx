import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn("group tap inline-flex h-11 w-14 items-center justify-center rounded-control", className)}
      {...props}
    >
      <span className="relative h-5 w-9 rounded-full border border-hairline bg-surface-2 transition-colors duration-motion group-data-[state=checked]:border-navy group-data-[state=checked]:bg-navy">
        <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-surface transition-transform duration-motion data-[state=checked]:translate-x-[18px]" />
      </span>
    </SwitchPrimitive.Root>
  );
}
