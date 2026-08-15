import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '@/lib/themeContext';
import {
  LayoutDashboard, Users, Dumbbell, UtensilsCrossed, Calendar,
  LineChart, Bell, Calculator, Library, ClipboardList,
  Sun, Moon, LogOut, X, ChevronLeft, Video, ShieldCheck, FlaskConical
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/api/localClient';
import { Badge } from '@/components/ui/badge';

const adminLinks = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/clients', icon: Users, label: 'Clients' },
  { to: '/access-requests', icon: ShieldCheck, label: 'Access Requests' },
  { to: '/exercises', icon: Dumbbell, label: 'Exercise Library' },
  { to: '/programs', icon: ClipboardList, label: 'Programs' },
  { to: '/meals', icon: UtensilsCrossed, label: 'Meal Library' },
  { to: '/diet-plans', icon: Library, label: 'Diet Plans' },
  { to: '/calendar', icon: Calendar, label: 'Calendar' },
  { to: '/notifications', icon: Bell, label: 'Notifications' },
  { to: '/tools', icon: Calculator, label: 'Fitness Tools' },
  { to: '/simulator', icon: FlaskConical, label: 'Subscription Sim' },
];

const clientLinks = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/my-program', icon: Dumbbell, label: 'My Program' },
  { to: '/my-diet', icon: UtensilsCrossed, label: 'My Diet' },
  { to: '/progress', icon: LineChart, label: 'Progress' },
  { to: '/videos', icon: Video, label: 'Videos' },
  { to: '/calendar', icon: Calendar, label: 'Calendar' },
  { to: '/notifications', icon: Bell, label: 'Notifications' },
  { to: '/tools', icon: Calculator, label: 'Fitness Tools' },
];

export default function Sidebar({ isAdmin, collapsed, setCollapsed, mobileOpen, setMobileOpen, unreadCount, pendingRequestsCount = 0 }) {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const links = isAdmin ? adminLinks : clientLinks;

  const handleLogout = () => {
    api.auth.logout();
  };

  const NavContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-4 flex items-center justify-between border-b border-sidebar-border">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
              <Dumbbell className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg text-sidebar-foreground tracking-tight">FitCoach</span>
          </div>
        )}
        {collapsed && (
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center mx-auto">
            <Dumbbell className="w-5 h-5 text-primary-foreground" />
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="hidden lg:flex h-7 w-7 text-muted-foreground"
          onClick={() => setCollapsed(!collapsed)}
        >
          <ChevronLeft className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {links.map(link => {
          const isActive = location.pathname === link.to;
          return (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                ${isActive
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent'
                }
                ${collapsed ? 'justify-center' : ''}
              `}
            >
              <link.icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{link.label}</span>}
              {!collapsed && link.to === '/notifications' && unreadCount > 0 && (
                <Badge variant="destructive" className="ml-auto text-xs px-1.5 py-0.5 min-w-[20px] text-center">
                  {unreadCount}
                </Badge>
              )}
              {!collapsed && link.to === '/access-requests' && pendingRequestsCount > 0 && (
                <Badge variant="destructive" className="ml-auto text-xs px-1.5 py-0.5 min-w-[20px] text-center">
                  {pendingRequestsCount}
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="p-3 border-t border-sidebar-border space-y-1">
        <button
          onClick={toggleTheme}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium w-full
            text-sidebar-foreground hover:bg-sidebar-accent transition-all
            ${collapsed ? 'justify-center' : ''}
          `}
        >
          {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
          {!collapsed && <span>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>}
        </button>
        <button
          onClick={handleLogout}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium w-full
            text-destructive hover:bg-destructive/10 transition-all
            ${collapsed ? 'justify-center' : ''}
          `}
        >
          <LogOut className="w-5 h-5" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Mobile sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border
        transform transition-transform lg:hidden
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="absolute top-4 right-4">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)}>
            <X className="w-5 h-5" />
          </Button>
        </div>
        <NavContent />
      </aside>

      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex flex-col fixed inset-y-0 left-0 z-30
        bg-sidebar border-r border-sidebar-border transition-all duration-300
        ${collapsed ? 'w-[72px]' : 'w-64'}
      `}>
        <NavContent />
      </aside>
    </>
  );
}
