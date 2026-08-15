import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bell, CheckCheck, AlertTriangle, CreditCard, Calendar, Info, MessageCircle } from 'lucide-react';
import { formatDateTime } from '@/lib/dateUtils';

const typeIcons = {
  payment_warning: CreditCard,
  payment_overdue: AlertTriangle,
  program_ending: Calendar,
  program_ended: Calendar,
  coach_update: Info,
  new_message: MessageCircle,
  general: Info,
};

const typeColors = {
  payment_warning: 'bg-chart-4/10 text-chart-4',
  payment_overdue: 'bg-destructive/10 text-destructive',
  program_ending: 'bg-primary/10 text-primary',
  program_ended: 'bg-chart-2/10 text-chart-2',
  coach_update: 'bg-chart-3/10 text-chart-3',
  new_message: 'bg-primary/10 text-primary',
  general: 'bg-muted text-muted-foreground',
};

export default function ClientNotifications() {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: () => api.entities.Notification.filter({ user_id: user?.id }, '-created_date'),
    enabled: !!user?.id,
  });

  const markRead = useMutation({
    mutationFn: (id) => api.entities.Notification.update(id, { read: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unread = notifications.filter(n => !n.read);
      await Promise.all(unread.map(n => api.entities.Notification.update(n.id, { read: true })));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  });

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground mt-1">{unreadCount} unread</p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()}>
            <CheckCheck className="w-4 h-4 mr-2" />Mark all read
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {notifications.map(notif => {
          const Icon = typeIcons[notif.type] || Info;
          const colorClass = typeColors[notif.type] || typeColors.general;
          return (
            <Card key={notif.id} className={`border-0 shadow-sm transition-all ${!notif.read ? 'ring-2 ring-primary/20' : 'opacity-70'}`}>
              <CardContent className="p-4 flex items-start gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm">{notif.title}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">{notif.message}</p>
                    </div>
                    {!notif.read && (
                      <Button variant="ghost" size="sm" className="flex-shrink-0 text-xs" onClick={() => markRead.mutate(notif.id)}>
                        Mark read
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {formatDateTime(notif.created_date)}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {notifications.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <Bell className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">All caught up!</p>
          <p className="text-sm">No notifications yet</p>
        </div>
      )}
    </div>
  );
}
