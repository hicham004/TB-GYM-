import React from 'react';
import { useCurrentUser } from '@/lib/useCurrentUser';
import AdminDashboard from './AdminDashboard';
import ClientDashboard from './ClientDashboard';

export default function Dashboard() {
  const { user, loading, isAdmin } = useCurrentUser();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return isAdmin ? <AdminDashboard /> : <ClientDashboard />;
}
