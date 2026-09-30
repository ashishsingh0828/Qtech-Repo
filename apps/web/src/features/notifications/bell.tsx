import { useQuery } from "@tanstack/react-query";
import { isToday } from "date-fns";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  EmptyState,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { initials } from "../../lib/initials";
import { queryClient } from "../../lib/query";
import { cn } from "../../lib/utils";
import { toast } from "sonner";

type NotificationItem = {
  id: string;
  type: string;
  priority: "normal" | "high";
  summary: string;
  actorName: string;
  createdAt: string;
  read: boolean;
  href: string | null;
};

type NotificationsResponse = {
  unreadCount: number;
  hasHigh: boolean;
  items: NotificationItem[];
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<NotificationsResponse>("/api/notifications?limit=40"),
  });
  const data = notifications.data ?? { unreadCount: 0, hasHigh: false, items: [] };

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const apply = (): void => setMobile(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  async function markRead(id: string) {
    await api(`/api/notifications/${id}/read`, { method: "POST" });
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function markAll() {
    try {
      await api("/api/notifications/read-all", { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } catch (error) {
      toast.error(errorText(error, "Could not mark notifications read."));
    }
  }

  const trigger = (
    <button type="button" aria-label="Notifications" className="tap relative inline-flex size-11 items-center justify-center rounded-full">
      <Bell className="size-5" strokeWidth={1.5} />
      {data.unreadCount > 0 ? (
        <span className="absolute right-0 top-0 inline-flex min-w-4 items-center justify-center rounded-full bg-navy px-1 text-[10px] leading-4 text-canvas">
          {data.unreadCount > 99 ? "99+" : data.unreadCount}
        </span>
      ) : null}
      {data.hasHigh ? <span className="absolute bottom-1.5 right-1.5 size-2 rounded-full bg-gold" /> : null}
    </button>
  );

  const panel = <NotificationList items={data.items} onRead={(id) => void markRead(id)} onReadAll={() => void markAll()} onNavigate={() => setOpen(false)} />;

  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <button type="button" aria-label="Notifications" className="tap relative inline-flex size-11 items-center justify-center rounded-full" onClick={() => setOpen(true)}>
          <Bell className="size-5" strokeWidth={1.5} />
          {data.unreadCount > 0 ? (
            <span className="absolute right-0 top-0 inline-flex min-w-4 items-center justify-center rounded-full bg-navy px-1 text-[10px] leading-4 text-canvas">
              {data.unreadCount > 99 ? "99+" : data.unreadCount}
            </span>
          ) : null}
          {data.hasHigh ? <span className="absolute bottom-1.5 right-1.5 size-2 rounded-full bg-gold" /> : null}
        </button>
        <SheetContent className="max-md:inset-0 md:hidden">
          <SheetHeader>
            <SheetTitle>Notifications</SheetTitle>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        {panel}
      </PopoverContent>
    </Popover>
  );
}

function NotificationList({
  items,
  onRead,
  onReadAll,
  onNavigate,
}: {
  items: NotificationItem[];
  onRead: (id: string) => void;
  onReadAll: () => void;
  onNavigate: () => void;
}) {
  const navigate = useNavigate();
  const today = items.filter((item) => isToday(new Date(item.createdAt)));
  const earlier = items.filter((item) => !isToday(new Date(item.createdAt)));

  function open(item: NotificationItem) {
    if (!item.read) onRead(item.id);
    onNavigate();
    if (item.href) void navigate(item.href);
  }

  return (
    <div className="flex max-h-[70vh] min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <p className="text-sm font-medium text-ink">Notifications</p>
        <Button variant="secondary" className="h-8 px-2 text-xs" onClick={onReadAll} disabled={items.every((item) => item.read)}>
          Mark all read
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState message="No notifications yet." />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <Section title="Today" items={today} onOpen={open} onRead={onRead} />
          <Section title="Earlier" items={earlier} onOpen={open} onRead={onRead} />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  items,
  onOpen,
  onRead,
}: {
  title: string;
  items: NotificationItem[];
  onOpen: (item: NotificationItem) => void;
  onRead: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-2">{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item.id} className={cn("flex items-start gap-3 px-3 py-2", !item.read && "bg-gold-soft/60")}>
            <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => onOpen(item)}>
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-navy text-[10px] text-canvas">
                {initials(item.actorName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-ink">{item.summary}</span>
                <span className="text-xs text-ink-2">{relativeTime(item.createdAt)}</span>
              </span>
            </button>
            {!item.read ? (
              <button type="button" className="shrink-0 text-xs text-ink-2 underline" onClick={() => onRead(item.id)}>
                Mark read
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
