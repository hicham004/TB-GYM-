import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, CreditCard, Clock } from 'lucide-react';
import { differenceInDays } from 'date-fns';
import { formatDate } from '@/lib/dateUtils';

function InfoRow({ icon: Icon, label, value, color }) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <p className="font-medium text-sm">{label}</p>
      </div>
      <p className="font-semibold text-sm">{value}</p>
    </div>
  );
}

export default function CalendarPage() {
  const { user, isAdmin } = useCurrentUser();

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-calendar'],
    queryFn: () => api.entities.User.filter({ role: 'client' }),
    enabled: isAdmin,
  });

  if (isAdmin) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Calendar Overview</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map(client => {
            const daysLeft = client.program_end_date
              ? differenceInDays(new Date(client.program_end_date), new Date())
              : null;
            return (
              <Card key={client.id} className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                      {(client.full_name || 'C')[0].toUpperCase()}
                    </div>
                    {client.full_name || client.email}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Start</span>
                    <span>{client.program_start_date ? formatDate(client.program_start_date) : 'Not set'}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">End</span>
                    <span>{client.program_end_date ? formatDate(client.program_end_date) : 'Not set'}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Days Left</span>
                    <Badge variant={daysLeft && daysLeft < 7 ? 'destructive' : 'secondary'}>
                      {daysLeft !== null ? `${daysLeft} days` : 'N/A'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Payment</span>
                    <Badge variant={client.payment_status === 'paid' ? 'default' : 'destructive'} className={client.payment_status === 'paid' ? 'bg-chart-3 text-white' : ''}>
                      {client.payment_status || 'not paid'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {clients.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            <Calendar className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>No clients yet</p>
          </div>
        )}
      </div>
    );
  }

  // Client view
  const daysLeft = user?.program_end_date
    ? differenceInDays(new Date(user.program_end_date), new Date())
    : null;

  const totalDays = user?.program_start_date && user?.program_end_date
    ? differenceInDays(new Date(user.program_end_date), new Date(user.program_start_date))
    : null;

  const daysPassed = user?.program_start_date
    ? differenceInDays(new Date(), new Date(user.program_start_date))
    : null;

  const progress = totalDays && daysPassed ? Math.min(100, Math.max(0, (daysPassed / totalDays) * 100)) : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">My Calendar</h1>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-6">
          {/* Progress bar */}
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Program Progress</span>
              <span className="font-medium">{Math.round(progress)}%</span>
            </div>
            <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="space-y-3">
            <InfoRow icon={Calendar} label="Start Date" value={user?.program_start_date ? formatDate(user.program_start_date) : 'Not set'} color="bg-primary" />
            <InfoRow icon={Calendar} label="End Date" value={user?.program_end_date ? formatDate(user.program_end_date) : 'Not set'} color="bg-chart-2" />
            <InfoRow icon={Clock} label="Days Remaining" value={daysLeft !== null ? `${daysLeft} days` : 'N/A'} color="bg-chart-4" />
            <InfoRow icon={CreditCard} label="Payment Status" value={user?.payment_status || 'Not paid'} color={user?.payment_status === 'paid' ? 'bg-chart-3' : 'bg-destructive'} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
