import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { UtensilsCrossed, Check, Flame } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const STATUS_OPTIONS = [
  { value: 'ate_it', label: 'Ate it', color: 'bg-chart-3 text-white' },
  { value: 'ate_half', label: 'Ate half', color: 'bg-chart-4 text-white' },
  { value: 'replaced_it', label: 'Replaced', color: 'bg-primary text-primary-foreground' },
  { value: 'ate_something_else', label: 'Something else', color: 'bg-destructive text-destructive-foreground' },
];

export default function MyDiet() {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(today);

  const { data: dietPlans = [] } = useQuery({
    queryKey: ['my-diet', user?.assigned_diet_plan_id],
    queryFn: () => api.entities.DietPlan.filter({ id: user.assigned_diet_plan_id }),
    enabled: !!user?.assigned_diet_plan_id,
  });
  const plan = dietPlans[0];

  const { data: dayLogs = [] } = useQuery({
    queryKey: ['diet-day-log', user?.id, selectedDate],
    queryFn: () => api.entities.DietDayLog.filter({ client_id: user.id, date: selectedDate }),
    enabled: !!user?.id,
  });
  const dayLog = dayLogs[0];

  const saveDayLog = useMutation({
    mutationFn: async (mealLogs) => {
      if (dayLog) {
        return api.entities.DietDayLog.update(dayLog.id, { meal_logs: mealLogs });
      }
      return api.entities.DietDayLog.create({
        client_id: user.id,
        diet_plan_id: user.assigned_diet_plan_id,
        date: selectedDate,
        meal_logs: mealLogs,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diet-day-log'] });
      toast.success('Diet log saved');
    },
  });

  const [mealStatuses, setMealStatuses] = useState({});
  const [mealNotes, setMealNotes] = useState({});

  React.useEffect(() => {
    if (dayLog?.meal_logs) {
      const statuses = {};
      const notes = {};
      dayLog.meal_logs.forEach(ml => {
        statuses[ml.meal_name] = ml.status;
        notes[ml.meal_name] = ml.note || '';
      });
      setMealStatuses(statuses);
      setMealNotes(notes);
    } else {
      setMealStatuses({});
      setMealNotes({});
    }
  }, [dayLog]);

  const handleSave = () => {
    const logs = (plan?.meals || []).map(m => ({
      meal_name: m.meal_name,
      status: mealStatuses[m.meal_name] || 'skipped',
      note: mealNotes[m.meal_name] || '',
    }));
    saveDayLog.mutate(logs);
  };

  if (!user?.assigned_diet_plan_id) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <UtensilsCrossed className="w-16 h-16 mx-auto mb-4 opacity-20" />
        <h2 className="text-xl font-semibold mb-2">No Diet Plan Assigned</h2>
        <p className="text-sm">Your coach hasn't assigned a diet plan yet.</p>
      </div>
    );
  }

  if (!plan) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{plan.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <div className="flex items-center gap-1"><Flame className="w-4 h-4 text-destructive" /><span className="text-sm text-muted-foreground">{plan.total_daily_calories} cal</span></div>
            <Badge variant="secondary" className="text-xs">P: {plan.total_daily_protein}g</Badge>
            <Badge variant="secondary" className="text-xs">C: {plan.total_daily_carbs}g</Badge>
            <Badge variant="secondary" className="text-xs">F: {plan.total_daily_fats}g</Badge>
          </div>
        </div>
        <Input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="w-auto" />
      </div>

      <div className="space-y-4">
        {plan.meals?.map((meal, idx) => (
          <Card key={idx} className="border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-primary font-medium uppercase tracking-wider">{meal.time_label}</p>
                  <h3 className="font-semibold text-lg">{meal.meal_name}</h3>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{meal.calories} cal</p>
                  <p className="text-xs text-muted-foreground">P:{meal.protein}g C:{meal.carbs}g F:{meal.fats}g</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mb-3">
                {STATUS_OPTIONS.map(opt => (
                  <Button
                    key={opt.value}
                    size="sm"
                    variant={mealStatuses[meal.meal_name] === opt.value ? 'default' : 'outline'}
                    className={mealStatuses[meal.meal_name] === opt.value ? opt.color : ''}
                    onClick={() => setMealStatuses(p => ({ ...p, [meal.meal_name]: opt.value }))}
                  >
                    {mealStatuses[meal.meal_name] === opt.value && <Check className="w-3 h-3 mr-1" />}
                    {opt.label}
                  </Button>
                ))}
              </div>

              <Input
                placeholder="Add a note..."
                value={mealNotes[meal.meal_name] || ''}
                onChange={e => setMealNotes(p => ({ ...p, [meal.meal_name]: e.target.value }))}
                className="text-sm"
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <Button onClick={handleSave} className="w-full sm:w-auto">
        <Check className="w-4 h-4 mr-2" />Save Today's Log
      </Button>
    </div>
  );
}
