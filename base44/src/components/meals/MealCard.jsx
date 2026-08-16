import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Flame, Beef, Wheat, Droplets, Clock, Users, Pencil, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

const CATEGORY_COLORS = {
  Breakfast: 'bg-amber-100 text-amber-800',
  Lunch: 'bg-green-100 text-green-800',
  Dinner: 'bg-blue-100 text-blue-800',
  Snack: 'bg-purple-100 text-purple-800',
  'Pre-Workout': 'bg-orange-100 text-orange-800',
  'Post-Workout': 'bg-red-100 text-red-800',
  Bulking: 'bg-yellow-100 text-yellow-800',
  Cutting: 'bg-cyan-100 text-cyan-800',
  'High Protein': 'bg-rose-100 text-rose-800',
  'Low Carb': 'bg-teal-100 text-teal-800',
  Vegan: 'bg-lime-100 text-lime-800',
  Vegetarian: 'bg-emerald-100 text-emerald-800',
};

export default function MealCard({ meal, isAdmin, onEdit, onDelete }) {
  const [showDetail, setShowDetail] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const totalTime = (meal.prep_time_minutes || 0) + (meal.cook_time_minutes || 0);
  const categoryColor = CATEGORY_COLORS[meal.category] || 'bg-gray-100 text-gray-700';

  const getWeight = (ing) => {
    const mode = meal.weight_mode || 'raw';
    if (mode === 'both') {
      const parts = [];
      if (ing.quantity_raw) parts.push(`Raw: ${ing.quantity_raw}`);
      if (ing.quantity_cooked) parts.push(`Cooked: ${ing.quantity_cooked}`);
      return parts.join(' / ') || ing.quantity || '';
    }
    if (mode === 'cooked') return ing.quantity_cooked || ing.quantity_raw || ing.quantity || '';
    return ing.quantity_raw || ing.quantity || '';
  };

  return (
    <>
      <Card className="border-0 shadow-sm hover:shadow-lg transition-all group cursor-pointer overflow-hidden" onClick={() => setShowDetail(true)}>
        {meal.image_url && (
          <div className="h-36 overflow-hidden">
            <img src={meal.image_url} alt={meal.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          </div>
        )}
        <CardContent className={`p-4 ${!meal.image_url ? 'pt-4' : ''}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold truncate">{meal.name}</h3>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                {meal.category && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColor}`}>{meal.category}</span>}
                {totalTime > 0 && (
                  <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                    <Clock className="w-3 h-3" />{totalTime}m
                  </span>
                )}
                {meal.servings && meal.servings > 1 && (
                  <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                    <Users className="w-3 h-3" />{meal.servings} srv
                  </span>
                )}
              </div>
            </div>
            {isAdmin && (
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(meal)}><Pencil className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(meal.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-4 gap-1 mt-3">
            <div className="text-center bg-orange-50 dark:bg-orange-900/20 rounded-lg p-1.5">
              <Flame className="w-3 h-3 text-orange-500 mx-auto" />
              <p className="text-xs font-bold text-orange-600">{meal.calories || 0}</p>
              <p className="text-[10px] text-muted-foreground">kcal</p>
            </div>
            <div className="text-center bg-red-50 dark:bg-red-900/20 rounded-lg p-1.5">
              <Beef className="w-3 h-3 text-red-500 mx-auto" />
              <p className="text-xs font-bold text-red-600">{meal.protein || 0}g</p>
              <p className="text-[10px] text-muted-foreground">protein</p>
            </div>
            <div className="text-center bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-1.5">
              <Wheat className="w-3 h-3 text-yellow-600 mx-auto" />
              <p className="text-xs font-bold text-yellow-700">{meal.carbs || 0}g</p>
              <p className="text-[10px] text-muted-foreground">carbs</p>
            </div>
            <div className="text-center bg-blue-50 dark:bg-blue-900/20 rounded-lg p-1.5">
              <Droplets className="w-3 h-3 text-blue-500 mx-auto" />
              <p className="text-xs font-bold text-blue-600">{meal.fats || 0}g</p>
              <p className="text-[10px] text-muted-foreground">fats</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {meal.name}
              {meal.category && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColor}`}>{meal.category}</span>}
            </DialogTitle>
          </DialogHeader>

          {meal.image_url && <img src={meal.image_url} alt={meal.name} className="w-full h-48 object-cover rounded-xl" />}

          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            {meal.prep_time_minutes > 0 && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Prep: {meal.prep_time_minutes}min</span>}
            {meal.cook_time_minutes > 0 && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Cook: {meal.cook_time_minutes}min</span>}
            {meal.servings && <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{meal.servings} serving{meal.servings > 1 ? 's' : ''}</span>}
          </div>

          {/* Macros */}
          <div className="grid grid-cols-3 gap-2">
            {[['Calories','kcal',meal.calories,'bg-orange-50 dark:bg-orange-900/20','text-orange-600'],
              ['Protein','g',meal.protein,'bg-red-50 dark:bg-red-900/20','text-red-600'],
              ['Carbs','g',meal.carbs,'bg-yellow-50 dark:bg-yellow-900/20','text-yellow-700'],
              ['Fats','g',meal.fats,'bg-blue-50 dark:bg-blue-900/20','text-blue-600'],
              meal.fiber ? ['Fiber','g',meal.fiber,'bg-green-50 dark:bg-green-900/20','text-green-600'] : null,
              meal.sodium ? ['Sodium','mg',meal.sodium,'bg-purple-50 dark:bg-purple-900/20','text-purple-600'] : null,
            ].filter(Boolean).map(([label,unit,val,bg,color]) => (
              <div key={label} className={`${bg} rounded-xl p-3 text-center`}>
                <p className={`text-xl font-bold ${color}`}>{val || 0}</p>
                <p className="text-xs text-muted-foreground">{label} ({unit})</p>
              </div>
            ))}
          </div>

          {/* Ingredients */}
          {meal.ingredients?.length > 0 && (
            <div>
              <button className="flex items-center gap-2 font-semibold text-sm w-full" onClick={() => setExpanded(p => !p)}>
                Ingredients ({meal.ingredients.length}) {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {expanded && (
                <div className="mt-2 space-y-1">
                  {meal.ingredients.map((ing, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                      <span className="font-medium">{ing.name}</span>
                      <span className="text-muted-foreground text-xs">{getWeight(ing)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Instructions */}
          {meal.preparation_steps && (
            <div>
              <p className="font-semibold text-sm mb-2">Instructions</p>
              <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">{meal.preparation_steps}</pre>
            </div>
          )}

          {meal.cooking_tips && (
            <div className="bg-muted/40 rounded-xl p-3">
              <p className="font-semibold text-sm mb-1">Tips</p>
              <p className="text-sm text-muted-foreground">{meal.cooking_tips}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
