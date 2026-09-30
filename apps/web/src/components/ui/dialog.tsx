import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
import { IconButton } from "./icon-button";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-scrim bg-navy/40" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-dialog flex flex-col bg-surface outline-none",
          "max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[92vh] max-md:rounded-t-card max-md:border-t max-md:border-hairline",
          "md:left-1/2 md:top-1/2 md:max-h-[85vh] md:w-[min(32rem,92vw)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:border md:border-hairline md:shadow-float",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close asChild>
          <IconButton label="Close" className="absolute right-2 top-2">
            <X className="size-4" strokeWidth={1.5} />
          </IconButton>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 px-5 pb-2 pr-14 pt-5", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-medium text-ink", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-ink-2", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "sticky bottom-0 mt-auto flex flex-wrap justify-end gap-2 border-t border-hairline bg-surface px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}
