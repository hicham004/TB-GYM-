import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dumbbell, LayoutGrid, Table2, Lock, Calendar } from 'lucide-react';
import { differenceInDays, parseISO, format, addDays } from 'date-fns';
import TodayWorkout from '@/components/program/TodayWorkout';
import DayNotes from '@/components/program/DayNotes';
import ProgramTable from '@/components/program/ProgramTable';

export default function MyProgram() {
  const { user } = useCurrentUser();

  const { data: programs = [] } = useQuery({
    queryKey: ['my-program', user?.assigned_program_id],
    queryFn: () => api.entities.TrainingProgram.filter({ id: user.assigned_program_id }),
    enabled: !!user?.assigned_program_id,
  });
  const program = programs[0];

  // Fetch program cycle for start date
  const { data: cycles = [] } = useQuery({
    queryKey: ['my-program-cycle', user?.assigned_program_id, user?.id],
    queryFn: () => api.entities.ProgramCycle.filter({
      assigned_program_id: user.assigned_program_id,
      client_id: user.id,
    }),
    enabled: !!user?.assigned_program_id && !!user?.id,
  });
  const cycle = cycles[0];

  const { data: programExercises = [] } = useQuery({
    queryKey: ['my-program-exercises', user?.assigned_program_id],
    queryFn: () => api.entities.ProgramExercise.filter({ program_id: user.assigned_program_id }),
    enabled: !!user?.assigned_program_id,
  });

  const { data: exercises = [] } = useQuery({
    queryKey: ['exercises'],
    queryFn: () => api.entities.Exercise.list(),
  });

  // â”€â”€â”€ Visibility Computation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const visibilityMode = program?.visibility_mode || 'progressive';
  const unlockedWeeks = program?.unlocked_weeks || [];
  const numWeeks = program?.num_weeks || 0;
  const startDate = cycle?.start_date || null;

  const currentWeek = useMemo(() => {
    if (!startDate) return null;
    const w = Math.floor(differenceInDays(new Date(), parseISO(startDate)) / 7) + 1;
    return Math.min(Math.max(1, w), numWeeks);
  }, [startDate, numWeeks]);

  const isWeekAccessible = (weekNum) => {
    if (visibilityMode === 'full') return true;
    if (!currentWeek) return true; // fallback: no start date = full access
    if (weekNum <= currentWeek) return true; // past or current
    if (unlockedWeeks.includes(weekNum)) return true; // manually unlocked
    return false;
  };

  const getWeekUnlockDate = (weekNum) => {
    if (!startDate || weekNum <= 1) return null;
    const unlockDate = addDays(parseISO(startDate), (weekNum - 1) * 7);
    return format(unlockDate, 'dd/MM/yyyy');
  };

  // â”€â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [activeWeek, setActiveWeek] = useState(1);
  const [activeDay, setActiveDay] = useState(null);
  const [view, setView] = useState('grid');

  // Auto-navigate to current week on first load
  useEffect(() => {
    if (currentWeek && !activeDay && activeWeek === 1) {
      setActiveWeek(currentWeek);
    }
  }, [currentWeek]);

  // â”€â”€â”€ Empty States â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!user?.assigned_program_id) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <Dumbbell className="w-16 h-16 mx-auto mb-4 opacity-20" />
        <h2 className="text-xl font-semibold mb-2">No Program Assigned</h2>
        <p className="text-sm">Your coach hasn't assigned a training program yet.</p>
      </div>
    );
  }

  if (!program) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  const weeks = Array.from({ length: numWeeks }, (_, i) => i + 1);
  const days = Array.from({ length: program.num_days_per_week }, (_, i) => i + 1);

  const getExercises = (week, day) =>
    programExercises.filter(e => e.week === week && e.day === day).sort((a, b) => (a.order || 0) - (b.order || 0));

  // â”€â”€â”€ Daily Workout View â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (activeDay) {
    const dayExercises = getExercises(activeWeek, activeDay);
    const isPastWeek = currentWeek ? activeWeek < currentWeek : false;

    // Prevent viewing locked weeks
    if (!isWeekAccessible(activeWeek)) {
      setActiveDay(null);
      return null;
    }

    return (
      <div className="space-y-6">
        <TodayWorkout
          exercises={dayExercises}
          exerciseLibrary={exercises}
          week={activeWeek}
          day={activeDay}
          program={{ ...program, assigned_client_id: user?.id }}
          canEditWeight={user?.can_edit_weight_lifted !== false}
          isAdmin={false}
          onBack={() => setActiveDay(null)}
          queryKey={['my-program-exercises', user?.assigned_program_id]}
          readOnly={isPastWeek}
        />

        {/* Past week indicator */}
        {isPastWeek && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/40 text-sm text-muted-foreground">
            <Calendar className="w-4 h-4" />
            This is a past training week. You can review it but no changes can be made.
          </div>
        )}
      </div>
    );
  }

  // â”€â”€â”€ Main Grid View â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{program.name}</h1>
          <p className="text-muted-foreground mt-1">{numWeeks} weeks Â· {program.num_days_per_week} days/week</p>
        </div>
        {/* View toggle */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          <Button
            variant={view === 'grid' ? 'default' : 'ghost'}
            size="sm"
            className="h-8"
            onClick={() => setView('grid')}
          >
            <LayoutGrid className="w-4 h-4 mr-1.5" />
            Today's Workout
          </Button>
          <Button
            variant={view === 'table' ? 'default' : 'ghost'}
            size="sm"
            className="h-8"
            onClick={() => setView('table')}
          >
            <Table2 className="w-4 h-4 mr-1.5" />
            Full Program
          </Button>
        </div>
      </div>

      {/* â”€â”€â”€ Progressive Release Banner â”€â”€â”€ */}
      {visibilityMode === 'progressive' && currentWeek && (
        <Card className="border-0 shadow-sm bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Lock className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">
                  Focus on this week's training. Upcoming weeks will unlock automatically as you progress.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {startDate ? `Program started ${format(parseISO(startDate), 'MMM d, yyyy')}. ` : ''}
                  You're currently on <strong className="text-foreground">Week {currentWeek}</strong> of {numWeeks}.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* â”€â”€â”€ Full Program Table View â”€â”€â”€ */}
      {view === 'table' && (
        <div className="space-y-4">
          <ProgramTable
            program={program}
            programExercises={programExercises}
            exerciseLibrary={exercises}
            isAdmin={false}
            onAddExercise={() => {}}
            lockedWeeks={visibilityMode === 'progressive' && currentWeek
              ? weeks.filter(w => !isWeekAccessible(w))
              : []}
            currentWeek={currentWeek}
            weekUnlockDates={visibilityMode === 'progressive' && startDate
              ? Object.fromEntries(weeks.filter(w => !isWeekAccessible(w)).map(w => [w, getWeekUnlockDate(w)]))
              : {}}
          />

          {/* Locked weeks legend for table view */}
          {visibilityMode === 'progressive' && currentWeek && weeks.some(w => !isWeekAccessible(w)) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {weeks.filter(w => !isWeekAccessible(w)).map(weekNum => (
                <div key={weekNum} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                  <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Week {weekNum} â€” Locked</p>
                    <p className="text-xs text-muted-foreground">
                      Available on {getWeekUnlockDate(weekNum)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* â”€â”€â”€ Grid / Day Picker View â”€â”€â”€ */}
      {view === 'grid' && (
        <>
          <Tabs value={String(activeWeek)} onValueChange={v => setActiveWeek(Number(v))}>
            <TabsList className="flex-wrap h-auto gap-1">
              {weeks.map(w => {
                const accessible = isWeekAccessible(w);
                return (
                  <TabsTrigger
                    key={w}
                    value={String(w)}
                    className={`text-xs ${accessible ? '' : 'opacity-50'} ${w === currentWeek ? 'ring-1 ring-primary/30' : ''}`}
                  >
                    {!accessible && <Lock className="w-3 h-3 mr-1" />}
                    Week {w}
                    {w === currentWeek && <span className="ml-1 text-[9px] opacity-70">(now)</span>}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {weeks.map(week => {
              const accessible = isWeekAccessible(week);
              const isPastWeek = currentWeek ? week < currentWeek : false;

              if (!accessible) {
                return (
                  <TabsContent key={week} value={String(week)} className="mt-4">
                    <Card className="border border-dashed">
                      <CardContent className="p-8 text-center">
                        <Lock className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" />
                        <h3 className="text-lg font-semibold mb-2">Week {week} â€” Locked</h3>
                        <p className="text-muted-foreground">
                          This training week will become available on <strong className="text-foreground">{getWeekUnlockDate(week) || 'a future date'}</strong>.
                        </p>
                        <p className="text-sm text-muted-foreground mt-2">
                          Focus on your current week's training. Weeks unlock automatically as you progress through the program.
                        </p>
                      </CardContent>
                    </Card>
                  </TabsContent>
                );
              }

              return (
                <TabsContent key={week} value={String(week)} className="mt-4">
                  {/* Past week banner */}
                  {isPastWeek && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/40 text-sm text-muted-foreground mb-3">
                      <Calendar className="w-4 h-4" />
                      This is a past training week. You can review it but no changes can be made.
                    </div>
                  )}

                  {week === currentWeek && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 text-sm text-primary font-medium mb-3">
                      <LayoutGrid className="w-4 h-4" />
                      This is your current training week. Focus here!
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
                    {days.map(day => {
                      const dayEx = getExercises(week, day);
                      const allDone = dayEx.length > 0 && dayEx.every(e => e.completed);
                      return (
                        <button key={day} onClick={() => setActiveDay(day)}
                          className={`p-4 rounded-xl border-2 transition-all hover:shadow-md text-center
                            ${allDone ? 'border-chart-3 bg-chart-3/5' : 'border-border hover:border-primary'}
                          `}>
                          <p className="text-xs text-muted-foreground">Day</p>
                          <p className="text-2xl font-bold">{day}</p>
                          <p className="text-xs text-muted-foreground mt-1">{dayEx.length} exercises</p>
                          {allDone && <Badge className="mt-1 bg-chart-3 text-white text-[10px]">Complete</Badge>}
                        </button>
                      );
                    })}
                  </div>
                </TabsContent>
              );
            })}
          </Tabs>

          {/* Day Notes per selected week */}
          {user?.id && (
            <DayNotes
              programId={program.id}
              clientId={user.id}
              week={activeWeek}
              day={1}
              isAdmin={false}
            />
          )}

          {/* Program-level coach note (read-only for client) */}
          {program.admin_notes && (
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-sm">Coach Notes (Program)</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-muted-foreground whitespace-pre-wrap">{program.admin_notes}</p></CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
