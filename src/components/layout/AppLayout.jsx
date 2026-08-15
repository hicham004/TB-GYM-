import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import Sidebar from './Sidebar';
import { Button } from '@/components/ui/button';
import { Menu, ShieldAlert, Clock } from 'lucide-react';
import { parseISO, isAfter } from 'date-fns';
import { formatDate } from '@/lib/dateUtils';

export default function AppLayout() {
  const { user, isAdmin, refreshUser } = useCurrentUser();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: pendingRequests = [] } = useQuery({
    queryKey: ['access-requests-pending'],
    queryFn: () => api.entities.AccessRequest.filter({ status: 'pending' }),
    enabled: !!isAdmin,
    refetchInterval: 60000,
  });

  // Active program cycle for clients (used for block check only)
  const { data: activeCycles = [] } = useQuery({
    queryKey: ['active-cycle', user?.id],
    queryFn: () => api.entities.ProgramCycle.filter({ client_id: user?.id, status: 'active' }, '-start_date', 1),
    enabled: !!user?.id && !isAdmin,
    staleTime: 5 * 60 * 1000,
  });
  const activeCycle = activeCycles[0] || null;
  // Auto-block check â€” lightweight, no notification creation
  useEffect(() => {
    if (!user || isAdmin) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const programEndDate = activeCycle?.end_date || user.program_end_date;
    const paymentStatus = activeCycle?.payment_status || user.payment_status;
    const paymentDueDate = activeCycle?.payment_due_date || user.payment_due_date;

    let shouldBlock = false;
    if (programEndDate && !isAfter(parseISO(programEndDate), today)) shouldBlock = true;
    if (!shouldBlock && paymentDueDate && paymentStatus === 'not_paid' && !isAfter(parseISO(paymentDueDate), today)) shouldBlock = true;

    if (shouldBlock && !user.is_blocked) {
      api.entities.User.update(user.id, { is_blocked: true }).then(() => refreshUser());
    }
  }, [user?.id, activeCycle?.id, activeCycle?.end_date, activeCycle?.payment_status, activeCycle?.payment_due_date, isAdmin]);

  // Permanently deleted users
  if (user && user.is_deleted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-24 h-24 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-12 h-12 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Account Not Found</h1>
            <p className="text-muted-foreground mt-3 leading-relaxed">This account does not exist or has been removed from the platform.</p>
          </div>
          <Button variant="outline" onClick={() => api.auth.logout()}>Sign Out</Button>
        </div>
      </div>
    );
  }

  // Blocked â€” determine reason from active cycle
  if (user && !isAdmin && user.is_blocked) {
    const programEndDate = activeCycle?.end_date || user.program_end_date;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isExpired = programEndDate && !isAfter(parseISO(programEndDate), today);

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-24 h-24 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            {isExpired ? <Clock className="w-12 h-12 text-destructive" /> : <ShieldAlert className="w-12 h-12 text-destructive" />}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {isExpired ? 'Program Expired' : 'Account Temporarily Blocked'}
            </h1>
            <p className="text-muted-foreground mt-3 leading-relaxed">
              {isExpired
                ? 'Your coaching plan has expired. Please contact your coach to renew your program.'
                : 'Your account has been temporarily blocked because payment has not been received. Please contact your coach to restore access.'}
            </p>
          </div>
          {programEndDate && isExpired && (
            <div className="p-4 rounded-xl bg-muted/50 border border-border text-sm text-muted-foreground">
              Program ended: <span className="font-medium text-foreground">{formatDate(programEndDate)}</span>
            </div>
          )}
          <div className="p-4 rounded-xl bg-muted/50 border border-border text-sm text-muted-foreground">
            Reach out to your coach directly to restore access.
          </div>
          <Button variant="outline" onClick={() => api.auth.logout()}>Sign Out</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        isAdmin={isAdmin}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        unreadCount={0}
        pendingRequestsCount={pendingRequests.length}
      />

      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-background/80 backdrop-blur-md border-b border-border h-14 flex items-center px-4">
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)}>
          <Menu className="w-5 h-5" />
        </Button>
        <span className="ml-3 font-bold text-lg">FitCoach</span>
      </div>

      {/* Main content */}
      <main className={`transition-all duration-300 pt-14 lg:pt-0 ${collapsed ? 'lg:pl-[72px]' : 'lg:pl-64'}`}>
        <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
