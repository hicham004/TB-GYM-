import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Play } from 'lucide-react';

export default function ExerciseSelector({ open, onClose, onSelect, clientId }) {
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');

  const { data: exercises = [] } = useQuery({
    queryKey: ['exercises'],
    queryFn: () => api.entities.Exercise.list(),
    enabled: open,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['exercise-categories'],
    queryFn: () => api.entities.ExerciseCategory.list(),
    enabled: open,
  });

  const { data: strengthRecords = [] } = useQuery({
    queryKey: ['strength-records', clientId],
    queryFn: () => api.entities.ClientStrengthRecord.filter({ client_id: clientId }),
    enabled: open && !!clientId,
  });

  const getCategoryName = (id) => categories.find(c => c.id === id)?.name || '';
  const getCategoryIcon = (id) => categories.find(c => c.id === id)?.icon || '';
  const getStored1RM = (exerciseId) => strengthRecords.find(r => r.exercise_id === exerciseId)?.one_rm_kg;

  const filtered = exercises.filter(ex => {
    const matchesSearch = !search || ex.title?.toLowerCase().includes(search.toLowerCase());
    const matchesCat = filterCat === 'all' || ex.category_id === filterCat;
    return matchesSearch && matchesCat;
  });

  const grouped = categories.reduce((acc, cat) => {
    const catExercises = filtered.filter(ex => ex.category_id === cat.id);
    if (catExercises.length > 0) acc[cat.id] = { cat, exercises: catExercises };
    return acc;
  }, {});

  const handleSelect = (ex) => {
    const rm = getStored1RM(ex.id);
    onSelect({ ...ex, stored_one_rm: rm });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Select Exercise</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search exercises..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {filterCat === 'all' ? (
            Object.values(grouped).map(({ cat, exercises: catExs }) => (
              <div key={cat.id}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">
                  {cat.icon} {cat.name}
                </p>
                <div className="space-y-1">
                  {catExs.map(ex => {
                    const rm = getStored1RM(ex.id);
                    return (
                      <button
                        key={ex.id}
                        onClick={() => handleSelect(ex)}
                        className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors text-left gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {ex.video_url && <Play className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                          <p className="font-medium text-sm truncate">{ex.title}</p>
                        </div>
                        {rm && (
                          <Badge className="bg-primary/10 text-primary border-0 text-xs flex-shrink-0">
                            1RM: {rm}kg
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            filtered.map(ex => {
              const rm = getStored1RM(ex.id);
              return (
                <button
                  key={ex.id}
                  onClick={() => handleSelect(ex)}
                  className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors text-left gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {ex.video_url && <Play className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{ex.title}</p>
                      <Badge variant="secondary" className="text-xs mt-0.5">
                        {getCategoryIcon(ex.category_id)} {getCategoryName(ex.category_id)}
                      </Badge>
                    </div>
                  </div>
                  {rm && (
                    <Badge className="bg-primary/10 text-primary border-0 text-xs flex-shrink-0">
                      1RM: {rm}kg
                    </Badge>
                  )}
                </button>
              );
            })
          )}
          {filtered.length === 0 && (
            <p className="text-center text-muted-foreground text-sm py-12">No exercises found</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
