import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Play, Trash2, Plus, Calculator, Lock } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { toast } from 'sonner';
import { calculateWeight, rpeToRir, rirToRpe } from '@/lib/rpeUtils';

function ExerciseCell({ ex, onDelete, onVideoClick, isAdmin, clientStrengthRecords = [] }) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState({});
  const queryClient = useQueryClient();

  const updateEx = useMutation({
    mutationFn: ({ id, data }) => api.entities.ProgramExercise.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setEditing(false);
    },
    onError: () => toast.error('Save failed'),
  });

  // Priority: client-specific 1RM â†’ exercise stored 1RM
  const clientRecord = ex.exercise_id
    ? clientStrengthRecords.find(r => r.exercise_id === ex.exercise_id)
    : null;
  const effectiveOneRM = clientRecord?.one_rm_kg || ex.one_rm;

  const suggested = effectiveOneRM && parseInt(ex.reps) && ex.rpe
    ? calculateWeight(effectiveOneRM, parseInt(ex.reps), ex.rpe)
    : null;

  const startEdit = () => {
    setEditVal({
      sets: ex.sets ?? 3,
      reps: ex.reps ?? '',
      rpe: ex.rpe ?? '',
      rir: ex.rir ?? '',
      weight_lifted: ex.weight_lifted ?? '',
    });
    setEditing(true);
  };

  const saveEdit = () => {
    const data = {
      sets: Number(editVal.sets) || ex.sets,
      reps: editVal.reps,
      rpe: editVal.rpe !== '' ? Number(editVal.rpe) : null,
      rir: editVal.rir !== '' ? Number(editVal.rir) : null,
      weight_lifted: editVal.weight_lifted !== '' ? Number(editVal.weight_lifted) : null,
    };
    updateEx.mutate({ id: ex.id, data });
  };

  if (editing) {
    return (
      <div className="p-2 rounded-lg bg-primary/5 border-2 border-primary/40 space-y-1.5">
        <div className="font-medium text-xs truncate text-primary">{ex.exercise_title}</div>
        <div className="grid grid-cols-2 gap-1">
          <div>
            <p className="text-[8px] text-muted-foreground mb-0.5">Sets</p>
            <Input type="number" value={editVal.sets} onChange={e => setEditVal(p => ({ ...p, sets: e.target.value }))} className="h-6 text-xs px-1.5" />
          </div>
          <div>
            <p className="text-[8px] text-muted-foreground mb-0.5">Reps</p>
            <Input value={editVal.reps} onChange={e => setEditVal(p => ({ ...p, reps: e.target.value }))} className="h-6 text-xs px-1.5" />
          </div>
          <div>
            <p className="text-[8px] text-muted-foreground mb-0.5">RPE</p>
            <Input type="number" step={0.5} min={0} max={10} value={editVal.rpe}
              onChange={e => {
                const rpe = e.target.value;
                setEditVal(p => ({ ...p, rpe, rir: rpe !== '' ? rpeToRir(rpe) : '' }));
              }}
              className="h-6 text-xs px-1.5" />
          </div>
          <div>
            <p className="text-[8px] text-muted-foreground mb-0.5">RIR</p>
            <Input type="number" step={0.5} min={0} value={editVal.rir}
              onChange={e => {
                const rir = e.target.value;
                setEditVal(p => ({ ...p, rir, rpe: rir !== '' ? rirToRpe(rir) : '' }));
              }}
              className="h-6 text-xs px-1.5" />
          </div>
          <div className="col-span-2">
            <p className="text-[8px] text-muted-foreground mb-0.5">Weight (kg)</p>
            <Input type="number" step={0.5} value={editVal.weight_lifted}
              placeholder={suggested ? `~${suggested}` : ''}
              onChange={e => setEditVal(p => ({ ...p, weight_lifted: e.target.value }))}
              className="h-6 text-xs px-1.5" />
          </div>
        </div>
        <div className="flex gap-1">
          <Button size="sm" className="h-6 text-[9px] px-2 flex-1" onClick={saveEdit} disabled={updateEx.isPending}>
            {updateEx.isPending ? '...' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[9px] px-2" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group p-2 rounded-lg bg-muted/40 border border-border/50 hover:border-primary/30 transition-all">
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <button
          onClick={() => onVideoClick(ex)}
          className="font-medium text-xs text-left hover:text-primary transition-colors flex items-center gap-1 flex-1 min-w-0 truncate"
        >
          <Play className="w-2.5 h-2.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{ex.exercise_title}</span>
        </button>
        {isAdmin && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={startEdit} className="text-primary p-0.5 rounded hover:bg-primary/10">
              <Calculator className="w-2.5 h-2.5" />
            </button>
            <button onClick={() => onDelete(ex.id)} className="text-destructive p-0.5 rounded hover:bg-destructive/10">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        <Badge variant="secondary" className="text-[9px] px-1 py-0">{ex.sets}Ã—{ex.reps}</Badge>
        {ex.rpe != null && <Badge variant="outline" className="text-[9px] px-1 py-0">RPE {ex.rpe}</Badge>}
        {ex.rir != null && <Badge variant="outline" className="text-[9px] px-1 py-0">RIR {ex.rir}</Badge>}
      </div>
      <div className="mt-1.5">
        {ex.weight_lifted
          ? <Badge className="text-[9px] bg-chart-3/80 text-white px-1 py-0 cursor-pointer" onClick={isAdmin ? startEdit : undefined}>{ex.weight_lifted}kg</Badge>
          : suggested
            ? <span className="text-[9px] text-muted-foreground flex items-center gap-0.5"><Calculator className="w-2.5 h-2.5" />~{suggested}kg</span>
            : null
        }
      </div>
    </div>
  );
}

export default function ProgramTable({ program, programExercises, exerciseLibrary, isAdmin, onAddExercise, clientStrengthRecords = [], lockedWeeks = [], currentWeek = null, weekUnlockDates = {} }) {
  const [videoModal, setVideoModal] = useState(null);
  const queryClient = useQueryClient();

  const weeks = Array.from({ length: program.num_weeks }, (_, i) => i + 1);
  const days = Array.from({ length: program.num_days_per_week }, (_, i) => i + 1);

  const isWeekLocked = (weekNum) => lockedWeeks.includes(weekNum);

  const getWeekStatus = (weekNum) => {
    if (isAdmin && currentWeek) {
      if (weekNum < currentWeek) return 'completed';
      if (weekNum === currentWeek) return 'active';
    }
    return null;
  };

  const getExercises = (week, day) =>
    programExercises.filter(e => e.week === week && e.day === day).sort((a, b) => (a.order || 0) - (b.order || 0));

  const deleteEx = useMutation({
    mutationFn: (id) => api.entities.ProgramExercise.delete(id),
    onSuccess: () => { queryClient.invalidateQueries(); toast.success('Removed'); },
  });

  const handleVideoClick = (ex) => {
    const videoUrl = exerciseLibrary.find(e => e.title === ex.exercise_title)?.video_url;
    if (videoUrl) setVideoModal({ title: ex.exercise_title, url: videoUrl });
    else toast.info('No video for this exercise');
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse min-w-[600px]">
        <thead>
          <tr className="bg-muted/80">
            <th className="p-2 text-left font-semibold border border-border/50 sticky left-0 bg-muted/80 z-10 w-16">
              Week \ Day
            </th>
            {days.map(d => (
              <th key={d} className="p-2 text-center font-semibold border border-border/50 min-w-[140px]">
                Day {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map(week => {
            const status = getWeekStatus(week);
            const locked = isWeekLocked(week);
            return (
            <tr key={week} className="hover:bg-muted/20 transition-colors">
              <td className="p-2 border border-border/50 sticky left-0 bg-card z-10 font-semibold text-center">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-muted-foreground text-xs">W{week}</span>
                  {status && (
                    <Badge variant="outline" className={`text-[9px] px-1 py-0 border ${
                      status === 'completed' ? 'bg-green-500/10 text-green-700 border-green-200' :
                      status === 'active' ? 'bg-primary/10 text-primary border-primary/30' : ''
                    }`}>
                      {status === 'completed' ? 'âœ“' : 'ðŸŸ¢'}
                    </Badge>
                  )}
                </div>
              </td>
              {locked ? (
                <td colSpan={days.length} className="p-3 border border-border/50 align-middle">
                  <div className="text-center py-6 bg-muted/20 rounded-lg border border-dashed">
                    <Lock className="w-5 h-5 mx-auto mb-1.5 text-muted-foreground/40" />
                    <p className="font-medium text-xs text-muted-foreground">Week {week} â€” Locked</p>
                    {weekUnlockDates[week] && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Available on {weekUnlockDates[week]}
                      </p>
                    )}
                  </div>
                </td>
              ) : (
                days.map(day => {
                const dayExercises = getExercises(week, day);
                return (
                  <td key={day} className="p-1.5 border border-border/50 align-top">
                    <div className="space-y-1.5 min-h-[60px]">
                      {dayExercises.map(ex => (
                        <ExerciseCell
                          key={ex.id}
                          ex={ex}
                          onDelete={(id) => deleteEx.mutate(id)}
                          onVideoClick={handleVideoClick}
                          isAdmin={isAdmin}
                          clientStrengthRecords={clientStrengthRecords}
                        />
                      ))}
                      {isAdmin && (
                        <button
                          onClick={() => onAddExercise(week, day)}
                          className="w-full p-1 rounded border border-dashed border-border/50 text-muted-foreground hover:border-primary hover:text-primary transition-colors flex items-center justify-center gap-1"
                        >
                          <Plus className="w-3 h-3" /><span className="text-[9px]">Add</span>
                        </button>
                      )}
                    </div>
                  </td>
                );
              }))}
            </tr>
            );
          })}
        </tbody>
      </table>

      {videoModal && (
        <Dialog open={!!videoModal} onOpenChange={() => setVideoModal(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{videoModal.title}</DialogTitle></DialogHeader>
            <video
              src={videoModal.url}
              controls
              autoPlay
              controlsList={isAdmin ? undefined : 'nodownload'}
              onContextMenu={e => !isAdmin && e.preventDefault()}
              className="w-full rounded-lg"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
