import type { NavIcon, NavItem } from "@app/shared";
import { ROLE_REGISTRY } from "@app/shared";
import { LogOut, Menu, Shield, Users, X } from "lucide-react";
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

const ICONS: Record<NavIcon, ComponentType<{ className?: string; strokeWidth?: number }>> = {
  users: Users,
  shield: Shield,
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
  const items = ROLE_REGISTRY[user.role].nav;
  const [railOpen, setRailOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setRailOpen(false);
  }, [location.pathname]);

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

  return (
    <div className="grid h-dvh grid-cols-1 overflow-hidden bg-canvas md:grid-cols-[64px_minmax(0,1fr)] xl:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 min-w-0 bg-navy text-canvas md:flex md:flex-col">
        <Sidebar appName={appName} items={items} collapsed onOpenRail={() => setRailOpen(true)} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="z-topbar flex h-[var(--topbar-h)] shrink-0 items-center gap-3 border-b border-hairline bg-surface px-4 md:px-6">
          <NavLink to="/" className="min-w-0 truncate font-serif text-lg text-ink xl:hidden">
            {appName}
          </NavLink>
          <div className="ml-auto">
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
                  <Pill tone={ROLE_TONE[user.role] ?? "stone"}>{ROLE_REGISTRY[user.role].label}</Pill>
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
        <div className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden", items.length > 0 && "pb-16 md:pb-0")}>
          <div className="mx-auto flex w-full min-w-0 max-w-content flex-col px-4 py-4 md:px-6 md:py-6 xl:px-8">
            <Outlet />
          </div>
        </div>
      </div>
      {items.length > 0 ? <BottomNav items={items} /> : null}
      {railOpen
        ? createPortal(
            <div className="xl:hidden">
              <button
                type="button"
                aria-label="Close navigation"
                className="fixed inset-0 z-scrim bg-navy/40"
                onClick={() => setRailOpen(false)}
              />
              <div className="fixed inset-y-0 left-0 z-drawer flex w-[232px] max-w-[92vw] flex-col bg-navy text-canvas shadow-float">
                <Sidebar appName={appName} items={items} onClose={() => setRailOpen(false)} />
              </div>
            </div>,
            document.body,
          )
        : null}
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
  );
}

function Sidebar({
  appName,
  items,
  collapsed = false,
  onOpenRail,
  onClose,
}: {
  appName: string;
  items: readonly NavItem[];
  collapsed?: boolean;
  onOpenRail?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "flex h-14 items-center gap-2 px-3",
          collapsed && "justify-center px-0 xl:justify-start xl:px-3",
        )}
      >
        {collapsed ? (
          <NavLink to="/" className="font-serif text-lg text-canvas xl:hidden" aria-label={appName}>
            Q
          </NavLink>
        ) : null}
        <NavLink
          to="/"
          className={cn("min-w-0 flex-1 truncate font-serif text-lg text-canvas", collapsed && "hidden xl:inline")}
        >
          {appName}
        </NavLink>
        {onClose ? (
          <IconButton label="Close navigation" className="text-canvas hover:bg-navy-2" onClick={onClose}>
            <X className="size-4" strokeWidth={1.5} />
          </IconButton>
        ) : null}
      </div>
      {collapsed && onOpenRail ? (
        <div className="flex justify-center xl:hidden">
          <IconButton label="Open navigation" className="text-canvas hover:bg-navy-2" onClick={onOpenRail}>
            <Menu className="size-4" strokeWidth={1.5} />
          </IconButton>
        </div>
      ) : null}
      <nav className="flex min-h-0 flex-1 flex-col gap-1 px-2">
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
      className={({ isActive }) =>
        cn(
          "relative flex min-h-11 min-w-0 items-center gap-3 rounded-control px-3 text-sm text-canvas hover:bg-navy-2",
          collapsed && "justify-center px-0 xl:justify-start xl:px-3",
          isActive && "bg-navy-2 before:absolute before:left-0 before:h-6 before:w-0.5 before:bg-gold",
        )
      }
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.5} />
      <span className={cn("truncate", collapsed && "hidden xl:inline")}>{item.label}</span>
    </NavLink>
  );
}

function BottomNav({ items }: { items: readonly NavItem[] }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-topbar flex h-16 border-t border-hairline bg-surface md:hidden">
      {items.slice(0, 5).map((item) => {
        const Icon = ICONS[item.icon];
        return (
          <NavLink
            key={item.id}
            to={item.path}
            className={({ isActive }) =>
              cn(
                "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs",
                isActive ? "text-ink" : "text-ink-2",
              )
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
      })}
    </nav>
  );
}
