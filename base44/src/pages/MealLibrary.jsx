import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Plus, Search, UtensilsCrossed, Sparkles, SlidersHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';
import MealCard from '@/components/meals/MealCard';
import MealImportDialog from '@/components/meals/MealImportDialog';
import MealEditDialog from '@/components/meals/MealEditDialog';
import { useCurrentUser } from '@/lib/useCurrentUser';

const CATEGORIES = ['All','Breakfast','Lunch','Dinner','Snack','Pre-Workout','Post-Workout','Bulking','Cutting','High Protein','Low Carb','Vegan','Vegetarian'];

export default function MealLibrary() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const isAdmin = user?.role === 'admin';

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [showImport, setShowImport] = useState(false);
  const [editingMeal, setEditingMeal] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [calRange, setCalRange] = useState([0, 2000]);
  const [proteinMin, setProteinMin] = useState(0);
  const [maxTimeMin, setMaxTimeMin] = useState(0);

  const { data: meals = [] } = useQuery({
    queryKey: ['meals'],
    queryFn: () => api.entities.Meal.list('-created_date', 200),
  });

  const createMeal = useMutation({
    mutationFn: (data) => api.entities.Meal.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meals'] }),
  });

  const updateMeal = useMutation({
    mutationFn: ({ id, data }) => api.entities.Meal.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meals'] }),
  });

  const deleteMeal = useMutation({
    mutationFn: (id) => api.entities.Meal.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['meals'] }); toast.success('Meal deleted'); },
  });

  // Called when AI import returns data â€” opens the edit dialog pre-filled
  const handleImported = (mealData) => {
    setEditingMeal({ ...mealData, _isNew: true });
  };

  const handleSaveMeal = async (mealData) => {
    const { _isNew, id, created_date, updated_date, created_by_id, ...cleanData } = mealData;
    if (_isNew || !id) {
      await createMeal.mutateAsync(cleanData);
      toast.success('Meal saved to library!');
    } else {
      await updateMeal.mutateAsync({ id, data: cleanData });
      toast.success('Meal updated!');
    }
    setEditingMeal(null);
  };

  const handleOpenCreate = () => {
    setEditingMeal({
      _isNew: true,
      name: '',
      category: 'Lunch',
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
      fiber: 0,
      servings: 1,
      weight_mode: 'raw',
      ingredients: [],
      preparation_steps: '',
      cooking_tips: '',
    });
  };

  const filtered = useMemo(() => {
    return meals.filter(m => {
      if (search && !m.name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (categoryFilter !== 'All' && m.category !== categoryFilter) return false;
      if (m.calories < calRange[0] || m.calories > calRange[1]) return false;
      if (proteinMin > 0 && (m.protein || 0) < proteinMin) return false;
      if (maxTimeMin > 0) {
        const total = (m.prep_time_minutes || 0) + (m.cook_time_minutes || 0);
        if (total > maxTimeMin) return false;
      }
      return true;
    });
  }, [meals, search, categoryFilter, calRange, proteinMin, maxTimeMin]);

  const hasActiveFilters = categoryFilter !== 'All' || calRange[0] > 0 || calRange[1] < 2000 || proteinMin > 0 || maxTimeMin > 0;

  const categoryCounts = useMemo(() => {
    const counts = {};
    meals.forEach(m => { counts[m.category || 'Uncategorized'] = (counts[m.category || 'Uncategorized'] || 0) + 1; });
    return counts;
  }, [meals]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Meal Library</h1>
          <p className="text-muted-foreground mt-1">{meals.length} meals saved</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleOpenCreate}><Plus className="w-4 h-4 mr-2" />Manual</Button>
            <Button onClick={() => setShowImport(true)} className="gap-2">
              <Sparkles className="w-4 h-4" />AI Import
            </Button>
          </div>
        )}
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map(cat => {
          const count = cat === 'All' ? meals.length : (categoryCounts[cat] || 0);
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                categoryFilter === cat
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground'
              }`}
            >
              {cat} {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Search + filter bar */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search meals..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button variant="outline" size="icon" onClick={() => setShowFilters(p => !p)} className={hasActiveFilters ? 'border-primary text-primary' : ''}>
          <SlidersHorizontal className="w-4 h-4" />
        </Button>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setCalRange([0,2000]); setProteinMin(0); setMaxTimeMin(0); setCategoryFilter('All'); }}>
            <X className="w-3.5 h-3.5 mr-1" />Clear
          </Button>
        )}
      </div>

      {/* Advanced filters panel */}
      {showFilters && (
        <div className="border rounded-xl p-4 bg-card space-y-4">
          <p className="text-sm font-semibold">Advanced Filters</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">Calories: {calRange[0]} â€“ {calRange[1]} kcal</Label>
              <div className="mt-2 px-1">
                <Slider value={calRange} onValueChange={setCalRange} min={0} max={2000} step={50} className="w-full" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Min Protein (g)</Label>
              <Input type="number" className="mt-1 h-8" value={proteinMin || ''} placeholder="e.g. 30" onChange={e => setProteinMin(Number(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">Max Total Time (min, 0 = any)</Label>
              <Input type="number" className="mt-1 h-8" value={maxTimeMin || ''} placeholder="e.g. 30" onChange={e => setMaxTimeMin(Number(e.target.value) || 0)} />
            </div>
          </div>
        </div>
      )}

      {/* Meal grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(meal => (
            <MealCard
              key={meal.id}
              meal={meal}
              isAdmin={isAdmin}
              onEdit={setEditingMeal}
              onDelete={(id) => deleteMeal.mutate(id)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 text-muted-foreground">
          <UtensilsCrossed className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">{meals.length === 0 ? 'No meals yet' : 'No meals match your filters'}</p>
          {isAdmin && meals.length === 0 && (
            <Button className="mt-4 gap-2" onClick={() => setShowImport(true)}>
              <Sparkles className="w-4 h-4" />Import your first meal with AI
            </Button>
          )}
        </div>
      )}

      {/* Dialogs */}
      <MealImportDialog open={showImport} onOpenChange={setShowImport} onImported={handleImported} />
      <MealEditDialog
        open={!!editingMeal}
        onOpenChange={v => { if (!v) setEditingMeal(null); }}
        meal={editingMeal}
        onSave={handleSaveMeal}
      />
    </div>
  );
}
