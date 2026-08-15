import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { toast } from 'sonner';
import { Copy, TrendingUp, Loader2 } from 'lucide-react';
import { calculateWeight, PLATE_INCREMENTS, rpeToRir } from '@/lib/rpeUtils';

const REP_OPTIONS = ['+0.5', '+1', '+2'];
const RPE_OPTIONS = ['+0.5', '+1'];
const WEIGHT_OPTIONS = ['+1 kg', '+2.5 kg', '+5 kg'];

export default function WeekDuplicator({ open, onClose, program, programExercises, programId, clientStrengthRecords = [] }) {
  const queryClient = useQueryClient();
  const [sourceWeek, setSourceWeek] = useState(1);
  const [targetWeeks, setTargetWeeks] = useState([]);
  const [applyProgression, setApplyProgression] = useState(false);
  const [repProg, setRepProg] = useState('+1');
  const [rpeProg, setRpeProg] = useState('none');
  const [weightProg, setWeightProg] = useState('none');
  const [customRep, setCustomRep] = useState('');
  const [customWeight, setCustomWeight] = useState('');
  const [plateIncrement, setPlateIncrement] = useState(1);

  const weeks = program ? Array.from({ length: program.num_weeks }, (_, i) => i + 1) : [];

  const toggleTarget = (w) => {
    setTargetWeeks(prev => prev.includes(w) ? prev.filter(x => x !== w) : [...prev, w]);
  };

  const parseProgValue = (val) => {
    if (!val || val === 'none') return 0;
    return parseFloat(val.replace('+', '').replace(' kg', '').replace('kg', '')) || 0;
  };

  // Get client-specific 1RM for an exercise, falling back to exercise's stored one_rm
  const getClientOneRM = (ex) => {
    if (!ex.exercise_id) return ex.one_rm;
    const clientRecord = clientStrengthRecords.find(r => r.exercise_id === ex.exercise_id);
    return clientRecord?.one_rm_kg || ex.one_rm;
  };

  const applyProg = (ex) => {
    const repDelta = !applyProgression ? 0 : (repProg === 'custom' ? parseFloat(customRep) || 0 : parseProgValue(repProg));
    const rpeDelta = !applyProgression ? 0 : parseProgValue(rpeProg);
    const wDelta = !applyProgression ? 0 : (weightProg === 'custom' ? parseFloat(customWeight) || 0 : parseProgValue(weightProg));

    let newReps = ex.reps;
    if (repDelta !== 0) {
      const num = parseFloat(ex.reps);
      if (!isNaN(num)) newReps = String(Math.round((num + repDelta) * 2) / 2);
    }

    const newRpe = rpeDelta && ex.rpe != null
      ? Math.min(10, Math.round((ex.rpe + rpeDelta) * 2) / 2)
      : ex.rpe;
    const newRir = newRpe != null ? rpeToRir(newRpe) : ex.rir;

    // Recalculate suggested weight using client 1RM + new reps/RPE
    const clientOneRM = getClientOneRM(ex);
    const newRepsNum = parseFloat(newReps);
    let newWeight = ex.weight_lifted;

    if (clientOneRM && newRepsNum && newRpe) {
      // Always recalculate from 1RM when reps or RPE changes
      const recalculated = calculateWeight(clientOneRM, newRepsNum, newRpe, plateIncrement);
      if (recalculated) newWeight = recalculated;
    } else if (wDelta && ex.weight_lifted) {
      // Fallback: add flat increment if no 1RM available
      newWeight = roundToNearestIncrement(ex.weight_lifted + wDelta, plateIncrement);
    }

    return {
      ...ex,
      reps: newReps,
      rpe: newRpe,
      rir: newRir,
      one_rm: clientOneRM || ex.one_rm,
      weight_lifted: newWeight,
    };
  };

  const roundToNearestIncrement = (val, inc) => {
    if (!inc) return val;
    return Math.round(val / inc) * inc;
  };

  const duplicate = useMutation({
    mutationFn: async () => {
      const sourceExercises = programExercises.filter(e => e.week === sourceWeek);
      if (sourceExercises.length === 0) throw new Error('Source week has no exercises');
      if (targetWeeks.length === 0) throw new Error('Select at least one target week');

      for (const targetWeek of targetWeeks) {
        const progressed = sourceExercises.map(ex => applyProg(ex));
        await Promise.all(progressed.map(ex => {
          const { id, created_date, updated_date, created_by, ...rest } = ex;
          return api.entities.ProgramExercise.create({
            ...rest,
            week: targetWeek,
            completed: false,
          });
        }));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['program-exercises', programId] });
      toast.success(`Week ${sourceWeek} duplicated to ${targetWeeks.length > 1 ? `weeks ${targetWeeks.join(', ')}` : `week ${targetWeeks[0]}`} successfully!`);
      onClose();
      setTargetWeeks([]);
    },
    onError: (err) => toast.error(err.message || 'Duplication failed'),
  });

  const firstEx = programExercises.filter(e => e.week === sourceWeek)[0];
  const previewAfter = firstEx ? applyProg(firstEx) : null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="w-5 h-5" />Duplicate Week
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {/* Source Week */}
          <div>
            <Label>Copy From (Source Week)</Label>
            <Select value={String(sourceWeek)} onValueChange={v => { setSourceWeek(Number(v)); setTargetWeeks([]); }}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {weeks.map(w => (
                  <SelectItem key={w} value={String(w)}>
                    Week {w} ({programExercises.filter(e => e.week === w).length} exercises)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Target Weeks */}
          <div>
            <Label>Copy To (Target Weeks)</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">Select one or more weeks to paste into</p>
            <div className="flex flex-wrap gap-2">
              {weeks.filter(w => w !== sourceWeek).map(w => (
                <button
                  key={w}
                  onClick={() => toggleTarget(w)}
                  className={`px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-all ${
                    targetWeeks.includes(w)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  Week {w}
                </button>
              ))}
            </div>
            {targetWeeks.length > 0 && (
              <p className="text-xs text-primary mt-2">
                Will duplicate to: {targetWeeks.sort((a, b) => a - b).map(w => `Week ${w}`).join(', ')}
              </p>
            )}
          </div>

          {/* Plate Rounding */}
          <div>
            <Label>Plate Rounding Increment</Label>
            <div className="flex gap-2 mt-1.5">
              {PLATE_INCREMENTS.map(inc => (
                <button
                  key={inc.value}
                  onClick={() => setPlateIncrement(inc.value)}
                  className={`px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-all ${
                    plateIncrement === inc.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  {inc.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Weights will be rounded to the nearest {plateIncrement}kg</p>
          </div>

          {/* Progressive Overload Toggle */}
          <div className="border rounded-xl p-4 space-y-4">
            <div className="flex items-center gap-3">
              <Checkbox
                id="progression"
                checked={applyProgression}
                onCheckedChange={setApplyProgression}
              />
              <label htmlFor="progression" className="flex items-center gap-2 font-medium cursor-pointer">
                <TrendingUp className="w-4 h-4 text-chart-3" />
                Apply Progressive Overload
              </label>
            </div>

            {applyProgression && (
              <div className="space-y-4 pl-1">
                {/* Rep Progression */}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Rep Change</Label>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {REP_OPTIONS.map(v => (
                      <button
                        key={v}
                        onClick={() => setRepProg(v)}
                        className={`px-3 py-1 rounded-md border text-sm font-medium transition-all ${repProg === v ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}
                      >
                        {v} rep
                      </button>
                    ))}
                    <button
                      onClick={() => setRepProg('custom')}
                      className={`px-3 py-1 rounded-md border text-sm font-medium transition-all ${repProg === 'custom' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}
                    >
                      Custom
                    </button>
                    <button
                      onClick={() => setRepProg('none')}
                      className={`px-3 py-1 rounded-md border text-sm font-medium transition-all ${repProg === 'none' ? 'border-muted-foreground bg-muted text-muted-foreground' : 'border-border hover:border-primary/50'}`}
                    >
                      None
                    </button>
                  </div>
                  {repProg === 'custom' && (
                    <Input
                      type="number"
                      step={0.5}
                      placeholder="e.g. 1.5"
                      value={customRep}
                      onChange={e => setCustomRep(e.target.value)}
                      className="mt-2 w-28"
                    />
                  )}
                </div>

                {/* RPE Progression */}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">RPE Increase</Label>
                  <p className="text-xs text-muted-foreground mb-1.5">Weight is auto-recalculated from 1RM when RPE changes</p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {RPE_OPTIONS.map(v => (
                      <button
                        key={v}
                        onClick={() => setRpeProg(v)}
                        className={`px-3 py-1 rounded-md border text-sm font-medium transition-all ${rpeProg === v ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}
                      >
                        {v} RPE
                      </button>
                    ))}
                    <button
                      onClick={() => setRpeProg('none')}
                      className={`px-3 py-1 rounded-md border text-sm font-medium transition-all ${rpeProg === 'none' ? 'border-muted-foreground bg-muted text-muted-foreground' : 'border-border hover:border-primary/50'}`}
                    >
                      None
                    </button>
                  </div>
                </div>

                {/* Weight Progression â€” only shown when no 1RM is available */}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Flat Weight Add (fallback â€” used only when no 1RM stored)</Label>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {WEIGHT_OPTIONS.map(v => (
                      <button
                        key={v}
                        onClick={() => setWeightProg(v)}
                        className={`px-3 py-1 rounded-md border text-sm font-medium transition-all ${weightProg === v ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}
                      >
                        {v}
                      </button>
                    ))}
                    <button
                      onClick={() => setWeightProg('custom')}
                      className={`px-3 py-1 rounded-md border text-sm font-medium transition-all ${weightProg === 'custom' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}
                    >
                      Custom
                    </button>
                    <button
                      onClick={() => setWeightProg('none')}
                      className={`px-3 py-1 rounded-md border text-sm font-medium transition-all ${weightProg === 'none' ? 'border-muted-foreground bg-muted text-muted-foreground' : 'border-border hover:border-primary/50'}`}
                    >
                      None
                    </button>
                  </div>
                  {weightProg === 'custom' && (
                    <Input
                      type="number"
                      step={0.5}
                      placeholder="e.g. 2.5"
                      value={customWeight}
                      onChange={e => setCustomWeight(e.target.value)}
                      className="mt-2 w-28"
                    />
                  )}
                </div>

                {/* Preview */}
                {firstEx && previewAfter && (
                  <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-2">
                    <p className="font-semibold text-muted-foreground">Preview (first exercise):</p>
                    <div className="space-y-1">
                      <p className="text-muted-foreground">
                        Before: <span className="font-medium text-foreground">{firstEx.exercise_title}</span> â€” {firstEx.sets}Ã—{firstEx.reps}{firstEx.rpe != null ? ` RPE${firstEx.rpe}` : ''}{firstEx.weight_lifted ? ` Â· ${firstEx.weight_lifted}kg` : ''}
                      </p>
                      <p className="text-chart-3 font-medium">
                        â†’ After: {previewAfter.sets}Ã—{previewAfter.reps}{previewAfter.rpe != null ? ` RPE${previewAfter.rpe}` : ''}{previewAfter.weight_lifted ? ` Â· ${previewAfter.weight_lifted}kg` : ''}
                        {getClientOneRM(firstEx) && <span className="text-muted-foreground ml-1">(auto from 1RM {getClientOneRM(firstEx)}kg)</span>}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <Button
            onClick={() => duplicate.mutate()}
            disabled={targetWeeks.length === 0 || duplicate.isPending}
            className="w-full gap-2"
          >
            {duplicate.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Duplicating...</>
            ) : (
              <><Copy className="w-4 h-4" />Duplicate Week {sourceWeek} â†’ {targetWeeks.length === 0 ? '...' : targetWeeks.sort((a, b) => a - b).map(w => `W${w}`).join(', ')}</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
