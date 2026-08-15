import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Dumbbell, UtensilsCrossed, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/dateUtils';

function StatCard({ title, value, icon: Icon, color, link }) {
  const content = (
    <Card className="hover:shadow-lg transition-all duration-300 group cursor-pointer border-0 shadow-sm">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground font-medium">{title}</p>
            <p className="text-3xl font-bold mt-1 tracking-tight">{value}</p>
          </div>
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${color} group-hover:scale-110 transition-transform`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  return link ? <Link to={link}>{content}</Link> : content;
}

export default function AdminDashboard() {
  const { data: allUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.entities.User.list(),
  });
  const clients = allUsers.filter(u => u.role !== 'admin' && !u.is_deleted);

  const { data: programs = [] } = useQuery({
    queryKey: ['programs'],
    queryFn: () => api.entities.TrainingProgram.list(),
  });

  const { data: meals = [] } = useQuery({
    queryKey: ['meals'],
    queryFn: () => api.entities.Meal.list(),
  });

  const overdueClients = clients.filter(c => c.payment_status === 'overdue');
  const unpaidClients = clients.filter(c => c.payment_status === 'not_paid');
  const activeClients = clients.filter(c => !c.is_blocked);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome back, Coach</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Clients" value={clients.length} icon={Users} color="bg-primary" link="/clients" />
        <StatCard title="Active Programs" value={programs.length} icon={Dumbbell} color="bg-chart-3" link="/programs" />
        <StatCard title="Meal Library" value={meals.length} icon={UtensilsCrossed} color="bg-chart-4" link="/meals" />
        <StatCard title="Payment Issues" value={overdueClients.length + unpaidClients.length} icon={AlertTriangle} color="bg-destructive" link="/clients" />
      </div>

      {/* Recent Clients */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="w-5 h-5 text-primary" />
              Recent Clients
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {clients.slice(0, 5).map(client => (
                <Link key={client.id} to={`/clients/${client.id}`} className="flex items-center justify-between p-3 rounded-xl hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-sm font-semibold text-primary">
                        {(client.full_name || 'C')[0].toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-sm">{client.full_name || client.email}</p>
                      <p className="text-xs text-muted-foreground">{client.email}</p>
                    </div>
                  </div>
                  <Badge variant={client.payment_status === 'paid' ? 'default' : 'destructive'} className="text-xs">
                    {client.payment_status || 'not_paid'}
                  </Badge>
                </Link>
              ))}
              {clients.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-8">No clients yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Payment Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[...overdueClients, ...unpaidClients].slice(0, 5).map(client => (
                <Link key={client.id} to={`/clients/${client.id}`} className="flex items-center justify-between p-3 rounded-xl hover:bg-muted transition-colors">
                  <div>
                    <p className="font-medium text-sm">{client.full_name || client.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Due: {client.payment_due_date ? formatDate(client.payment_due_date) : 'Not set'}
                    </p>
                  </div>
                  <Badge variant="destructive" className="text-xs">
                    {client.payment_status === 'overdue' ? 'Overdue' : 'Not Paid'}
                  </Badge>
                </Link>
              ))}
              {overdueClients.length + unpaidClients.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-8">All payments up to date</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
