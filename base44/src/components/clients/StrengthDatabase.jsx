import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dumbbell, Plus, Trash2, Save, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import ExerciseSelector from '@/components/exercises/ExerciseSelector';

export default function StrengthDatabase({ clientId }) {
  const queryClient = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editVal, setEditVal] = useState('');

  const { data: records = [] } = useQuery({
    queryKey: ['strength-records', clientId],
    queryFn: () => api.entities.ClientStrengthRecord.filter({ client_id: clientId }),
    enabled: !!clientId,
  });

  const addRecord = useMutation({
    mutationFn: (data) => api.entities.ClientStrengthRecord.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strength-records', clientId] });
      toast.success('1RM saved to client database!');
    },
  });

  const updateRecord = useMutation({
    mutationFn: ({ id, one_rm_kg }) => api.entities.ClientStrengthRecord.update(id, { one_rm_kg }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strength-records', clientId] });
      setEditingId(null);
      toast.success('1RM updated');
    },
  });

  const deleteRecord = useMutation({
    mutationFn: (id) => api.entities.ClientStrengthRecord.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strength-records', clientId] });
      toast.success('Record removed');
    },
  });

  const handleSelectExercise = (ex) => {
    const existing = records.find(r => r.exercise_id === ex.id);
    if (existing) {
      toast.info(`${ex.title} already in database. Edit the existing entry.`);
      return;
    }
    addRecord.mutate({
      client_id: clientId,
      exercise_id: ex.id,
      exercise_title: ex.title,
      one_rm_kg: ex.stored_one_rm || 0,
    });
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Exercise 1RM Database
          </CardTitle>
          <Button size="sm" onClick={() => setShowPicker(true)}>
            <Plus className="w-4 h-4 mr-2" />Add Exercise
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Store one-rep max values â€” auto-loaded when assigning exercises to programs</p>
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Dumbbell className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No strength records yet</p>
            <p className="text-xs mt-1">Add exercises to build this client's 1RM database</p>
          </div>
        ) : (
          <div className="space-y-2">
            {records.map(r => (
              <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 group">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{r.exercise_title}</p>
                </div>
                {editingId === r.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step={0.5}
                      value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      className="w-20 h-7 text-xs"
                      autoFocus
                    />
                    <span className="text-xs text-muted-foreground">kg</span>
                    <Button
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => updateRecord.mutate({ id: r.id, one_rm_kg: Number(editVal) })}
                      disabled={!editVal}
                    >
                      <Save className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditingId(null)}>âœ•</Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Badge
                      className="bg-primary/10 text-primary border-0 cursor-pointer hover:bg-primary/20 transition-colors"
                      onClick={() => { setEditingId(r.id); setEditVal(String(r.one_rm_kg)); }}
                    >
                      {r.one_rm_kg} kg 1RM
                    </Badge>
                    <button
                      onClick={() => deleteRecord.mutate(r.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <ExerciseSelector
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={handleSelectExercise}
        clientId={clientId}
      />
    </Card>
  );
}
