import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TrendingUp, Plus, Save, Trash2, Copy, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import ExerciseSelector from '@/components/exercises/ExerciseSelector';

export default function ProgramOneRMPanel({ programId, clientId }) {
  const queryClient = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editVal, setEditVal] = useState('');
  const [showImportDialog, setShowImportDialog] = useState(false);

  // Program-specific 1RM records
  const { data: programRecords = [] } = useQuery({
    queryKey: ['program-1rm', programId],
    queryFn: () => api.entities.ProgramStrengthProfile.filter({ program_id: programId }),
    enabled: !!programId,
  });

  // Global client 1RM records (fallback source / import source)
  const { data: globalRecords = [] } = useQuery({
    queryKey: ['strength-records', clientId],
    queryFn: () => api.entities.ClientStrengthRecord.filter({ client_id: clientId }),
    enabled: !!clientId,
  });

  // Previous program 1RMs for import
  const { data: allProgramProfiles = [] } = useQuery({
    queryKey: ['all-program-1rm', clientId],
    queryFn: () => api.entities.ProgramStrengthProfile.filter({ client_id: clientId }),
    enabled: !!clientId,
  });

  const addRecord = useMutation({
    mutationFn: (data) => api.entities.ProgramStrengthProfile.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['program-1rm', programId] });
      toast.success('1RM saved for this program');
    },
  });

  const updateRecord = useMutation({
    mutationFn: ({ id, one_rm_kg }) => api.entities.ProgramStrengthProfile.update(id, { one_rm_kg }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['program-1rm', programId] });
      setEditingId(null);
      toast.success('1RM updated â€” weights will recalculate');
    },
  });

  const deleteRecord = useMutation({
    mutationFn: (id) => api.entities.ProgramStrengthProfile.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['program-1rm', programId] }),
  });

  const importFromGlobal = useMutation({
    mutationFn: async () => {
      const existing = new Set(programRecords.map(r => r.exercise_id));
      const toImport = globalRecords.filter(r => !existing.has(r.exercise_id));
      await Promise.all(toImport.map(r =>
        api.entities.ProgramStrengthProfile.create({
          program_id: programId,
          client_id: clientId,
          exercise_id: r.exercise_id,
          exercise_title: r.exercise_title,
          one_rm_kg: r.one_rm_kg,
        })
      ));
      return toImport.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['program-1rm', programId] });
      toast.success(`Imported ${count} 1RM values from client's global database`);
      setShowImportDialog(false);
    },
  });

  const resetAll = useMutation({
    mutationFn: async () => {
      await Promise.all(programRecords.map(r => api.entities.ProgramStrengthProfile.delete(r.id)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['program-1rm', programId] });
      toast.success('All program 1RM values cleared');
    },
  });

  const handleSelectExercise = (ex) => {
    const existing = programRecords.find(r => r.exercise_id === ex.id);
    if (existing) {
      toast.info(`${ex.title} already added. Click the value to edit.`);
      return;
    }
    // Try to pre-fill from global records
    const globalMatch = globalRecords.find(r => r.exercise_id === ex.id);
    addRecord.mutate({
      program_id: programId,
      client_id: clientId,
      exercise_id: ex.id,
      exercise_title: ex.title,
      one_rm_kg: globalMatch?.one_rm_kg || 0,
    });
    setShowPicker(false);
  };

  return (
    <>
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Program 1RM Settings
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowImportDialog(true)}>
                <Copy className="w-3 h-3" />Import from global
              </Button>
              {programRecords.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                  onClick={() => resetAll.mutate()}
                  disabled={resetAll.isPending}
                >
                  {resetAll.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Reset
                </Button>
              )}
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setShowPicker(true)}>
                <Plus className="w-3 h-3" />Add
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            These values override the global 1RM database for weight calculations <em>inside this program only</em>.
          </p>
        </CardHeader>
        <CardContent>
          {programRecords.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border border-dashed rounded-xl">
              <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No program-specific 1RMs yet</p>
              <p className="text-xs mt-1">Add values or import from client's global database.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {programRecords.map(r => (
                <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 group">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{r.exercise_title}</p>
                  </div>
                  {editingId === r.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number" step={0.5}
                        value={editVal}
                        onChange={e => setEditVal(e.target.value)}
                        className="w-20 h-7 text-xs" autoFocus
                      />
                      <span className="text-xs text-muted-foreground">kg</span>
                      <Button size="sm" className="h-7 px-2"
                        onClick={() => updateRecord.mutate({ id: r.id, one_rm_kg: Number(editVal) })}
                        disabled={!editVal}
                      ><Save className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditingId(null)}>âœ•</Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge
                        className="bg-primary/10 text-primary border-0 cursor-pointer hover:bg-primary/20 transition-colors"
                        onClick={() => { setEditingId(r.id); setEditVal(String(r.one_rm_kg)); }}
                      >
                        {r.one_rm_kg} kg
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
      </Card>

      <ExerciseSelector
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={handleSelectExercise}
        clientId={clientId}
      />

      {/* Import dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Import 1RM Values</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Copy 1RM values from the client's global database into this program.
              Only exercises not already in this program will be imported.
            </p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {globalRecords.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No global 1RM records found for this client.</p>
              ) : globalRecords.map(r => {
                const alreadyAdded = programRecords.some(p => p.exercise_id === r.exercise_id);
                return (
                  <div key={r.id} className={`flex items-center justify-between p-2 rounded-lg text-sm ${alreadyAdded ? 'opacity-40' : 'bg-muted/40'}`}>
                    <span>{r.exercise_title}</span>
                    <span className="font-bold text-primary">{r.one_rm_kg} kg {alreadyAdded && <span className="text-xs text-muted-foreground">(exists)</span>}</span>
                  </div>
                );
              })}
            </div>
            <Button
              className="w-full gap-2"
              onClick={() => importFromGlobal.mutate()}
              disabled={importFromGlobal.isPending || globalRecords.every(r => programRecords.some(p => p.exercise_id === r.exercise_id))}
            >
              {importFromGlobal.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
              Import All New Values
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
