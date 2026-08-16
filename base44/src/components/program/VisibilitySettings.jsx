import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Lock, Unlock, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { format, differenceInDays, parseISO } from 'date-fns';

function getWeekStatus(weekNum, currentWeek, isUnlocked, numWeeks) {
  if (weekNum < currentWeek) return 'completed';
  if (weekNum === currentWeek) return 'active';
  if (isUnlocked) return 'unlocked_early';
  return 'locked';
}

const statusConfig = {
  completed:    { label: 'Completed',    icon: 'âœ“',  color: 'bg-green-500/10 text-green-700 border-green-200' },
  active:       { label: 'Active',       icon: 'ðŸŸ¢', color: 'bg-primary/10 text-primary border-primary/30' },
  locked:       { label: 'Locked',       icon: 'ðŸ”’', color: 'bg-muted text-muted-foreground border-border' },
  unlocked_early:{ label: 'Unlocked Early', icon: 'ðŸ”“', color: 'bg-orange-500/10 text-orange-600 border-orange-200' },
};

export default function VisibilitySettings({ program, programId, cycleStartDate }) {
  const queryClient = useQueryClient();
  const mode = program?.visibility_mode || 'progressive';
  const unlockedWeeks = program?.unlocked_weeks || [];
  const numWeeks = program?.num_weeks || 0;

  // Calculate current week based on cycle start date
  const currentWeek = cycleStartDate
    ? Math.min(Math.max(1, Math.floor(differenceInDays(new Date(), parseISO(cycleStartDate)) / 7) + 1), numWeeks)
    : null;

  const updateProgram = useMutation({
    mutationFn: (data) => api.entities.TrainingProgram.update(programId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['program', programId] });
      toast.success('Visibility settings updated');
    },
  });

  const handleToggleMode = () => {
    updateProgram.mutate({ visibility_mode: mode === 'progressive' ? 'full' : 'progressive' });
  };

  const handleUnlockAll = () => {
    const allWeeks = Array.from({ length: numWeeks }, (_, i) => i + 1);
    updateProgram.mutate({ unlocked_weeks: allWeeks });
  };

  const handleLockFuture = () => {
    updateProgram.mutate({ unlocked_weeks: [] });
  };

  const handleToggleWeek = (weekNum) => {
    const newList = unlockedWeeks.includes(weekNum)
      ? unlockedWeeks.filter(w => w !== weekNum)
      : [...unlockedWeeks, weekNum];
    updateProgram.mutate({ unlocked_weeks: newList });
  };

  const weeks = Array.from({ length: numWeeks }, (_, i) => i + 1);

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Eye className="w-4 h-4 text-primary" />
          Training Access Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Mode Toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${mode === 'progressive' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
              {mode === 'progressive' ? <Lock className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </div>
            <div>
              <p className="font-medium text-sm">Week Visibility Mode</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {mode === 'progressive'
                  ? 'Weeks unlock automatically based on program start date'
                  : 'Client can view all weeks immediately'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs cursor-pointer" htmlFor="mode-switch">
              {mode === 'progressive' ? 'Progressive Release' : 'Full Access'}
            </Label>
            <Switch
              id="mode-switch"
              checked={mode === 'full'}
              onCheckedChange={handleToggleMode}
              disabled={updateProgram.isPending}
            />
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="text-xs gap-1.5"
            onClick={handleUnlockAll}
            disabled={updateProgram.isPending}
          >
            <Unlock className="w-3.5 h-3.5" />Unlock All Weeks
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs gap-1.5"
            onClick={handleLockFuture}
            disabled={updateProgram.isPending}
          >
            <Lock className="w-3.5 h-3.5" />Lock Future Weeks
          </Button>
        </div>

        {/* Week Status Indicators */}
        {currentWeek && (
          <div>
            <p className="text-xs text-muted-foreground mb-3">
              Current week: <strong className="text-foreground">Week {currentWeek}</strong>
              {cycleStartDate && ` â€” started ${format(parseISO(cycleStartDate), 'MMM d, yyyy')}`}
            </p>
            <div className="space-y-1.5">
              {weeks.map(weekNum => {
                const status = getWeekStatus(weekNum, currentWeek, unlockedWeeks.includes(weekNum), numWeeks);
                const cfg = statusConfig[status];
                return (
                  <div key={weekNum} className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/60 hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-muted-foreground w-12">Wk {weekNum}</span>
                      <Badge variant="outline" className={`text-xs border ${cfg.color}`}>
                        <span className="mr-1">{cfg.icon}</span>{cfg.label}
                      </Badge>
                    </div>
                    {/* Toggle button for locked/unlocked-early weeks */}
                    {(status === 'locked' || status === 'unlocked_early') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1"
                        onClick={() => handleToggleWeek(weekNum)}
                        disabled={updateProgram.isPending}
                      >
                        {status === 'locked'
                          ? <><Unlock className="w-3 h-3" />Unlock</>
                          : <><Lock className="w-3 h-3" />Re-lock</>
                        }
                      </Button>
                    )}
                    {status === 'completed' && (
                      <span className="text-xs text-muted-foreground">(history)</span>
                    )}
                    {status === 'active' && (
                      <span className="text-xs text-primary font-medium">client training now</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!currentWeek && (
          <div className="text-center py-4 text-sm text-muted-foreground">
            <EyeOff className="w-6 h-6 mx-auto mb-2 opacity-30" />
            <p>No program start date found.</p>
            <p className="text-xs mt-1">Assign a program cycle with a start date to enable week tracking.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
