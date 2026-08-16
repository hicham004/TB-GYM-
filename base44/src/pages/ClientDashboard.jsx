import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Card, CardContent } from '@/components/ui/card';
import { Dumbbell, UtensilsCrossed, LineChart, Calendar, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { differenceInDays } from 'date-fns';

export default function ClientDashboard() {
  const { user } = useCurrentUser();

  const { data: weightLogs = [] } = useQuery({
    queryKey: ['weight-logs', user?.id],
    queryFn: () => api.entities.WeightLog.filter({ client_id: user?.id }, '-date', 5),
    enabled: !!user?.id,
  });

  const { data: program } = useQuery({
    queryKey: ['my-program', user?.assigned_program_id],
    queryFn: async () => {
      const programs = await api.entities.TrainingProgram.filter({ id: user.assigned_program_id });
      return programs[0] || null;
    },
    enabled: !!user?.assigned_program_id,
  });

  const daysLeft = user?.program_end_date
    ? differenceInDays(new Date(user.program_end_date), new Date())
    : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Hey, {user?.full_name?.split(' ')[0] || 'there'} ðŸ’ª
        </h1>
        <p className="text-muted-foreground mt-1">Let's crush today's workout</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Dumbbell className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Program</p>
                <p className="font-semibold text-sm">{program?.name || 'None'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-chart-3/10 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-chart-3" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Days Left</p>
                <p className="font-semibold text-sm">{daysLeft !== null ? `${daysLeft} days` : 'N/A'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-chart-4/10 flex items-center justify-center">
                <LineChart className="w-5 h-5 text-chart-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Current Weight</p>
                <p className="font-semibold text-sm">
                  {user?.weight_kg ? `${user.weight_kg} kg` : user?.starting_weight_kg ? `${user.starting_weight_kg} kg` : 'Not logged'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-chart-5/10 flex items-center justify-center">
                <UtensilsCrossed className="w-5 h-5 text-chart-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Payment</p>
                <p className="font-semibold text-sm capitalize">{user?.payment_status || 'not paid'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/my-program">
          <Card className="border-0 shadow-sm hover:shadow-lg transition-all group cursor-pointer h-full">
            <CardContent className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center">
                  <Dumbbell className="w-6 h-6 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-semibold">Today's Workout</p>
                  <p className="text-sm text-muted-foreground">View your training</p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
            </CardContent>
          </Card>
        </Link>

        <Link to="/my-diet">
          <Card className="border-0 shadow-sm hover:shadow-lg transition-all group cursor-pointer h-full">
            <CardContent className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-chart-3 flex items-center justify-center">
                  <UtensilsCrossed className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-semibold">My Diet Plan</p>
                  <p className="text-sm text-muted-foreground">Track your meals</p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
            </CardContent>
          </Card>
        </Link>

        <Link to="/progress">
          <Card className="border-0 shadow-sm hover:shadow-lg transition-all group cursor-pointer h-full">
            <CardContent className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-chart-4 flex items-center justify-center">
                  <LineChart className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-semibold">Track Progress</p>
                  <p className="text-sm text-muted-foreground">Log weight & view graphs</p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
