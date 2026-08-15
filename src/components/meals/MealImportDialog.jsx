import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/api/localClient';
import { Loader2, Sparkles, Link, FileText, Search } from 'lucide-react';
import { toast } from 'sonner';

const MEAL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    category: { type: 'string' },
    calories: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fats: { type: 'number' },
    fiber: { type: 'number' },
    sodium: { type: 'number' },
    servings: { type: 'number' },
    prep_time_minutes: { type: 'number' },
    cook_time_minutes: { type: 'number' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity_raw: { type: 'string' },
          quantity_cooked: { type: 'string' },
          quantity: { type: 'string' },
          calories: { type: 'number' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fats: { type: 'number' }
        }
      }
    },
    preparation_steps: { type: 'string' },
    cooking_tips: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } }
  }
};

export default function MealImportDialog({ open, onOpenChange, onImported }) {
  const [tab, setTab] = useState('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [loading, setLoading] = useState(false);

  const buildPrompt = () => {
    if (tab === 'search') {
      return `You are a professional nutritionist and chef. Generate a complete, detailed recipe for: "${searchQuery}".
Include realistic, accurate nutritional data based on standard food databases (USDA, etc.).
For every ingredient provide BOTH raw weight AND cooked/prepared weight in grams.
The macros (calories, protein, carbs, fats, fiber, sodium) should reflect the TOTAL for all servings combined.
Provide step-by-step cooking instructions.
Category must be one of: Breakfast, Lunch, Dinner, Snack, Pre-Workout, Post-Workout, Bulking, Cutting, High Protein, Low Carb, Vegan, Vegetarian.`;
    }
    if (tab === 'url') {
      return `You are a professional nutritionist. Analyze this recipe URL: ${urlInput}
Extract all recipe data and calculate accurate nutritional information per ingredient and totals.
For every ingredient provide BOTH raw weight AND cooked/prepared weight.
Category must be one of: Breakfast, Lunch, Dinner, Snack, Pre-Workout, Post-Workout, Bulking, Cutting, High Protein, Low Carb, Vegan, Vegetarian.`;
    }
    return `You are a professional nutritionist. Parse this recipe text and extract all recipe information:

${textInput}

Calculate accurate nutritional data for each ingredient and totals.
For every ingredient provide BOTH raw weight AND cooked/prepared weight.
Category must be one of: Breakfast, Lunch, Dinner, Snack, Pre-Workout, Post-Workout, Bulking, Cutting, High Protein, Low Carb, Vegan, Vegetarian.`;
  };

  const handleImport = async () => {
    const hasInput = (tab === 'search' && searchQuery.trim()) ||
      (tab === 'url' && urlInput.trim()) ||
      (tab === 'text' && textInput.trim());
    if (!hasInput) { toast.error('Please enter something to import'); return; }

    setLoading(true);
    try {
      // Use gemini for web search (URL/search tabs), claude for text parsing
      const needsInternet = tab === 'url' || tab === 'search';
      const result = await api.integrations.Core.InvokeLLM({
        prompt: buildPrompt(),
        add_context_from_internet: needsInternet,
        response_json_schema: MEAL_JSON_SCHEMA,
        model: needsInternet ? 'gemini_3_1_pro' : 'claude_sonnet_4_6',
      });

      // Normalize: ensure macros are per-total-servings
      const servings = result.servings || 1;
      const meal = {
        ...result,
        servings,
        weight_mode: 'both',
        source_url: tab === 'url' ? urlInput : undefined,
      };
      onImported(meal);
      onOpenChange(false);
      setSearchQuery(''); setUrlInput(''); setTextInput('');
    } catch (e) {
      toast.error('Import failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            AI Meal Import
          </DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="search" className="flex-1 gap-1.5"><Search className="w-3.5 h-3.5" />Search</TabsTrigger>
            <TabsTrigger value="url" className="flex-1 gap-1.5"><Link className="w-3.5 h-3.5" />URL</TabsTrigger>
            <TabsTrigger value="text" className="flex-1 gap-1.5"><FileText className="w-3.5 h-3.5" />Paste Text</TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="mt-4 space-y-3">
            <Label>Dish name or recipe</Label>
            <Input
              placeholder="e.g. High Protein Chicken Alfredo, Overnight Oats..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleImport()}
            />
            <p className="text-xs text-muted-foreground">AI will generate a complete recipe with ingredients, macros, and instructions.</p>
          </TabsContent>

          <TabsContent value="url" className="mt-4 space-y-3">
            <Label>Recipe URL</Label>
            <Input
              placeholder="https://..."
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Paste any recipe website URL and AI will extract all data automatically.</p>
          </TabsContent>

          <TabsContent value="text" className="mt-4 space-y-3">
            <Label>Recipe text</Label>
            <Textarea
              placeholder="Paste recipe text here â€” ingredients, instructions, any format..."
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              rows={6}
            />
          </TabsContent>
        </Tabs>

        <Button onClick={handleImport} disabled={loading} className="w-full mt-2">
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating recipe...</> : <><Sparkles className="w-4 h-4 mr-2" />Import & Generate</>}
        </Button>
        {loading && <p className="text-xs text-center text-muted-foreground">This may take 10â€“20 seconds â€” AI is calculating all macros...</p>}
      </DialogContent>
    </Dialog>
  );
}
