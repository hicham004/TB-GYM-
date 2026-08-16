import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Plus, TrendingDown, TrendingUp, Scale, User, Bell, CheckCheck, AlertTriangle, CreditCard, Calendar, Info, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { differenceInYears, subDays } from 'date-fns';
import { formatDate, formatDateTime, todayISO } from '@/lib/dateUtils';
import ChatSection from '@/components/chat/ChatSection';
import BodyWeightTracking from '@/components/clients/BodyWeightTracking';

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

export default function Progress() {
  const { user, refreshUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const [weight, setWeight] = useState('');
  const [note, setNote] = useState('');

  // Weight logs
  const { data: weightLogs = [] } = useQuery({
    queryKey: ['weight-logs', user?.id],
    queryFn: () => api.entities.WeightLog.filter({ client_id: user?.id }, 'date'),
    enabled: !!user?.id,
  });

  // Notifications for client
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: () => api.entities.Notification.filter({ user_id: user?.id }, '-created_date'),
    enabled: !!user?.id,
  });

  // Program cycles for timeline
  const { data: programCycles = [] } = useQuery({
    queryKey: ['program-cycles', user?.id],
    queryFn: () => api.entities.ProgramCycle.filter({ client_id: user?.id }, '-start_date'),
    enabled: !!user?.id,
  });

  // Auto-update current weight:
  // - If no logs: use starting_weight_kg as current weight (if not already set)
  // - If logs exist: use 7-day average
  useEffect(() => {
    if (!user?.id) return;

    if (weightLogs.length === 0) {
      // Set current weight = starting weight if current weight not yet set
      if (!user.weight_kg && user.starting_weight_kg) {
        api.entities.User.update(user.id, { weight_kg: user.starting_weight_kg }).then(() => refreshUser());
      }
      return;
    }

    const sevenDaysAgo = subDays(new Date(), 7);
    const recentLogs = weightLogs.filter(log => log.date && new Date(log.date) >= sevenDaysAgo);
    const logsToUse = recentLogs.length > 0 ? recentLogs : weightLogs;
    const avg = logsToUse.reduce((sum, l) => sum + l.weight_kg, 0) / logsToUse.length;
    const avgRounded = Math.round(avg * 10) / 10;
    if (Math.abs(avgRounded - (user.weight_kg || 0)) >= 0.1) {
      api.entities.User.update(user.id, { weight_kg: avgRounded }).then(() => refreshUser());
    }
  }, [weightLogs.length, user?.id, user?.starting_weight_kg]);

  const addLog = useMutation({
    mutationFn: (data) => api.entities.WeightLog.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weight-logs'] });
      setWeight('');
      setNote('');
      toast.success('Weight logged');
    },
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

  const handleLog = () => {
    if (!weight) return;
    addLog.mutate({
      client_id: user.id,
      date: todayISO(),
      weight_kg: Number(weight),
      note,
    });
  };

  const chartData = weightLogs.map(log => ({
    date: log.date ? formatDate(log.date) : '',
    weight: log.weight_kg,
  }));

  const latest = weightLogs[weightLogs.length - 1]?.weight_kg;
  const previous = weightLogs[weightLogs.length - 2]?.weight_kg;
  const diff = latest && previous ? (latest - previous).toFixed(1) : null;
  const unreadCount = notifications.filter(n => !n.read).length;

  const age = user?.date_of_birth ? differenceInYears(new Date(), new Date(user.date_of_birth)) : null;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">My Profile & Progress</h1>

      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="profile" className="flex items-center gap-2">
            <User className="w-4 h-4" />My Profile
          </TabsTrigger>
          <TabsTrigger value="progress" className="flex items-center gap-2">
            <Scale className="w-4 h-4" />Body Weight
          </TabsTrigger>
          <TabsTrigger value="chat" className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4" />Chat with Coach
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Notifications
            {unreadCount > 0 && (
              <Badge className="bg-destructive text-destructive-foreground text-xs px-1.5 py-0 h-5 min-w-5">{unreadCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* â”€â”€ Profile Tab â”€â”€ */}
        <TabsContent value="profile" className="mt-4 space-y-4">
          <div className="rounded-xl bg-primary/5 border border-primary/10 px-4 py-3 text-sm text-primary flex items-center gap-2">
            <Info className="w-4 h-4 flex-shrink-0" />
            This information is managed by your coach. Contact them to make any changes.
          </div>

          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Personal Info</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Full Name</p>
                <p className="font-medium">{user?.full_name || 'â€”'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Email</p>
                <p className="font-medium">{user?.email || 'â€”'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Phone</p>
                <p className="font-medium">{user?.phone || 'â€”'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Age</p>
                <p className="font-medium">{age !== null ? `${age} years old` : 'â€”'}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Physical Stats</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">Height</p>
                <p className="font-semibold text-lg">{user?.height_cm ? `${user.height_cm} cm` : 'â€”'}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">Current Weight</p>
                <p className="font-semibold text-lg">{user?.weight_kg ? `${user.weight_kg} kg` : 'â€”'}</p>
                <p className="text-[10px] text-muted-foreground">7-day avg</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">Starting Weight</p>
                <p className="font-semibold text-lg">{user?.starting_weight_kg ? `${user.starting_weight_kg} kg` : 'â€”'}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 sm:col-span-3">
                <p className="text-xs text-muted-foreground mb-1">Goal</p>
                <p className="font-medium">{user?.goal || 'â€”'}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Health Notes</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground mb-2">Medical Conditions</p>
                <p className="text-sm">{user?.medical_conditions || 'None recorded'}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground mb-2">Allergies</p>
                <p className="text-sm">{user?.allergies || 'None recorded'}</p>
              </div>
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Program Timeline</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {user?.account_start_date && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="w-2 h-2 rounded-full bg-chart-3 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Account Started</p>
                    <p className="font-medium text-sm">{formatDate(user.account_start_date)}</p>
                  </div>
                </div>
              )}
              {/* Past cycles */}
              {[...programCycles].reverse().map(cycle => (
                <div key={cycle.id} className={`flex items-center gap-3 p-3 rounded-lg ${cycle.status === 'active' ? 'bg-primary/10 border border-primary/20' : 'bg-muted/50'}`}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cycle.status === 'active' ? 'bg-primary' : 'bg-muted-foreground'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{cycle.program_name}</p>
                      {cycle.status === 'active' && <Badge className="bg-primary/20 text-primary border-0 text-xs">Active</Badge>}
                      {cycle.status === 'completed' && <Badge variant="outline" className="text-xs">Completed</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(cycle.start_date)}
                      {cycle.end_date ? ` â†’ ${formatDate(cycle.end_date)}` : ''}
                      {cycle.duration_weeks ? ` Â· ${cycle.duration_weeks}w` : ''}
                    </p>
                  </div>
                </div>
              ))}
              {programCycles.length === 0 && !user?.account_start_date && (
                <p className="text-muted-foreground text-sm text-center py-4">No program history yet</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* â”€â”€ Weight Progress Tab â”€â”€ */}
        <TabsContent value="progress" className="mt-4">
          {user?.id && <BodyWeightTracking clientId={user.id} isAdmin={false} client={user} />}
        </TabsContent>
        {/* â”€â”€ LEGACY HIDDEN (kept for reference, replaced by BodyWeightTracking) â”€â”€ */}
        <TabsContent value="_progress_old" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Scale className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Current (7-day avg)</p>
                  <p className="text-2xl font-bold">{user?.weight_kg ? `${user.weight_kg} kg` : latest ? `${latest} kg` : 'N/A'}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${diff && Number(diff) < 0 ? 'bg-chart-3/10' : 'bg-chart-2/10'}`}>
                  {diff && Number(diff) < 0 ? <TrendingDown className="w-6 h-6 text-chart-3" /> : <TrendingUp className="w-6 h-6 text-chart-2" />}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last Change</p>
                  <p className="text-2xl font-bold">{diff ? `${Number(diff) > 0 ? '+' : ''}${diff} kg` : 'N/A'}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-chart-4/10 flex items-center justify-center">
                  <Scale className="w-6 h-6 text-chart-4" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Entries</p>
                  <p className="text-2xl font-bold">{weightLogs.length}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-lg">Log Weight</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <Label>Weight (kg)</Label>
                  <Input type="number" step={0.1} value={weight} onChange={e => setWeight(e.target.value)} placeholder="75.5" />
                </div>
                <div className="flex-1">
                  <Label>Note (optional)</Label>
                  <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Morning weight" />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleLog} disabled={!weight}><Plus className="w-4 h-4 mr-2" />Log</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {chartData.length > 1 && (
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-lg">Weight Trend</CardTitle></CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                      <Line type="monotone" dataKey="weight" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ fill: 'hsl(var(--primary))' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-lg">History</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[...weightLogs].reverse().map(log => (
                  <div key={log.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="font-medium text-sm">{log.weight_kg} kg</p>
                      {log.note && <p className="text-xs text-muted-foreground">{log.note}</p>}
                    </div>
                    <p className="text-xs text-muted-foreground">{formatDate(log.date)}</p>
                  </div>
                ))}
                {weightLogs.length === 0 && <p className="text-center text-muted-foreground text-sm py-8">No weight entries yet</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* â”€â”€ Chat Tab â”€â”€ */}
        <TabsContent value="chat" className="mt-4">
          {user?.id && <ChatSection clientId={user.id} isAdmin={false} />}
        </TabsContent>

        {/* â”€â”€ Notifications Tab â”€â”€ */}
        <TabsContent value="notifications" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{unreadCount} unread</p>
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()}>
                <CheckCheck className="w-4 h-4 mr-2" />Mark all read
              </Button>
            )}
          </div>
          <div className="space-y-3">
            {notifications.map(notif => {
              const Icon = notifIcons[notif.type] || Info;
              const colorClass = notifColors[notif.type] || notifColors.general;
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
                        {notif.created_date ? formatDateTime(notif.created_date) : ''}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {notifications.length === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <Bell className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">All caught up!</p>
                <p className="text-sm">No notifications yet</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
