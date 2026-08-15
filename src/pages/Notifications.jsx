import React from 'react';
import { useCurrentUser } from '@/lib/useCurrentUser';
import ClientNotifications from '@/components/notifications/ClientNotifications';
import AdminNotifications from './AdminNotifications';

export default function Notifications() {
  const { user, isAdmin, loading } = useCurrentUser();

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  if (isAdmin) return <AdminNotifications />;
  return <ClientNotifications />;
}
