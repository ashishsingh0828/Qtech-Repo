import type { NavIcon, NavItem } from "@app/shared";
import { ROLE_COPY, ROLE_REGISTRY } from "@app/shared";
import { LogOut, Menu, Rows3, Shield, Table, Trash2, Users, X, LayoutDashboard, Columns3, ScrollText, Ellipsis } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { IconButton, Pill, Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../../components/ui";
import type { PillTone } from "../../components/ui";
import { useAppName } from "../../lib/app-name";
import { errorText } from "../../lib/errors";
import { initials } from "../../lib/initials";
import { cn } from "../../lib/utils";
import { useAuth } from "../auth/auth-gate";
import { ChangePasswordDialog } from "../auth/change-password-dialog";
import { endSession } from "../auth/session";
import { NotificationBell } from "../notifications/bell";
import { LiveStatus, RealtimeProvider } from "../realtime/realtime";
import { CommandPalette } from "../workspace/command-palette";
import { isAccountsUser } from "../workspace/desk-kit";
import { getActiveKey, setActiveKey } from "../workspace/keyboard";

const DESK_NAV = [
  { id: "engineer", title: "Service Engineer", hint: "My PMs and AMC calls" },
  { id: "coordinator", title: "Service Coordinator", hint: "Monthly PM calendar" },
  { id: "manager", title: "Service Manager", hint: "Escalations and renewals" },
  { id: "accounts", title: "Accounts", hint: "AMC and cheques" },
  { id: "admin", title: "Admin", hint: "Data and validation" },
] as const;

const ICONS: Record<NavIcon, ComponentType<{ className?: string; strokeWidth?: number }>> = {
  home: LayoutDashboard,
  rows: Rows3,
  table: Table,
  schema: Columns3,
  trash: Trash2,
  users: Users,
  shield: Shield,
  activity: ScrollText,
};

const ROLE_TONE: Record<string, PillTone> = {
  admin: "navy",
  manager: "sapphire",
  validator: "amber",
  service: "emerald",
};

export function AppShell() {
  const { user } = useAuth();
  const appName = useAppName();
  const location = useLocation();
  const navigate = useNavigate();
  const items = ROLE_REGISTRY[user.role].nav.filter((item) => item.id !== "home");
  const deskId = currentDesk(user);
  const [railOpen, setRailOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    setRailOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const box = document.querySelector<HTMLElement>("[data-search]");
        if (!box) return;
        event.preventDefault();
        box.focus();
        return;
      }
      const typingKey = event.key === "j" || event.key === "J" || event.key === "k" || event.key === "K" || event.key === "Enter";
      if (!typingKey || event.metaKey || event.ctrlKey || event.altKey) return;
      const cards = [...document.querySelectorAll<HTMLElement>("[data-work-card]")];
      if (cards.length === 0) return;
      if (event.key === "Enter") {
        if (target instanceof HTMLElement && target.closest("button, a")) return;
        const current = cards.find((card) => card.dataset.cardKey === getActiveKey()) ?? cards[0];
        const datasetId = current?.dataset.datasetId;
        const rowId = current?.dataset.rowId;
        if (!datasetId || !rowId) return;
        event.preventDefault();
        void navigate(`/records/${datasetId}?row=${rowId}`);
        return;
      }
      event.preventDefault();
      const index = cards.findIndex((card) => card.dataset.cardKey === getActiveKey());
      const next = event.key.toLowerCase() === "j" ? Math.min(cards.length - 1, index < 0 ? 0 : index + 1) : Math.max(0, index < 0 ? 0 : index - 1);
      const card = cards[next];
      if (!card?.dataset.cardKey) return;
      setActiveKey(card.dataset.cardKey);
      card.scrollIntoView({ block: "nearest" });
      card.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  async function onLogout() {
    setSigningOut(true);
    try {
      await endSession();
      await navigate("/login", { replace: true });
    } catch (error) {
      toast.error(errorText(error, "Could not sign out."));
    } finally {
      setSigningOut(false);
    }
  }

  const copy = isAccountsUser(user)
    ? { title: "Accounts", blurb: "Follow AMC outcomes, cheque dates and accepted contracts." }
    : ROLE_COPY[user.role];

  return (
    <RealtimeProvider>
    <div className="grid h-dvh grid-cols-1 overflow-hidden bg-canvas md:grid-cols-[64px_minmax(0,1fr)] xl:grid-cols-[244px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 min-w-0 bg-navy text-[#c9dcdc] md:flex md:flex-col">
        <Sidebar appName={appName} items={items} deskId={deskId} collapsed onOpenRail={() => setRailOpen(true)} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="z-topbar flex h-[var(--topbar-h)] shrink-0 items-center gap-3 border-b border-hairline bg-surface px-4 md:px-6">
          <NavLink to="/" className="hidden min-w-0 shrink truncate font-serif text-xl font-semibold text-ink sm:inline xl:hidden">
            ServiceDesk
          </NavLink>
          <p className="hidden min-w-0 truncate text-sm text-ink-2 sm:block">{copy.blurb}</p>
          <div className="ml-auto flex items-center gap-2">
            <LiveStatus />
            <NotificationBell />
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Account menu"
                  className="tap inline-flex size-11 items-center justify-center rounded-full"
                >
                  <span className="inline-flex size-9 items-center justify-center rounded-full bg-navy text-xs font-medium text-canvas">
                    {initials(user.name)}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64">
                <div className="flex min-w-0 flex-col gap-2 px-1 pb-2">
                  <p className="truncate font-medium text-ink">{user.name}</p>
                  <Pill tone={ROLE_TONE[user.role] ?? "stone"}>{copy.title}</Pill>
                </div>
                <PopoverClose asChild>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center rounded-control px-2 text-left text-sm text-ink hover:bg-surface-2"
                    onClick={() => setPasswordOpen(true)}
                  >
                    Change password
                  </button>
                </PopoverClose>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-2 rounded-control px-2 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-50"
                  onClick={() => void onLogout()}
                  disabled={signingOut}
                >
                  <LogOut className="size-4" strokeWidth={1.5} />
                  Logout
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </header>
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", items.length > 0 && "pb-16 md:pb-0")}>
          <div className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-content flex-col overflow-y-auto overflow-x-hidden px-4 py-4 md:px-6 md:py-6 xl:px-8">
            <Outlet />
          </div>
        </div>
      </div>
      {items.length > 0 ? <BottomNav items={items} /> : null}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      {railOpen
        ? createPortal(
            <div className="xl:hidden">
              <button
                type="button"
                aria-label="Close navigation"
                className="fixed inset-0 z-scrim bg-navy/40"
                onClick={() => setRailOpen(false)}
              />
              <div className="fixed inset-y-0 left-0 z-drawer flex w-[244px] max-w-[92vw] flex-col bg-navy text-[#c9dcdc] shadow-float">
                <Sidebar appName={appName} items={items} deskId={deskId} onClose={() => setRailOpen(false)} />
              </div>
            </div>,
            document.body,
          )
        : null}
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
    </RealtimeProvider>
  );
}

function currentDesk(user: { role: string; email: string }): (typeof DESK_NAV)[number]["id"] {
  if (isAccountsUser(user)) return "accounts";
  if (user.role === "admin") return "admin";
  if (user.role === "manager") return "manager";
  if (user.role === "validator") return "coordinator";
  return "engineer";
}

function Sidebar({
  appName,
  items,
  deskId,
  collapsed = false,
  onOpenRail,
  onClose,
}: {
  appName: string;
  items: readonly NavItem[];
  deskId: (typeof DESK_NAV)[number]["id"];
  collapsed?: boolean;
  onOpenRail?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-2 py-5">
      <div
        className={cn(
          "mb-6 flex items-center gap-2.5 px-2",
          collapsed && "justify-center px-0 xl:justify-start xl:px-2",
        )}
      >
        {collapsed ? (
          <NavLink to="/" className="grid size-[34px] place-items-center rounded-[4px] bg-gold font-serif text-[18px] font-bold text-[#2a1d00] xl:hidden" aria-label={appName}>
            SD
          </NavLink>
        ) : null}
        <NavLink to="/" className={cn("flex min-w-0 items-center gap-2.5", collapsed && "hidden xl:flex")}>
          <span className="grid size-[34px] shrink-0 place-items-center rounded-[4px] bg-gold font-serif text-[18px] font-bold text-[#2a1d00]">
            SD
          </span>
          <b className="truncate font-serif text-2xl font-semibold text-white">ServiceDesk</b>
        </NavLink>
        {onClose ? (
          <IconButton label="Close navigation" className="ml-auto text-[#c9dcdc] hover:bg-navy-2" onClick={onClose}>
            <X className="size-4" strokeWidth={1.5} />
          </IconButton>
        ) : null}
      </div>
      {collapsed && onOpenRail ? (
        <div className="mb-3 flex justify-center xl:hidden">
          <IconButton label="Open navigation" className="text-[#c9dcdc] hover:bg-navy-2" onClick={onOpenRail}>
            <Menu className="size-4" strokeWidth={1.5} />
          </IconButton>
        </div>
      ) : null}
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Main">
        {DESK_NAV.map((desk) => {
          const active = desk.id === deskId;
          const className = cn(
            "relative flex min-h-11 min-w-0 items-center gap-3 rounded-[6px] border-l-[3px] px-3 py-2 text-left text-[15px]",
            collapsed && "justify-center px-0 xl:justify-start xl:px-3",
            active ? "border-l-gold bg-white/10 text-white" : "border-transparent text-[#c9dcdc] opacity-55",
          );
          const body = (
            <span className={cn("min-w-0", collapsed && "hidden xl:block")}>
              <span className="block truncate font-medium">{desk.title}</span>
              <small className="block truncate text-[12px] text-[#85a2a4]">{desk.hint}</small>
            </span>
          );
          if (active) {
            return (
              <NavLink key={desk.id} to="/" end className={className}>
                {body}
              </NavLink>
            );
          }
          return (
            <span key={desk.id} className={className} title="Sign in on that desk">
              {body}
            </span>
          );
        })}
        {items.map((item) => (
          <NavItemLink key={item.id} item={item} collapsed={collapsed} />
        ))}
      </nav>
    </div>
  );
}

function NavItemLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = ICONS[item.icon];
  return (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      className={({ isActive }) =>
        cn(
          "relative flex min-h-11 min-w-0 items-center gap-3 rounded-[6px] border-l-[3px] border-transparent px-3 py-2 text-[15px] text-[#c9dcdc] hover:bg-white/5 focus-visible:outline-gold",
          collapsed && "justify-center px-0 xl:justify-start xl:px-3",
          isActive && "border-l-gold bg-white/10 text-white",
        )
      }
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.5} />
      <span className={cn("min-w-0", collapsed && "hidden xl:block")}>
        <span className="block truncate font-medium">{item.label}</span>
        {item.hint ? <small className="block truncate text-[12px] text-[#85a2a4]">{item.hint}</small> : null}
      </span>
    </NavLink>
  );
}

function BottomNav({ items }: { items: readonly NavItem[] }) {
  const [more, setMore] = useState(false);
  const overflow = items.length > 5;
  const primary = overflow ? items.slice(0, 4) : items;
  const extra = overflow ? items.slice(4) : [];
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-topbar flex h-16 border-t border-hairline bg-surface md:hidden">
        {primary.map((item) => (
          <BottomLink key={item.id} item={item} />
        ))}
        {overflow ? (
          <button type="button" className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs text-ink-2" onClick={() => setMore(true)}>
            <span className="h-0.5 w-8 bg-transparent" />
            <Ellipsis className="size-4" strokeWidth={1.5} />
            <span className="max-w-full truncate px-1">More</span>
          </button>
        ) : null}
      </nav>
      {overflow ? (
        <div className="md:hidden">
          <MoreSheet open={more} items={extra} onClose={() => setMore(false)} />
        </div>
      ) : null}
    </>
  );
}

function BottomLink({ item }: { item: NavItem }) {
  const Icon = ICONS[item.icon];
  return (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      className={({ isActive }) =>
        cn("flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs", isActive ? "text-ink" : "text-ink-2")
      }
    >
      {({ isActive }) => (
        <>
          <span className={cn("h-0.5 w-8", isActive ? "bg-gold" : "bg-transparent")} />
          <Icon className="size-4" strokeWidth={1.5} />
          <span className="max-w-full truncate px-1">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

function MoreSheet({ open, items, onClose }: { open: boolean; items: readonly NavItem[]; onClose: () => void }) {
  return (
    <div className={cn("fixed inset-0 z-scrim bg-navy/40", open ? "block" : "hidden")} onClick={onClose}>
      <div className="absolute inset-x-0 bottom-16 rounded-t-card border border-hairline bg-surface p-3" onClick={(event) => event.stopPropagation()}>
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <NavLink
              key={item.id}
              to={item.path}
              end={item.path === "/"}
              className="flex min-h-11 items-center gap-3 rounded-control px-3 text-sm text-ink"
              onClick={onClose}
            >
              <Icon className="size-4" strokeWidth={1.5} />
              {item.label}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
