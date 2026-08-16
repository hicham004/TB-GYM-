import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Library, Trash2, Flame } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

export default function DietPlans() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', meals: [] });
  const [selectedMealId, setSelectedMealId] = useState('');
  const [timeLabel, setTimeLabel] = useState('');

  const { data: dietPlans = [] } = useQuery({
    queryKey: ['diet-plans'],
    queryFn: () => api.entities.DietPlan.list('-created_date'),
  });

  const { data: meals = [] } = useQuery({
    queryKey: ['meals'],
    queryFn: () => api.entities.Meal.list(),
  });

  const createPlan = useMutation({
    mutationFn: (data) => {
      const totalCals = data.meals.reduce((s, m) => s + (m.calories || 0), 0);
      const totalP = data.meals.reduce((s, m) => s + (m.protein || 0), 0);
      const totalC = data.meals.reduce((s, m) => s + (m.carbs || 0), 0);
      const totalF = data.meals.reduce((s, m) => s + (m.fats || 0), 0);
      return api.entities.DietPlan.create({
        ...data,
        total_daily_calories: totalCals,
        total_daily_protein: totalP,
        total_daily_carbs: totalC,
        total_daily_fats: totalF,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diet-plans'] });
      setShowCreate(false);
      setForm({ name: '', meals: [] });
      toast.success('Diet plan created');
    },
  });

  const deletePlan = useMutation({
    mutationFn: (id) => api.entities.DietPlan.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diet-plans'] });
      toast.success('Diet plan deleted');
    },
  });

  const addMealToPlan = () => {
    const meal = meals.find(m => m.id === selectedMealId);
    if (!meal) return;
    setForm(p => ({
      ...p,
      meals: [...p.meals, {
        meal_id: meal.id,
        meal_name: meal.name,
        time_label: timeLabel || `Meal ${p.meals.length + 1}`,
        calories: meal.calories || 0,
        protein: meal.protein || 0,
        carbs: meal.carbs || 0,
        fats: meal.fats || 0,
      }],
    }));
    setSelectedMealId('');
    setTimeLabel('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Diet Plans</h1>
          <p className="text-muted-foreground mt-1">{dietPlans.length} plans</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />New Diet Plan</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Diet Plan</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Plan Name</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Cutting Plan" /></div>

              <div className="border rounded-lg p-3 space-y-3">
                <Label>Add Meals</Label>
                <div className="flex gap-2">
                  <Select value={selectedMealId} onValueChange={setSelectedMealId}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select meal" /></SelectTrigger>
                    <SelectContent>{meals.map(m => <SelectItem key={m.id} value={m.id}>{m.name} ({m.calories} cal)</SelectItem>)}</SelectContent>
                  </Select>
                  <Input placeholder="Label" value={timeLabel} onChange={e => setTimeLabel(e.target.value)} className="w-28" />
                  <Button variant="outline" size="icon" onClick={addMealToPlan}><Plus className="w-4 h-4" /></Button>
                </div>
                {form.meals.map((m, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium">{m.time_label}: {m.meal_name}</p>
                      <p className="text-xs text-muted-foreground">{m.calories} cal Â· P:{m.protein}g C:{m.carbs}g F:{m.fats}g</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setForm(p => ({ ...p, meals: p.meals.filter((_, idx) => idx !== i) }))}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>

              <Button onClick={() => createPlan.mutate(form)} disabled={!form.name || form.meals.length === 0} className="w-full">Create Plan</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {dietPlans.map(plan => (
          <Card key={plan.id} className="border-0 shadow-sm hover:shadow-lg transition-all group">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-chart-3/10 flex items-center justify-center">
                    <Library className="w-5 h-5 text-chart-3" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{plan.name}</h3>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Flame className="w-3 h-3 text-destructive" />
                      <span className="text-xs text-muted-foreground">{plan.total_daily_calories || 0} cal/day</span>
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 text-destructive" onClick={() => deletePlan.mutate(plan.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex gap-2 mt-3 flex-wrap">
                <Badge variant="secondary" className="text-xs">P: {plan.total_daily_protein || 0}g</Badge>
                <Badge variant="secondary" className="text-xs">C: {plan.total_daily_carbs || 0}g</Badge>
                <Badge variant="secondary" className="text-xs">F: {plan.total_daily_fats || 0}g</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{plan.meals?.length || 0} meals/day</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {dietPlans.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <Library className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No diet plans yet</p>
        </div>
      )}
    </div>
  );
}
