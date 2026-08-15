import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const CATEGORIES = ['Breakfast','Lunch','Dinner','Snack','Pre-Workout','Post-Workout','Bulking','Cutting','High Protein','Low Carb','Vegan','Vegetarian','Custom'];

function recalcTotals(ingredients, servings = 1) {
  const totals = { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0 };
  ingredients.forEach(ing => {
    totals.calories += Number(ing.calories) || 0;
    totals.protein += Number(ing.protein) || 0;
    totals.carbs += Number(ing.carbs) || 0;
    totals.fats += Number(ing.fats) || 0;
    totals.fiber += Number(ing.fiber) || 0;
  });
  return {
    calories: Math.round(totals.calories),
    protein: Math.round(totals.protein * 10) / 10,
    carbs: Math.round(totals.carbs * 10) / 10,
    fats: Math.round(totals.fats * 10) / 10,
    fiber: Math.round(totals.fiber * 10) / 10,
  };
}

export default function MealEditDialog({ open, onOpenChange, meal, onSave }) {
  const [form, setForm] = useState(null);
  const [newIng, setNewIng] = useState({ name: '', quantity_raw: '', quantity_cooked: '', calories: '', protein: '', carbs: '', fats: '' });

  useEffect(() => {
    if (meal) setForm({ ...meal });
  }, [meal]);

  if (!form) return null;

  const setField = (key, val) => setForm(p => ({ ...p, [key]: val }));

  const handleServingsChange = (val) => {
    const newServings = Number(val) || 1;
    const oldServings = form.servings || 1;
    const ratio = newServings / oldServings;
    const scaledIngredients = (form.ingredients || []).map(ing => ({
      ...ing,
      quantity_raw: ing.quantity_raw ? scaleQuantity(ing.quantity_raw, ratio) : ing.quantity_raw,
      quantity_cooked: ing.quantity_cooked ? scaleQuantity(ing.quantity_cooked, ratio) : ing.quantity_cooked,
      quantity: ing.quantity ? scaleQuantity(ing.quantity, ratio) : ing.quantity,
      calories: Math.round((Number(ing.calories) || 0) * ratio),
      protein: Math.round((Number(ing.protein) || 0) * ratio * 10) / 10,
      carbs: Math.round((Number(ing.carbs) || 0) * ratio * 10) / 10,
      fats: Math.round((Number(ing.fats) || 0) * ratio * 10) / 10,
    }));
    const totals = recalcTotals(scaledIngredients);
    setForm(p => ({ ...p, servings: newServings, ingredients: scaledIngredients, ...totals }));
  };

  const scaleQuantity = (qtyStr, ratio) => {
    const match = qtyStr.match(/^([\d.]+)\s*(.*)$/);
    if (match) return `${Math.round(Number(match[1]) * ratio * 10) / 10} ${match[2]}`.trim();
    return qtyStr;
  };

  const updateIngredient = (idx, key, val) => {
    const updated = form.ingredients.map((ing, i) => i === idx ? { ...ing, [key]: val } : ing);
    const totals = recalcTotals(updated);
    setForm(p => ({ ...p, ingredients: updated, ...totals }));
  };

  const removeIngredient = (idx) => {
    const updated = form.ingredients.filter((_, i) => i !== idx);
    const totals = recalcTotals(updated);
    setForm(p => ({ ...p, ingredients: updated, ...totals }));
  };

  const addIngredient = () => {
    if (!newIng.name.trim()) return;
    const updated = [...(form.ingredients || []), { ...newIng }];
    const totals = recalcTotals(updated);
    setForm(p => ({ ...p, ingredients: updated, ...totals }));
    setNewIng({ name: '', quantity_raw: '', quantity_cooked: '', calories: '', protein: '', carbs: '', fats: '' });
  };

  const handleSave = () => {
    if (!form.name.trim()) { toast.error('Name required'); return; }
    onSave(form);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Meal</DialogTitle></DialogHeader>

        <Tabs defaultValue="basic">
          <TabsList className="w-full">
            <TabsTrigger value="basic" className="flex-1">Basic Info</TabsTrigger>
            <TabsTrigger value="ingredients" className="flex-1">Ingredients</TabsTrigger>
            <TabsTrigger value="instructions" className="flex-1">Instructions</TabsTrigger>
          </TabsList>

          {/* BASIC INFO */}
          <TabsContent value="basic" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><Label>Meal Name</Label><Input value={form.name} onChange={e => setField('name', e.target.value)} /></div>
              <div>
                <Label>Category</Label>
                <Select value={form.category || 'Lunch'} onValueChange={v => setField('category', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Weight Display</Label>
                <Select value={form.weight_mode || 'raw'} onValueChange={v => setField('weight_mode', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="raw">Raw weights only</SelectItem>
                    <SelectItem value="cooked">Cooked weights only</SelectItem>
                    <SelectItem value="both">Both raw & cooked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Servings</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" min="0.5" step="0.5" value={form.servings || 1} onChange={e => handleServingsChange(e.target.value)} />
                  <span className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1"><RefreshCw className="w-3 h-3" />auto-scales</span>
                </div>
              </div>
              <div><Label>Prep time (min)</Label><Input type="number" value={form.prep_time_minutes || ''} onChange={e => setField('prep_time_minutes', Number(e.target.value))} /></div>
              <div><Label>Cook time (min)</Label><Input type="number" value={form.cook_time_minutes || ''} onChange={e => setField('cook_time_minutes', Number(e.target.value))} /></div>
            </div>

            <div className="border rounded-xl p-4 bg-muted/30">
              <p className="text-sm font-semibold mb-3">Nutrition Totals (auto-calculated from ingredients)</p>
              <div className="grid grid-cols-3 gap-3">
                {[['calories','Calories','kcal'],['protein','Protein','g'],['carbs','Carbs','g'],['fats','Fats','g'],['fiber','Fiber','g'],['sodium','Sodium','mg']].map(([k,label,unit]) => (
                  <div key={k}>
                    <Label className="text-xs">{label} ({unit})</Label>
                    <Input type="number" value={form[k] || ''} onChange={e => setField(k, Number(e.target.value))} className="h-8 text-sm" />
                  </div>
                ))}
              </div>
            </div>

            <div><Label>Image URL (optional)</Label><Input value={form.image_url || ''} onChange={e => setField('image_url', e.target.value)} placeholder="https://..." /></div>
          </TabsContent>

          {/* INGREDIENTS */}
          <TabsContent value="ingredients" className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Ingredients ({form.ingredients?.length || 0})</p>
              <Badge variant="outline" className="text-xs">Changing servings scales all quantities</Badge>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {(form.ingredients || []).map((ing, idx) => (
                <div key={idx} className="border rounded-lg p-3 space-y-2 bg-card">
                  <div className="flex items-center gap-2">
                    <Input className="flex-1 h-8 text-sm font-medium" value={ing.name} onChange={e => updateIngredient(idx, 'name', e.target.value)} placeholder="Ingredient name" />
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => removeIngredient(idx)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Raw weight</Label>
                      <Input className="h-7 text-xs" value={ing.quantity_raw || ''} onChange={e => updateIngredient(idx, 'quantity_raw', e.target.value)} placeholder="200g" />
                    </div>
                    <div>
                      <Label className="text-xs">Cooked weight</Label>
                      <Input className="h-7 text-xs" value={ing.quantity_cooked || ''} onChange={e => updateIngredient(idx, 'quantity_cooked', e.target.value)} placeholder="150g" />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[['calories','Cal'],['protein','P(g)'],['carbs','C(g)'],['fats','F(g)']].map(([k,lbl]) => (
                      <div key={k}>
                        <Label className="text-xs">{lbl}</Label>
                        <Input className="h-7 text-xs" type="number" value={ing[k] || ''} onChange={e => updateIngredient(idx, k, Number(e.target.value))} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Add new ingredient row */}
            <div className="border-2 border-dashed rounded-lg p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Add ingredient</p>
              <div className="grid grid-cols-2 gap-2">
                <Input className="h-8 text-sm col-span-2" value={newIng.name} onChange={e => setNewIng(p => ({ ...p, name: e.target.value }))} placeholder="Name" />
                <Input className="h-8 text-sm" value={newIng.quantity_raw} onChange={e => setNewIng(p => ({ ...p, quantity_raw: e.target.value }))} placeholder="Raw (e.g. 200g)" />
                <Input className="h-8 text-sm" value={newIng.quantity_cooked} onChange={e => setNewIng(p => ({ ...p, quantity_cooked: e.target.value }))} placeholder="Cooked (e.g. 150g)" />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[['calories','Cal'],['protein','Protein'],['carbs','Carbs'],['fats','Fats']].map(([k,lbl]) => (
                  <Input key={k} className="h-7 text-xs" type="number" placeholder={lbl} value={newIng[k]} onChange={e => setNewIng(p => ({ ...p, [k]: e.target.value }))} />
                ))}
              </div>
              <Button variant="outline" size="sm" className="w-full" onClick={addIngredient}><Plus className="w-3.5 h-3.5 mr-1" />Add Ingredient</Button>
            </div>
          </TabsContent>

          {/* INSTRUCTIONS */}
          <TabsContent value="instructions" className="mt-4 space-y-4">
            <div>
              <Label>Preparation Steps</Label>
              <Textarea value={form.preparation_steps || ''} onChange={e => setField('preparation_steps', e.target.value)} rows={8} placeholder="Step 1: ...\nStep 2: ..." />
            </div>
            <div>
              <Label>Tips & Notes</Label>
              <Textarea value={form.cooking_tips || ''} onChange={e => setField('cooking_tips', e.target.value)} rows={3} placeholder="Optional tips, substitutions..." />
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex gap-2 mt-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-1" onClick={handleSave}>Save Meal</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
