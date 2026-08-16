import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, Save, Calendar, LayoutGrid, Table2, Plus, Copy, PlusCircle, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import ExerciseSelector from '@/components/exercises/ExerciseSelector';
import ProgramTable from '@/components/program/ProgramTable';
import TodayWorkout from '@/components/program/TodayWorkout';
import WeekDuplicator from '@/components/program/WeekDuplicator';
import ProgramOneRMPanel from '@/components/program/ProgramOneRMPanel';
import VisibilitySettings from '@/components/program/VisibilitySettings';
import { calculateWeight, rpeToRir, rirToRpe } from '@/lib/rpeUtils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function ProgramDetail() {
  const programId = window.location.pathname.split('/').pop();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState('table'); // 'table' | 'today'
  const [todayWeek, setTodayWeek] = useState(1);
  const [todayDay, setTodayDay] = useState(1);
  const [showSelector, setShowSelector] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showDuplicator, setShowDuplicator] = useState(false);
  const [showAddWeeks, setShowAddWeeks] = useState(false);
  const [weeksToAdd, setWeeksToAdd] = useState(1);
  const [selectedCell, setSelectedCell] = useState({ week: 1, day: 1 });
  const [exerciseForm, setExerciseForm] = useState({
    exercise_id: '', exercise_title: '', sets: 3, reps: '10', rpe: 7, rir: 2, weight_lifted: '', one_rm: '',
  });
  const [adminNotes, setAdminNotes] = useState('');

  const { data: programs = [] } = useQuery({
    queryKey: ['program', programId],
    queryFn: () => api.entities.TrainingProgram.filter({ id: programId }),
  });
  const program = programs[0];

  const { data: programExercises = [] } = useQuery({
    queryKey: ['program-exercises', programId],
    queryFn: () => api.entities.ProgramExercise.filter({ program_id: programId }),
    enabled: !!programId,
  });

  const { data: exercises = [] } = useQuery({
    queryKey: ['exercises'],
    queryFn: () => api.entities.Exercise.list(),
  });

  const { data: clientStrengthRecords = [] } = useQuery({
    queryKey: ['client-strength', program?.assigned_client_id],
    queryFn: () => api.entities.ClientStrengthRecord.filter({ client_id: program.assigned_client_id }),
    enabled: !!program?.assigned_client_id,
  });

  // Program-specific 1RM â€” takes priority over global records
  const { data: programStrengthProfiles = [] } = useQuery({
    queryKey: ['program-1rm', programId],
    queryFn: () => api.entities.ProgramStrengthProfile.filter({ program_id: programId }),
    enabled: !!programId,
  });

  // Fetch program cycle for start date (used by visibility settings)
  const { data: programCycles = [] } = useQuery({
    queryKey: ['program-cycle', programId, program?.assigned_client_id],
    queryFn: () => api.entities.ProgramCycle.filter({
      assigned_program_id: programId,
      client_id: program.assigned_client_id,
    }),
    enabled: !!programId && !!program?.assigned_client_id,
  });
  const programCycle = programCycles[0];
  const cycleStartDate = programCycle?.start_date || null;

  // Merge: program-specific overrides global for matching exercise_id
  const mergedStrengthRecords = React.useMemo(() => {
    const programMap = new Map(programStrengthProfiles.map(r => [r.exercise_id, r]));
    const base = clientStrengthRecords.map(r => programMap.has(r.exercise_id) ? { ...r, one_rm_kg: programMap.get(r.exercise_id).one_rm_kg } : r);
    // Add any program-specific entries not in global
    programStrengthProfiles.forEach(r => {
      if (!base.find(b => b.exercise_id === r.exercise_id)) base.push(r);
    });
    return base;
  }, [clientStrengthRecords, programStrengthProfiles]);

  useEffect(() => {
    if (program) setAdminNotes(program.admin_notes || '');
  }, [program]);

  const addExercise = useMutation({
    mutationFn: (data) => api.entities.ProgramExercise.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['program-exercises', programId] });
      setShowAddForm(false);
      setExerciseForm({ exercise_id: '', exercise_title: '', sets: 3, reps: '10', rpe: 7, rir: 2, weight_lifted: '', one_rm: '' });
      toast.success('Exercise added');
    },
  });

  const updateNotes = useMutation({
    mutationFn: (data) => api.entities.TrainingProgram.update(programId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['program', programId] }); toast.success('Notes saved'); },
  });

  const addWeeksMutation = useMutation({
    mutationFn: async (count) => {
      const newNumWeeks = (program.num_weeks || 0) + count;
      await api.entities.TrainingProgram.update(programId, { num_weeks: newNumWeeks });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['program', programId] });
      setShowAddWeeks(false);
      setWeeksToAdd(1);
      toast.success('Weeks added! Program extended.');
    },
  });

  const handleSelectExercise = (ex) => {
    const updates = { exercise_id: ex.id, exercise_title: ex.title };
    // Program-specific 1RM takes priority, then global
    const programMatch = programStrengthProfiles.find(r => r.exercise_id === ex.id);
    const globalMatch = clientStrengthRecords.find(r => r.exercise_id === ex.id);
    const oneRm = programMatch?.one_rm_kg || globalMatch?.one_rm_kg || ex.stored_one_rm;
    if (oneRm) updates.one_rm = String(oneRm);
    setExerciseForm(p => ({ ...p, ...updates }));
    setShowSelector(false);
  };

  const handleAddExercise = () => {
    const existing = programExercises.filter(e => e.week === selectedCell.week && e.day === selectedCell.day);
    const payload = {
      program_id: programId,
      week: selectedCell.week,
      day: selectedCell.day,
      order: existing.length + 1,
      exercise_id: exerciseForm.exercise_id,
      exercise_title: exerciseForm.exercise_title,
      sets: exerciseForm.sets,
      reps: exerciseForm.reps,
      rpe: exerciseForm.rpe,
      rir: exerciseForm.rir,
    };
    if (exerciseForm.one_rm) payload.one_rm = Number(exerciseForm.one_rm);
    if (exerciseForm.weight_lifted) payload.weight_lifted = Number(exerciseForm.weight_lifted);
    addExercise.mutate(payload);
  };

  const onAddExercise = (week, day) => {
    setSelectedCell({ week, day });
    setShowAddForm(true);
  };

  // Auto-calculate weight suggestion
  const suggestedWeight = exerciseForm.one_rm && exerciseForm.reps && exerciseForm.rpe
    ? calculateWeight(Number(exerciseForm.one_rm), parseInt(exerciseForm.reps), exerciseForm.rpe)
    : null;

  const weeks = program ? Array.from({ length: program.num_weeks }, (_, i) => i + 1) : [];
  const days = program ? Array.from({ length: program.num_days_per_week }, (_, i) => i + 1) : [];

  const todayExercises = viewMode === 'today'
    ? programExercises.filter(e => e.week === todayWeek && e.day === todayDay).sort((a, b) => (a.order || 0) - (b.order || 0))
    : [];

  if (!program) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate('/programs')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">{program.name}</h1>
          <p className="text-muted-foreground text-sm">{program.num_weeks} weeks Â· {program.num_days_per_week} days/week</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1"
            onClick={() => setShowAddWeeks(true)}
          >
            <PlusCircle className="w-3.5 h-3.5" />Add Weeks
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1"
            onClick={() => setShowDuplicator(true)}
          >
            <Copy className="w-3.5 h-3.5" />Duplicate Week
          </Button>
          <div className="flex items-center gap-2 border rounded-lg p-1">
            <Button
              size="sm"
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              className="h-7 text-xs gap-1"
              onClick={() => setViewMode('table')}
            >
              <Table2 className="w-3.5 h-3.5" />Full Table
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'today' ? 'default' : 'ghost'}
              className="h-7 text-xs gap-1"
              onClick={() => setViewMode('today')}
            >
              <Calendar className="w-3.5 h-3.5" />Today's Workout
            </Button>
          </div>
        </div>
      </div>

      {/* Today's Workout selector */}
      {viewMode === 'today' && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Label>Week</Label>
                <Select value={String(todayWeek)} onValueChange={v => setTodayWeek(Number(v))}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>{weeks.map(w => <SelectItem key={w} value={String(w)}>Week {w}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label>Day</Label>
                <Select value={String(todayDay)} onValueChange={v => setTodayDay(Number(v))}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>{days.map(d => <SelectItem key={d} value={String(d)}>Day {d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content */}
      {viewMode === 'table' ? (
        <Card className="border-0 shadow-sm overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <LayoutGrid className="w-4 h-4" />Program Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <ProgramTable
              program={program}
              programExercises={programExercises}
              exerciseLibrary={exercises}
              isAdmin={true}
              onAddExercise={onAddExercise}
              clientStrengthRecords={mergedStrengthRecords}
            />
          </CardContent>
        </Card>
      ) : (
        <TodayWorkout
          exercises={todayExercises}
          exerciseLibrary={exercises}
          week={todayWeek}
          day={todayDay}
          program={program}
          canEditWeight={true}
          isAdmin={true}
          onBack={() => setViewMode('table')}
          queryKey={['program-exercises', programId]}
        />
      )}

      {/* Visibility Settings */}
      <VisibilitySettings
        program={program}
        programId={programId}
        cycleStartDate={cycleStartDate}
      />

      {/* Program 1RM Settings */}
      {program?.assigned_client_id && (
        <ProgramOneRMPanel programId={programId} clientId={program.assigned_client_id} />
      )}

      {/* Coach Notes */}
      <Card className="border-0 shadow-sm">
        <CardHeader><CardTitle className="text-base">Coach Notes</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} placeholder="Notes for this program..." rows={4} />
          <Button size="sm" onClick={() => updateNotes.mutate({ admin_notes: adminNotes })}>
            <Save className="w-4 h-4 mr-2" />Save Notes
          </Button>
        </CardContent>
      </Card>

      {/* Add Exercise Dialog */}
      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Exercise â€” Week {selectedCell.week}, Day {selectedCell.day}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Exercise</Label>
              <div className="flex gap-2">
                <Input value={exerciseForm.exercise_title} readOnly placeholder="Select exercise..." className="flex-1" />
                <Button variant="outline" onClick={() => setShowSelector(true)}>Browse</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Sets</Label><Input type="number" min={1} value={exerciseForm.sets} onChange={e => setExerciseForm(p => ({ ...p, sets: Number(e.target.value) }))} /></div>
              <div><Label>Reps</Label><Input value={exerciseForm.reps} onChange={e => setExerciseForm(p => ({ ...p, reps: e.target.value }))} placeholder="8-12" /></div>
              <div>
                <Label>RPE (0â€“10)</Label>
                <Input type="number" min={0} max={10} step={0.5} value={exerciseForm.rpe}
                  onChange={e => {
                    const rpe = Number(e.target.value);
                    setExerciseForm(p => ({ ...p, rpe, rir: rpeToRir(rpe) }));
                  }} />
              </div>
              <div>
                <Label>RIR</Label>
                <Input type="number" min={0} value={exerciseForm.rir}
                  onChange={e => {
                    const rir = Number(e.target.value);
                    setExerciseForm(p => ({ ...p, rir, rpe: rirToRpe(rir) }));
                  }} />
              </div>
            </div>

            {/* 1RM section */}
            <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
              <p className="text-sm font-medium flex items-center gap-1.5">Auto-Weight (1RM)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>1RM (kg)</Label>
                  <Input
                    type="number"
                    placeholder="e.g. 100"
                    value={exerciseForm.one_rm}
                    onChange={e => setExerciseForm(p => ({ ...p, one_rm: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Target Weight</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      step={0.5}
                      placeholder={suggestedWeight ? `Suggested: ${suggestedWeight}kg` : 'kg'}
                      value={exerciseForm.weight_lifted}
                      onChange={e => setExerciseForm(p => ({ ...p, weight_lifted: e.target.value }))}
                    />
                  </div>
                  {suggestedWeight && !exerciseForm.weight_lifted && (
                    <button
                      className="text-xs text-primary mt-1 hover:underline"
                      onClick={() => setExerciseForm(p => ({ ...p, weight_lifted: String(suggestedWeight) }))}
                    >
                      Use suggested: {suggestedWeight}kg
                    </button>
                  )}
                </div>
              </div>
            </div>

            <Button onClick={handleAddExercise} disabled={!exerciseForm.exercise_title} className="w-full">
              <Plus className="w-4 h-4 mr-2" />Add Exercise
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ExerciseSelector
        open={showSelector}
        onClose={() => setShowSelector(false)}
        onSelect={handleSelectExercise}
        clientId={program?.assigned_client_id}
      />

      <WeekDuplicator
        open={showDuplicator}
        onClose={() => setShowDuplicator(false)}
        program={program}
        programExercises={programExercises}
        programId={programId}
        clientStrengthRecords={mergedStrengthRecords}
      />

      {/* Add Weeks Dialog */}
      <Dialog open={showAddWeeks} onOpenChange={setShowAddWeeks}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PlusCircle className="w-4 h-4 text-primary" />
              Add Weeks to Program
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Current: <strong>{program.num_weeks} weeks</strong>. New weeks will be added as empty days â€” use "Duplicate Week" to copy exercises into them.
            </p>
            <div>
              <Label>Number of weeks to add</Label>
              <div className="flex items-center gap-2 mt-1.5">
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setWeeksToAdd(w => Math.max(1, w - 1))}>âˆ’</Button>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={weeksToAdd}
                  onChange={e => setWeeksToAdd(Math.max(1, Number(e.target.value)))}
                  className="text-center w-20"
                />
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setWeeksToAdd(w => w + 1)}>+</Button>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">New total:</span>
                <span className="font-bold text-primary">{(program.num_weeks || 0) + weeksToAdd} weeks</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-muted-foreground">New weeks added:</span>
                <span className="font-medium">
                  Week {program.num_weeks + 1}{weeksToAdd > 1 ? ` â†’ Week ${program.num_weeks + weeksToAdd}` : ''}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowAddWeeks(false)}>Cancel</Button>
              <Button
                className="flex-1 gap-2"
                disabled={addWeeksMutation.isPending}
                onClick={() => addWeeksMutation.mutate(weeksToAdd)}
              >
                {addWeeksMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Add {weeksToAdd} Week{weeksToAdd > 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
