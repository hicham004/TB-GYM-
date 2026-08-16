import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Play, CheckCircle, ArrowLeft, Calculator } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { toast } from 'sonner';
import { calculateWeight } from '@/lib/rpeUtils';
import DayNotes from '@/components/program/DayNotes';

export default function TodayWorkout({ exercises, exerciseLibrary, week, day, program, canEditWeight, isAdmin = false, onBack, queryKey, readOnly = false }) {
  const queryClient = useQueryClient();
  const [videoModal, setVideoModal] = useState(null);
  const [weights, setWeights] = useState({});

  const getVideoUrl = (title) => exerciseLibrary.find(e => e.title === title)?.video_url;

  const updateExercise = useMutation({
    mutationFn: ({ id, data }) => api.entities.ProgramExercise.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Saved');
    },
  });

  const handleSaveWeight = (ex) => {
    const w = weights[ex.id];
    if (w === undefined) return;
    updateExercise.mutate({ id: ex.id, data: { weight_lifted: Number(w) } });
  };

  const handleToggleDone = (ex) => {
    updateExercise.mutate({ id: ex.id, data: { completed: !ex.completed } });
  };

  // Auto-suggest weight based on 1RM + RPE
  const getSuggestedWeight = (ex) => {
    if (!ex.one_rm) return null;
    const reps = parseInt(ex.reps);
    if (!reps || !ex.rpe) return null;
    return calculateWeight(ex.one_rm, reps, ex.rpe);
  };

  const completedCount = exercises.filter(e => e.completed).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Week {week} Â· Day {day}</h2>
          <p className="text-muted-foreground text-sm">{program?.name} Â· {completedCount}/{exercises.length} done</p>
        </div>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" />Back
        </Button>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: exercises.length > 0 ? `${(completedCount / exercises.length) * 100}%` : '0%' }}
        />
      </div>

      {exercises.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium">Rest Day</p>
          <p className="text-sm mt-1">No exercises scheduled for today.</p>
        </div>
      )}
      <div className="space-y-3">
        {exercises.map((ex, idx) => {
          const suggested = getSuggestedWeight(ex);
          const videoUrl = getVideoUrl(ex.exercise_title);
          return (
            <Card key={ex.id} className={`border-0 shadow-sm transition-all ${ex.completed ? 'opacity-70' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-sm font-mono w-5">{idx + 1}.</span>
                    <button
                      onClick={() => { if (videoUrl) setVideoModal({ title: ex.exercise_title, url: videoUrl }); }}
                      className={`font-semibold flex items-center gap-1.5 hover:text-primary transition-colors ${videoUrl ? 'text-primary' : ''}`}
                    >
                      {videoUrl && <Play className="w-3.5 h-3.5" />}
                      {ex.exercise_title}
                    </button>
                  </div>
                  <button onClick={() => handleToggleDone(ex)} disabled={readOnly}>
                    <CheckCircle className={`w-6 h-6 transition-colors ${ex.completed ? 'text-green-500 fill-green-500/20' : 'text-muted-foreground/40'} ${readOnly ? 'cursor-not-allowed opacity-50' : ''}`} />
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-2 mb-3">
                  {[
                    { label: 'Sets', value: ex.sets },
                    { label: 'Reps', value: ex.reps },
                    { label: 'RPE', value: ex.rpe ?? '-' },
                    { label: 'RIR', value: ex.rir != null ? ex.rir : '-' },
                  ].map(cell => (
                    <div key={cell.label} className="p-2 rounded-lg bg-muted/50 text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{cell.label}</p>
                      <p className="font-bold text-sm">{cell.value}</p>
                    </div>
                  ))}
                </div>

                {canEditWeight && !readOnly && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Input
                        type="number"
                        step={0.5}
                        placeholder={suggested ? `Suggested: ${suggested}kg` : 'Weight (kg)'}
                        value={weights[ex.id] !== undefined ? weights[ex.id] : (ex.weight_lifted || '')}
                        onChange={e => setWeights(p => ({ ...p, [ex.id]: e.target.value }))}
                        className="w-36"
                      />
                      <span className="text-sm text-muted-foreground shrink-0">kg</span>
                    </div>
                    {suggested && !ex.weight_lifted && (
                      <Badge variant="outline" className="gap-1 cursor-pointer text-xs" onClick={() => setWeights(p => ({ ...p, [ex.id]: suggested }))}>
                        <Calculator className="w-3 h-3" />Auto: {suggested}kg
                      </Badge>
                    )}
                    <Button size="sm" variant="outline" onClick={() => handleSaveWeight(ex)}>
                      Save
                    </Button>
                  </div>
                )}

                {(readOnly || !canEditWeight) && ex.weight_lifted && (
                  <div className="mt-2">
                    <Badge className="bg-chart-3 text-white">{ex.weight_lifted}kg</Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Day Notes â€” shown when program has a client assigned */}
      {program?.assigned_client_id && (
        <DayNotes
          programId={program.id}
          clientId={program.assigned_client_id}
          week={week}
          day={day}
          isAdmin={isAdmin}
        />
      )}

      {videoModal && (
        <Dialog open={!!videoModal} onOpenChange={() => setVideoModal(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{videoModal.title}</DialogTitle></DialogHeader>
            <video
              src={videoModal.url}
              controls
              autoPlay
              controlsList="nodownload"
              onContextMenu={e => e.preventDefault()}
              className="w-full rounded-lg"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
