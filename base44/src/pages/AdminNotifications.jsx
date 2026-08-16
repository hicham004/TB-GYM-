import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, CheckCheck, AlertTriangle, CreditCard, Calendar, Info, MessageCircle, User, ExternalLink } from 'lucide-react';
import { formatDateTime } from '@/lib/dateUtils';
import { useNavigate } from 'react-router-dom';

const notifIcons = {
  payment_warning: CreditCard,
  payment_overdue: AlertTriangle,
  program_ending: Calendar,
  program_ended: Calendar,
  coach_update: Info,
  new_message: MessageCircle,
  general: Info,
};

const notifColors = {
  payment_warning: 'bg-chart-4/10 text-chart-4',
  payment_overdue: 'bg-destructive/10 text-destructive',
  program_ending: 'bg-primary/10 text-primary',
  program_ended: 'bg-chart-2/10 text-chart-2',
  coach_update: 'bg-chart-3/10 text-chart-3',
  new_message: 'bg-primary/10 text-primary',
  general: 'bg-muted text-muted-foreground',
};

export default function AdminNotifications() {
  const { isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Load all clients
  const { data: clients = [] } = useQuery({
    queryKey: ['all-clients'],
    queryFn: () => api.entities.User.filter({ role: 'client' }),
    enabled: isAdmin,
  });

  // Load all notifications (for all clients)
  const { data: allNotifications = [] } = useQuery({
    queryKey: ['all-notifications'],
    queryFn: () => api.entities.Notification.list('-created_date', 200),
    enabled: isAdmin,
    refetchInterval: 15000,
  });

  const markRead = useMutation({
    mutationFn: (id) => api.entities.Notification.update(id, { read: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['all-notifications'] }),
  });

  const markAllClientRead = useMutation({
    mutationFn: async (clientId) => {
      const unread = allNotifications.filter(n => n.user_id === clientId && !n.read);
      await Promise.all(unread.map(n => api.entities.Notification.update(n.id, { read: true })));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['all-notifications'] }),
  });

  // Group notifications by client
  const clientsWithNotifs = clients
    .map(client => {
      const notifs = allNotifications.filter(n => n.user_id === client.id);
      const unread = notifs.filter(n => !n.read);
      return { client, notifs, unreadCount: unread.length };
    })
    .filter(item => item.notifs.length > 0)
    .sort((a, b) => b.unreadCount - a.unreadCount);

  const totalUnread = allNotifications.filter(n => !n.read).length;

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications Center</h1>
          <p className="text-muted-foreground mt-1">
            {totalUnread > 0 ? `${totalUnread} unread across all clients` : 'All clients caught up'}
          </p>
        </div>
        {totalUnread > 0 && (
          <Badge className="bg-destructive text-destructive-foreground text-sm px-3 py-1">{totalUnread} unread</Badge>
        )}
      </div>

      {clientsWithNotifs.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <Bell className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No notifications yet</p>
          <p className="text-sm">Client activity will appear here</p>
        </div>
      )}

      <div className="space-y-6">
        {clientsWithNotifs.map(({ client, notifs, unreadCount }) => (
          <Card key={client.id} className={`border-0 shadow-sm ${unreadCount > 0 ? 'ring-2 ring-primary/20' : ''}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {client.full_name || client.email}
                      {unreadCount > 0 && (
                        <Badge className="bg-destructive text-destructive-foreground text-xs px-2 py-0">{unreadCount} new</Badge>
                      )}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{client.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => markAllClientRead.mutate(client.id)}>
                      <CheckCheck className="w-4 h-4 mr-1" />Clear
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => navigate(`/clients/${client.id}`)}>
                    <ExternalLink className="w-4 h-4 mr-1" />View Profile
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {notifs.slice(0, 5).map(notif => {
                const Icon = notifIcons[notif.type] || Info;
                const colorClass = notifColors[notif.type] || notifColors.general;
                return (
                  <div
                    key={notif.id}
                    className={`flex items-start gap-3 p-3 rounded-lg transition-all ${
                      !notif.read ? 'bg-primary/5 border border-primary/10' : 'bg-muted/40 opacity-70'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-sm">{notif.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                        </div>
                        {!notif.read && (
                          <button
                            onClick={() => markRead.mutate(notif.id)}
                            className="flex-shrink-0 w-2 h-2 rounded-full bg-primary mt-1.5 hover:bg-primary/60 transition-colors"
                            title="Mark as read"
                          />
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {formatDateTime(notif.created_date)}
                      </p>
                    </div>
                  </div>
                );
              })}
              {notifs.length > 5 && (
                <p className="text-xs text-muted-foreground text-center pt-1">
                  +{notifs.length - 5} more â€” <button className="underline" onClick={() => navigate(`/clients/${client.id}?tab=notifications`)}>view all</button>
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
