import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Activity, ArrowLeftRight, BarChart3, Bell, Boxes, ChevronDown, CircleDollarSign, CreditCard, FileClock, FileText, Gauge, LayoutDashboard, LogOut, Menu, Package, PanelLeftClose, PanelLeftOpen, Percent, Settings, Shield, Sparkles, Users, X } from "lucide-react";
import { Dashboard } from "./Dashboard";
import { ModulePage } from "./ModulePage";
import { AnalyticsPage } from "./AnalyticsPage";
import { ProfilePage } from "./ProfilePage";
import { useAuth } from "../state/auth";
import { requireSupabase, type AppRole } from "../lib/supabase";

type NavItem = { label: string; path: string; icon: typeof Gauge; roles?: AppRole[] };
type NavGroup = { label: string; items: NavItem[] };

const navigation: NavGroup[] = [
  { label: "OVERVIEW", items: [{ label: "Dashboard", path: "/dashboard", icon: LayoutDashboard }, { label: "Analytics", path: "/analytics", icon: BarChart3, roles: ["admin", "staff"] }] },
  { label: "YOUR BUSINESS", items: [{ label: "Customers", path: "/customers", icon: Users, roles: ["admin", "staff"] }, { label: "Products", path: "/products", icon: Package, roles: ["admin", "staff"] }, { label: "Plans", path: "/plans", icon: Boxes }, { label: "Quotations", path: "/quotations", icon: FileText, roles: ["admin", "staff"] }, { label: "Subscriptions", path: "/subscriptions", icon: Activity }, { label: "Invoices", path: "/invoices", icon: FileClock }, { label: "Payments", path: "/payments", icon: CreditCard, roles: ["admin", "staff"] }] },
  { label: "CONFIGURATION", items: [{ label: "Discounts", path: "/discounts", icon: Percent, roles: ["admin"] }, { label: "Tax settings", path: "/taxes", icon: CircleDollarSign, roles: ["admin"] }, { label: "Team", path: "/team", icon: Shield, roles: ["admin"] }] },
];
const customerNavigation: NavGroup[] = [
  { label: "YOUR ACCOUNT", items: [{ label: "Overview", path: "/dashboard", icon: LayoutDashboard }, { label: "My subscriptions", path: "/subscriptions", icon: Activity }, { label: "Plans", path: "/plans", icon: Boxes }, { label: "My invoices", path: "/invoices", icon: FileText }, { label: "Payment history", path: "/portal/payments", icon: CreditCard }, { label: "Profile", path: "/profile", icon: Settings }] },
];

const pageNames: Record<string, string> = {
  "/dashboard": "Overview", "/analytics": "Analytics", "/customers": "Customers", "/products": "Products", "/plans": "Subscription plans", "/quotations": "Quotations", "/subscriptions": "Subscriptions", "/invoices": "Invoices", "/payments": "Payments", "/discounts": "Discounts", "/taxes": "Tax settings", "/team": "Team", "/profile": "Profile", "/portal/payments": "Payment history",
};

export function OrbitApp() {
  const { profile, user, signOut } = useAuth();
  const location = useLocation();
  const role: AppRole = profile?.role ?? "customer";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [customerId, setCustomerId] = useState<string>();
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    if (role !== "customer" || !user) return;
    requireSupabase().from("customers").select("id").eq("user_id", user.id).maybeSingle().then(({ data, error }) => {
      if (error) console.error("Could not load customer portal profile.", error);
      setCustomerId(data?.id);
    });
  }, [role, user]);

  const visibleNavigation = (role === "customer" ? customerNavigation : navigation).map(group => ({ ...group, items: group.items.filter(item => !item.roles || item.roles.includes(role)) })).filter(group => group.items.length > 0);
  const path = location.pathname;
  const pageTitle = pageNames[path] ?? (path === "/portal/payments" ? "Payment history" : "Workspace");

  async function logout() {
    try {
      await signOut();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "Could not sign out.");
    }
  }

  return (
    <div className={`app-shell ${collapsed ? "app-shell--collapsed" : ""}`}>
      {sidebarOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "sidebar--open" : ""} ${collapsed ? "sidebar--collapsed" : ""}`}>
        <div className="sidebar-brand"><Link to="/dashboard" className="brand-lockup brand-lockup--light"><div className="orbit-mark"><i /><b /></div><span>ORBIT</span></Link><button className="sidebar-collapse icon-button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button><button className="sidebar-close icon-button" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
        <div className="workspace-switch"><div className="workspace-avatar">O</div><div className="workspace-name"><strong>{role === "customer" ? "My account" : "Orbit workspace"}</strong><span>{role === "customer" ? "Customer portal" : "Subscription intelligence"}</span></div><ChevronDown size={14} /></div>
        <nav className="sidebar-nav">{visibleNavigation.map(group => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span>{group.items.map(item => <Link key={item.path} to={item.path} onClick={() => setSidebarOpen(false)} title={collapsed ? item.label : undefined} className={`nav-item ${path === item.path || (path === "/portal/payments" && item.path === path) ? "nav-item--active" : ""}`}><item.icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.path === "/invoices" && role !== "customer" && <span className="nav-badge">!</span>}</Link>)}</div>)}</nav>
        <div className="sidebar-bottom"><div className="sidebar-tip"><div className="tip-icon"><Sparkles size={14} /></div><strong>In the loop</strong><span>Your recurring revenue, at a glance.</span><button onClick={() => window.location.assign("/analytics")}>Explore analytics <ArrowLeftRight size={13} /></button></div><button className="sidebar-profile" onClick={() => window.location.assign("/profile")}><div className="profile-avatar">{(profile?.full_name || user?.email || "O").slice(0, 1).toUpperCase()}</div><div className="profile-name"><strong>{profile?.full_name || user?.email?.split("@")[0] || "Your account"}</strong><span>{role}</span></div><button className="profile-logout" aria-label="Sign out" onClick={event => { event.stopPropagation(); void logout(); }}><LogOut size={15} /></button></button></div>
      </aside>
      <div className="app-main"><header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{pageTitle}</strong></div></div><div className="topbar-right"><span className="topbar-date">{new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" }).format(new Date())}</span><button className="topbar-bell icon-button" aria-label="Notifications"><Bell size={17} /><i /></button><div className="topbar-avatar">{(profile?.full_name || user?.email || "O").slice(0, 1).toUpperCase()}</div></div></header>
        {logoutError && <div className="global-alert">{logoutError}<button onClick={() => setLogoutError("")}><X size={14} /></button></div>}
        <Routes>
          <Route path="/dashboard" element={<Dashboard role={role} />} />
          <Route path="/analytics" element={<AnalyticsPage role={role} />} />
          <Route path="/products" element={<ModulePage module="products" role={role} />} />
          <Route path="/plans" element={<ModulePage module="plans" role={role} />} />
          <Route path="/customers" element={<ModulePage module="customers" role={role} />} />
          <Route path="/quotations" element={<ModulePage module="quotations" role={role} />} />
          <Route path="/subscriptions" element={<ModulePage module="subscriptions" role={role} customerId={customerId} />} />
          <Route path="/invoices" element={<ModulePage module="invoices" role={role} customerId={customerId} />} />
          <Route path="/payments" element={<ModulePage module="payments" role={role} />} />
          <Route path="/portal/payments" element={<ModulePage module="payments" role={role} customerId={customerId} />} />
          <Route path="/discounts" element={<ModulePage module="discounts" role={role} />} />
          <Route path="/taxes" element={<ModulePage module="taxes" role={role} />} />
          <Route path="/team" element={<ModulePage module="staff" role={role} />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </div>
    </div>
  );
}
