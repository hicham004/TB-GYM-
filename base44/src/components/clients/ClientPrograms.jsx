import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Plus, Loader2, ChevronDown, ChevronUp, Dumbbell,
  ClipboardList, ExternalLink, AlertTriangle, CheckCircle2, Archive,
  Copy, UtensilsCrossed, Save
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { formatDate, calcEndDate, calcPaymentDueDate, todayISO } from '@/lib/dateUtils';
import { differenceInWeeks, differenceInDays, parseISO, isAfter, isBefore } from 'date-fns';

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function computeStatus(cycle, isBlocked) {
  if (isBlocked) return 'blocked';
  if (!cycle.start_date) return 'draft';
  const today = new Date();
  const start = parseISO(cycle.start_date);
  const end = cycle.end_date ? parseISO(cycle.end_date) : null;
  if (cycle.status === 'completed') return 'completed';
  if (end && isBefore(end, today)) return 'expired';
  if (isAfter(start, today)) return 'pending';
  return 'active';
}

const STATUS_CONFIG = {
  active:    { label: 'Active',    color: 'bg-green-500/15 text-green-700 dark:text-green-400',    dot: 'bg-green-500'         },
  completed: { label: 'Completed', color: 'bg-muted text-muted-foreground',                         dot: 'bg-muted-foreground'  },
  expired:   { label: 'Expired',   color: 'bg-orange-500/15 text-orange-700 dark:text-orange-400', dot: 'bg-orange-500'        },
  pending:   { label: 'Pending',   color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',       dot: 'bg-blue-500'          },
  blocked:   { label: 'Blocked',   color: 'bg-destructive/15 text-destructive',                    dot: 'bg-destructive'       },
  draft:     { label: 'Draft',     color: 'bg-secondary text-secondary-foreground',                dot: 'bg-secondary-foreground' },
};

const PAYMENT_CONFIG = {
  paid:     { label: 'Paid',     color: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  not_paid: { label: 'Not Paid', color: 'bg-chart-4/15 text-chart-4' },
  overdue:  { label: 'Overdue',  color: 'bg-destructive/15 text-destructive' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function PaymentBadge({ status }) {
  const cfg = PAYMENT_CONFIG[status] || PAYMENT_CONFIG.not_paid;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>;
}

function progressPercent(cycle) {
  if (!cycle.start_date || !cycle.end_date) return null;
  const total = differenceInDays(parseISO(cycle.end_date), parseISO(cycle.start_date));
  if (total <= 0) return null;
  const elapsed = differenceInDays(new Date(), parseISO(cycle.start_date));
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
}

// â”€â”€ CycleCard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function CycleCard({ cycle, program, exerciseCount, isBlocked, onUpdatePayment, isPending }) {
  const [open, setOpen] = useState(false);
  const status = computeStatus(cycle, isBlocked);
  const pct = progressPercent(cycle);
  const weeksCompleted = cycle.start_date
    ? Math.min(cycle.duration_weeks || 0, Math.max(0, differenceInWeeks(new Date(), parseISO(cycle.start_date))))
    : 0;

  const isActive = status === 'active';

  return (
    <div className={`rounded-xl border transition-all ${isActive ? 'border-primary/30 bg-primary/5' : 'border-border bg-card'}`}>
      {/* Header row */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer select-none"
        onClick={() => setOpen(v => !v)}
      >
        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${STATUS_CONFIG[status]?.dot || 'bg-muted-foreground'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{cycle.program_name}</span>
            <StatusBadge status={status} />
            <PaymentBadge status={cycle.payment_status || 'not_paid'} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDate(cycle.start_date)}
            {cycle.end_date ? ` â†’ ${formatDate(cycle.end_date)}` : ''}
            {cycle.duration_weeks ? ` Â· ${cycle.duration_weeks}w` : ''}
          </p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
      </div>

      {/* Progress bar for active */}
      {isActive && pct !== null && (
        <div className="px-4 pb-2">
          <div className="h-1.5 rounded-full bg-primary/20 overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{pct}% complete</p>
        </div>
      )}

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-border/60 p-4 space-y-4">
          {/* Detail grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <Detail label="Start Date" value={formatDate(cycle.start_date)} />
            <Detail label="End Date" value={formatDate(cycle.end_date)} />
            <Detail label="Duration" value={cycle.duration_weeks ? `${cycle.duration_weeks} weeks` : 'â€”'} />
            <Detail label="Status" value={<StatusBadge status={status} />} />
            <Detail label="Payment Due" value={formatDate(cycle.payment_due_date)} />
            <Detail label="Weeks Completed" value={`${weeksCompleted} / ${cycle.duration_weeks || '?'}`} />
            {pct !== null && <Detail label="Progress" value={`${pct}%`} />}
            {exerciseCount !== undefined && <Detail label="Exercise Count" value={exerciseCount} />}
            {program && <Detail label="Program Copy" value={program.name} />}
          </div>

          {/* Payment update */}
          <div className="flex items-center gap-3 flex-wrap">
            <Label className="text-xs text-muted-foreground">Payment:</Label>
            <Select
              value={cycle.payment_status || 'not_paid'}
              onValueChange={v => onUpdatePayment({ cycleId: cycle.id, payment_status: v })}
              disabled={isPending}
            >
              <SelectTrigger className="h-7 text-xs w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="not_paid">Not Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          {cycle.notes && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
              <p className="text-sm whitespace-pre-wrap">{cycle.notes}</p>
            </div>
          )}

          {/* View program button */}
          {cycle.assigned_program_id && (
            <Link to={`/programs/${cycle.assigned_program_id}`}>
              <Button variant="outline" size="sm" className="gap-2">
                <ExternalLink className="w-3.5 h-3.5" />
                View Program Table
              </Button>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium text-sm mt-0.5">{value ?? 'â€”'}</p>
    </div>
  );
}

// â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function ClientPrograms({ client, clientId }) {
  const queryClient = useQueryClient();

  const [showNewCycle, setShowNewCycle] = useState(false);
  const [newCycle, setNewCycle] = useState({ program_name: '', start_date: '', duration_weeks: '', payment_status: 'not_paid', notes: '' });
  const [assigningProgram, setAssigningProgram] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [dietPlanId, setDietPlanId] = useState(client?.assigned_diet_plan_id || '');
  const [durationWarning, setDurationWarning] = useState('');

  // Data queries
  const { data: programCycles = [] } = useQuery({
    queryKey: ['program-cycles', clientId],
    queryFn: () => api.entities.ProgramCycle.filter({ client_id: clientId }, '-start_date'),
    enabled: !!clientId,
  });

  const { data: allPrograms = [] } = useQuery({
    queryKey: ['all-programs'],
    queryFn: () => api.entities.TrainingProgram.list(),
  });

  const { data: dietPlans = [] } = useQuery({
    queryKey: ['all-diet-plans'],
    queryFn: () => api.entities.DietPlan.list(),
  });

  // Fetch exercise counts for assigned programs
  const assignedProgramIds = programCycles.map(c => c.assigned_program_id).filter(Boolean);
  const { data: allExercises = [] } = useQuery({
    queryKey: ['exercises-for-programs', assignedProgramIds.join(',')],
    queryFn: () => api.entities.ProgramExercise.list(),
    enabled: assignedProgramIds.length > 0,
  });

  const templates = allPrograms.filter(p => !p.assigned_client_id);
  const clientOwnedPrograms = allPrograms.filter(p => p.assigned_client_id === clientId);

  // Map program id â†’ program obj for quick lookup
  const programById = Object.fromEntries(allPrograms.map(p => [p.id, p]));
  // Map program_id â†’ exercise count
  const exerciseCountByProgramId = {};
  allExercises.forEach(ex => {
    if (!exerciseCountByProgramId[ex.program_id]) exerciseCountByProgramId[ex.program_id] = 0;
    exerciseCountByProgramId[ex.program_id]++;
  });

  const activeCycles = programCycles.filter(c => {
    const s = computeStatus(c, client?.is_blocked);
    return s === 'active' || s === 'pending';
  });
  const completedCycles = programCycles.filter(c => {
    const s = computeStatus(c, client?.is_blocked);
    return s !== 'active' && s !== 'pending';
  });

  // New cycle preview
  const newCycleStart = newCycle.start_date || todayISO();
  const newCycleWeeks = Number(newCycle.duration_weeks) || 4;
  const newCycleEnd = calcEndDate(newCycleStart, newCycleWeeks);
  const newCyclePaymentDue = calcPaymentDueDate(newCycleStart);

  // Handle duration change with warning
  const handleDurationChange = (val) => {
    const weeks = Number(val);
    setNewCycle(p => ({ ...p, duration_weeks: val }));
    if (selectedTemplateId) {
      const tmpl = templates.find(t => t.id === selectedTemplateId);
      if (tmpl && tmpl.num_weeks && weeks && weeks !== tmpl.num_weeks) {
        setDurationWarning(`âš ï¸ The selected program contains ${tmpl.num_weeks} weeks, but you entered ${weeks}.`);
      } else {
        setDurationWarning('');
      }
    }
  };

  const handleTemplateChange = (id) => {
    setSelectedTemplateId(id);
    const tmpl = templates.find(t => t.id === id);
    if (tmpl?.num_weeks) {
      setNewCycle(p => ({ ...p, duration_weeks: tmpl.num_weeks }));
      setDurationWarning('');
    }
  };

  // Mutations
  const updateCyclePayment = useMutation({
    mutationFn: async ({ cycleId, payment_status }) => {
      await api.entities.ProgramCycle.update(cycleId, { payment_status });
      const cycle = programCycles.find(c => c.id === cycleId);
      if (cycle?.status === 'active') {
        await api.entities.User.update(clientId, { payment_status });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['program-cycles', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      toast.success('Payment status updated');
    },
  });

  const addCycle = useMutation({
    mutationFn: async () => {
      const resolvedStart = newCycle.start_date || todayISO();
      const weeks = Number(newCycle.duration_weeks) || 4;
      const endDate = calcEndDate(resolvedStart, weeks);
      const paymentDue = calcPaymentDueDate(resolvedStart);

      // Mark previous active cycles as completed
      const prevActive = programCycles.filter(c => computeStatus(c, client?.is_blocked) === 'active');
      await Promise.all(prevActive.map(c => api.entities.ProgramCycle.update(c.id, { status: 'completed' })));

      // Sync user record dates
      await api.entities.User.update(clientId, {
        program_start_date: resolvedStart,
        program_end_date: endDate,
        program_duration_weeks: weeks,
        payment_due_date: paymentDue,
        payment_status: newCycle.payment_status || 'not_paid',
        is_blocked: false,
      });

      // Deep-copy program if template selected
      let programCopyId = null;
      if (selectedTemplateId) {
        const [templateArr, exercises] = await Promise.all([
          api.entities.TrainingProgram.filter({ id: selectedTemplateId }),
          api.entities.ProgramExercise.filter({ program_id: selectedTemplateId }),
        ]);
        const template = templateArr[0];
        const clientName = client?.full_name || client?.email?.split('@')[0] || 'Client';
        const copy = await api.entities.TrainingProgram.create({
          name: `${clientName} â€” ${newCycle.program_name || template.name}`,
          description: template.description,
          num_weeks: weeks,
          num_days_per_week: template.num_days_per_week,
          admin_notes: template.admin_notes,
          assigned_client_id: clientId,
        });
        if (exercises.length > 0) {
          await Promise.all(exercises.map(ex => {
            const { id, created_date, updated_date, created_by, program_id, ...rest } = ex;
            return api.entities.ProgramExercise.create({ ...rest, program_id: copy.id, completed: false });
          }));
        }
        programCopyId = copy.id;
        // Update the client's assigned program
        await api.entities.User.update(clientId, { assigned_program_id: copy.id });
      }

      return api.entities.ProgramCycle.create({
        client_id: clientId,
        program_name: newCycle.program_name,
        start_date: resolvedStart,
        end_date: endDate,
        duration_weeks: weeks,
        payment_due_date: paymentDue,
        payment_status: newCycle.payment_status || 'not_paid',
        status: 'active',
        assigned_program_id: programCopyId || undefined,
        notes: newCycle.notes || undefined,
        payment_reminder_sent: false,
        renewal_reminder_sent: false,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['program-cycles', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      queryClient.invalidateQueries({ queryKey: ['all-programs'] });
      setNewCycle({ program_name: '', start_date: '', duration_weeks: '', payment_status: 'not_paid', notes: '' });
      setSelectedTemplateId('');
      setDurationWarning('');
      setShowNewCycle(false);
      toast.success('New program cycle created!');
    },
  });

  const saveDietPlan = useMutation({
    mutationFn: () => api.entities.User.update(clientId, { assigned_diet_plan_id: dietPlanId || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      toast.success('Diet plan saved');
    },
  });

  return (
    <div className="space-y-6">
      {/* â”€â”€ Header â”€â”€ */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Client Programs</h2>
          <p className="text-sm text-muted-foreground">{programCycles.length} total cycles Â· {clientOwnedPrograms.length} program copies</p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setShowNewCycle(true)}>
          <Plus className="w-4 h-4" />
          New Cycle
        </Button>
      </div>

      {/* â”€â”€ Active / Pending Programs â”€â”€ */}
      {activeCycles.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            Current Programs
          </h3>
          {activeCycles.map(cycle => (
            <CycleCard
              key={cycle.id}
              cycle={cycle}
              program={programById[cycle.assigned_program_id]}
              exerciseCount={exerciseCountByProgramId[cycle.assigned_program_id]}
              isBlocked={client?.is_blocked}
              onUpdatePayment={updateCyclePayment.mutate}
              isPending={updateCyclePayment.isPending}
            />
          ))}
        </div>
      )}

      {/* â”€â”€ Completed / Expired Programs â”€â”€ */}
      {completedCycles.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Archive className="w-4 h-4" />
            Completed Programs
          </h3>
          {completedCycles.map(cycle => (
            <CycleCard
              key={cycle.id}
              cycle={cycle}
              program={programById[cycle.assigned_program_id]}
              exerciseCount={exerciseCountByProgramId[cycle.assigned_program_id]}
              isBlocked={false}
              onUpdatePayment={updateCyclePayment.mutate}
              isPending={updateCyclePayment.isPending}
            />
          ))}
        </div>
      )}

      {programCycles.length === 0 && (
        <div className="text-center py-16 text-muted-foreground border border-dashed rounded-xl">
          <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No program cycles yet</p>
          <p className="text-sm">Click "New Cycle" to create the first one.</p>
        </div>
      )}

      {/* â”€â”€ Diet Plan Assignment â”€â”€ */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><UtensilsCrossed className="w-4 h-4" />Diet Plan</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="flex-1">
            <Select value={dietPlanId} onValueChange={setDietPlanId}>
              <SelectTrigger><SelectValue placeholder="Select diet plan" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>None</SelectItem>
                {dietPlans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" onClick={() => saveDietPlan.mutate()} disabled={saveDietPlan.isPending} className="gap-2">
            {saveDietPlan.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </Button>
        </CardContent>
      </Card>

      {/* â”€â”€ New Cycle Dialog â”€â”€ */}
      <Dialog open={showNewCycle} onOpenChange={v => { setShowNewCycle(v); if (!v) { setDurationWarning(''); setSelectedTemplateId(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Program Cycle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Cycle Name <span className="text-muted-foreground font-normal text-xs">(e.g. Meso 1, Phase 2)</span></Label>
              <Input
                placeholder="Meso 3"
                value={newCycle.program_name}
                onChange={e => setNewCycle(p => ({ ...p, program_name: e.target.value }))}
              />
            </div>

            <div>
              <Label className="flex items-center gap-2"><Dumbbell className="w-3.5 h-3.5" />Training Program Template <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Select value={selectedTemplateId} onValueChange={handleTemplateChange}>
                <SelectTrigger><SelectValue placeholder="Select a template to copy" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>No template</SelectItem>
                  {templates.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.num_weeks}w)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplateId && (
                <p className="text-xs text-primary mt-1 flex items-center gap-1">
                  <Copy className="w-3 h-3" />
                  An independent copy will be created for this client.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={newCycle.start_date}
                  onChange={e => setNewCycle(p => ({ ...p, start_date: e.target.value }))}
                />
              </div>
              <div>
                <Label>Duration (weeks)</Label>
                <Input
                  type="number"
                  min={1}
                  value={newCycle.duration_weeks}
                  onChange={e => handleDurationChange(e.target.value)}
                  placeholder="Auto from template"
                />
                {durationWarning && (
                  <p className="text-xs text-orange-600 mt-1 flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    {durationWarning}
                  </p>
                )}
              </div>
            </div>

            <div>
              <Label>Payment Status</Label>
              <Select value={newCycle.payment_status} onValueChange={v => setNewCycle(p => ({ ...p, payment_status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="not_paid">Not Paid</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Notes <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Textarea rows={2} value={newCycle.notes} onChange={e => setNewCycle(p => ({ ...p, notes: e.target.value }))} />
            </div>

            {/* Preview */}
            {newCycle.duration_weeks && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Start:</span> <span className="font-semibold text-primary">{formatDate(newCycleStart)}</span></div>
                <div><span className="text-muted-foreground">End:</span> <span className="font-semibold text-primary">{formatDate(newCycleEnd)}</span></div>
                <div><span className="text-muted-foreground">Duration:</span> <span className="font-semibold">{newCycle.duration_weeks} weeks</span></div>
                <div><span className="text-muted-foreground">Payment Due:</span> <span className="font-semibold text-chart-4">{formatDate(newCyclePaymentDue)}</span></div>
              </div>
            )}

            <Button
              className="w-full gap-2"
              disabled={!newCycle.program_name || addCycle.isPending}
              onClick={() => addCycle.mutate()}
            >
              {addCycle.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {addCycle.isPending ? (selectedTemplateId ? 'Creating program copy...' : 'Creating...') : 'Create Cycle'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
