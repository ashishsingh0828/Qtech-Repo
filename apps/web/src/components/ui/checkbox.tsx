import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "group tap inline-flex size-11 items-center justify-center rounded-control text-canvas",
        className,
      )}
      {...props}
    >
      <span className="flex size-4 items-center justify-center rounded-[4px] border border-hairline bg-surface group-data-[state=checked]:border-navy group-data-[state=checked]:bg-navy">
        <CheckboxPrimitive.Indicator>
          <Check className="size-3" strokeWidth={1.5} />
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  );
}
