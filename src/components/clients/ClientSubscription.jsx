import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  CreditCard, Plus, Save, Loader2, AlertTriangle,
  Calendar, TrendingUp, DollarSign, Clock, ShieldAlert, ArrowRight, Expand
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, calcEndDate, todayISO } from '@/lib/dateUtils';
import { differenceInDays, parseISO, isAfter, isBefore, addDays, format } from 'date-fns';

function computeSubscriptionStatus(sub) {
  if (!sub) return null;
  if (sub.status === 'cancelled') return 'cancelled';
  if (!sub.start_date) return 'pending';
  const today = new Date();
  const end = sub.end_date ? parseISO(sub.end_date) : null;
  if (end && isBefore(end, today)) return 'expired';
  if (isAfter(parseISO(sub.start_date), today)) return 'pending';
  return 'active';
}

function computePaidWeeks(sub) {
  if (!sub || !sub.total_fee || !sub.duration_weeks) return sub?.duration_weeks || 0;
  const ratio = Math.min(1, (sub.amount_paid || 0) / sub.total_fee);
  return Math.floor(ratio * sub.duration_weeks);
}

function computePaidUntilDate(sub) {
  if (!sub?.start_date) return null;
  const paidWeeks = computePaidWeeks(sub);
  const start = parseISO(sub.start_date);
  return addDays(start, paidWeeks * 7);
}

const STATUS_CONFIG = {
  active:    { label: 'Active',    class: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  expired:   { label: 'Expired',   class: 'bg-orange-500/15 text-orange-700 dark:text-orange-400' },
  cancelled: { label: 'Cancelled', class: 'bg-destructive/15 text-destructive' },
  pending:   { label: 'Pending',   class: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
};

function StatPill({ icon: Icon, label, value, highlight }) {
  return (
    <div className={`rounded-xl p-3 flex flex-col gap-1 ${highlight ? 'bg-primary/8 border border-primary/20' : 'bg-muted/50'}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className={`font-bold text-sm ${highlight ? 'text-primary' : ''}`}>{value}</p>
    </div>
  );
}

function checkOverlap(subscriptions, startDate, durationWeeks, excludeId = null) {
  const newStart = parseISO(startDate);
  const newEnd = addDays(newStart, durationWeeks * 7);
  return subscriptions.filter(s => {
    if (excludeId && s.id === excludeId) return false;
    const st = computeSubscriptionStatus(s);
    if (st === 'cancelled' || st === 'expired') return false;
    const sStart = parseISO(s.start_date);
    const sEnd = s.end_date ? parseISO(s.end_date) : addDays(sStart, (s.duration_weeks || 0) * 7);
    return isBefore(newStart, sEnd) && isAfter(newEnd, sStart);
  });
}

export default function ClientSubscriptionPanel({ client, clientId }) {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [showExtend, setShowExtend] = useState(false);
  const [extendWeeks, setExtendWeeks] = useState(4);
  const [overlapError, setOverlapError] = useState(null);
  const [form, setForm] = useState({
    start_date: todayISO(),
    duration_weeks: 12,
    total_fee: '',
    amount_paid: '',
    notes: '',
  });

  const { data: subscriptions = [], isLoading } = useQuery({
    queryKey: ['subscriptions', clientId],
    queryFn: () => api.entities.ClientSubscription.filter({ client_id: clientId }, '-start_date'),
    enabled: !!clientId,
  });

  const activeSub = subscriptions.find(s => computeSubscriptionStatus(s) === 'active')
    || subscriptions[0];

  const endDate = form.start_date && form.duration_weeks
    ? calcEndDate(form.start_date, Number(form.duration_weeks))
    : '';

  // Suggested next start date (day after active sub ends)
  const suggestedStartDate = activeSub?.end_date
    ? format(addDays(parseISO(activeSub.end_date), 1), 'yyyy-MM-dd')
    : todayISO();

  // Live overlap check
  const overlappingSubs = form.start_date && form.duration_weeks
    ? checkOverlap(subscriptions, form.start_date, Number(form.duration_weeks))
    : [];
  const hasOverlap = overlappingSubs.length > 0;

  // Derived financials for active sub
  const remainingBalance = activeSub ? Math.max(0, (activeSub.total_fee || 0) - (activeSub.amount_paid || 0)) : 0;
  const paidWeeks = activeSub ? computePaidWeeks(activeSub) : 0;
  const unpaidWeeks = activeSub ? Math.max(0, (activeSub.duration_weeks || 0) - paidWeeks) : 0;
  const paidUntil = activeSub ? computePaidUntilDate(activeSub) : null;
  const daysUntilEnd = activeSub?.end_date ? differenceInDays(parseISO(activeSub.end_date), new Date()) : null;
  const subStatus = activeSub ? computeSubscriptionStatus(activeSub) : null;
  const statusCfg = subStatus ? STATUS_CONFIG[subStatus] : null;

  const extendSub = useMutation({
    mutationFn: async (weeksToAdd) => {
      if (!activeSub) return;
      const newWeeks = (activeSub.duration_weeks || 0) + weeksToAdd;
      const newEnd = calcEndDate(activeSub.start_date, newWeeks);
      await api.entities.ClientSubscription.update(activeSub.id, {
        duration_weeks: newWeeks,
        end_date: newEnd,
      });
      await api.entities.User.update(clientId, {
        program_end_date: newEnd,
        program_duration_weeks: newWeeks,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      setShowExtend(false);
      setExtendWeeks(4);
      toast.success('Subscription extended!');
    },
  });

  const createSub = useMutation({
    mutationFn: async () => {
      // Block if overlap detected
      const overlaps = checkOverlap(subscriptions, form.start_date, Number(form.duration_weeks));
      if (overlaps.length > 0) {
        throw new Error('OVERLAP');
      }
      const end = calcEndDate(form.start_date, Number(form.duration_weeks));
      // Mark previous active subs as expired
      const prevActive = subscriptions.filter(s => computeSubscriptionStatus(s) === 'active');
      await Promise.all(prevActive.map(s => api.entities.ClientSubscription.update(s.id, { status: 'expired' })));

      const newSub = await api.entities.ClientSubscription.create({
        client_id: clientId,
        client_name: client?.full_name || '',
        client_email: client?.email || '',
        start_date: form.start_date,
        end_date: end,
        duration_weeks: Number(form.duration_weeks),
        total_fee: form.total_fee ? Number(form.total_fee) : undefined,
        amount_paid: form.amount_paid ? Number(form.amount_paid) : 0,
        status: 'active',
        notes: form.notes || undefined,
        payment_reminder_sent: false,
        renewal_reminder_sent: false,
      });

      // Sync key fields to User record for compatibility
      await api.entities.User.update(clientId, {
        program_start_date: form.start_date,
        program_end_date: end,
        program_duration_weeks: Number(form.duration_weeks),
        is_blocked: false,
      });

      return newSub;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      setShowNew(false);
      setOverlapError(null);
      setForm({ start_date: todayISO(), duration_weeks: 12, total_fee: '', amount_paid: '', notes: '' });
      toast.success('Subscription created!');
    },
    onError: (err) => {
      if (err.message === 'OVERLAP') {
        setOverlapError('Cannot create subscription: another active subscription already exists during this date range.');
      }
    },
  });

  const updatePayment = useMutation({
    mutationFn: async ({ id, amount_paid }) => {
      await api.entities.ClientSubscription.update(id, { amount_paid });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions', clientId] });
      toast.success('Payment updated');
    },
  });

  const toggleBlock = useMutation({
    mutationFn: (blocked) => api.entities.User.update(clientId, { is_blocked: blocked }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      toast.success(client?.is_blocked ? 'Access restored' : 'Account blocked');
    },
  });

  const [editingPayment, setEditingPayment] = useState(null);

  return (
    <div className="space-y-6">

      {/* â”€â”€ Active Subscription Overview â”€â”€ */}
      {activeSub ? (
        <Card className={`border-0 shadow-sm ${subStatus === 'active' ? 'ring-1 ring-primary/20' : ''}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="w-4 h-4" />
                Current Subscription
              </CardTitle>
              <div className="flex items-center gap-2">
                {statusCfg && (
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusCfg.class}`}>
                    {statusCfg.label}
                  </span>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatPill icon={Calendar} label="Start Date" value={formatDate(activeSub.start_date)} />
              <StatPill icon={Calendar} label="End Date" value={formatDate(activeSub.end_date)} highlight={daysUntilEnd !== null && daysUntilEnd <= 14 && subStatus === 'active'} />
              <StatPill icon={Clock} label="Duration" value={`${activeSub.duration_weeks} weeks`} />
              <StatPill icon={TrendingUp} label="Days Left" value={daysUntilEnd !== null ? `${Math.max(0, daysUntilEnd)} days` : 'â€”'} highlight={daysUntilEnd !== null && daysUntilEnd <= 7} />
            </div>

            {/* Financial breakdown */}
            {activeSub.total_fee > 0 && (
              <div className="rounded-xl border p-4 space-y-3">
                <p className="text-sm font-semibold flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" />Payment Breakdown</p>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground">Total Fee</p>
                    <p className="font-bold text-lg">${activeSub.total_fee}</p>
                  </div>
                  <div className="rounded-lg bg-green-500/10 p-3">
                    <p className="text-xs text-muted-foreground">Paid</p>
                    <p className="font-bold text-lg text-green-700 dark:text-green-400">${activeSub.amount_paid || 0}</p>
                  </div>
                  <div className={`rounded-lg p-3 ${remainingBalance > 0 ? 'bg-orange-500/10' : 'bg-muted/50'}`}>
                    <p className="text-xs text-muted-foreground">Remaining</p>
                    <p className={`font-bold text-lg ${remainingBalance > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground'}`}>
                      ${remainingBalance}
                    </p>
                  </div>
                </div>

                {/* Paid coverage */}
                {activeSub.total_fee > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Paid coverage: {paidWeeks} of {activeSub.duration_weeks} weeks</span>
                      {paidUntil && <span>Covered until: {formatDate(paidUntil.toISOString().split('T')[0])}</span>}
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-green-500 transition-all"
                        style={{ width: `${activeSub.duration_weeks > 0 ? (paidWeeks / activeSub.duration_weeks) * 100 : 0}%` }}
                      />
                    </div>
                    {unpaidWeeks > 0 && (
                      <p className="text-xs text-orange-600 dark:text-orange-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {unpaidWeeks} weeks unpaid â€” warnings will begin before week {paidWeeks + 1}
                      </p>
                    )}
                  </div>
                )}

                {/* Quick payment update */}
                {editingPayment === activeSub.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      className="h-8 text-sm w-32"
                      defaultValue={activeSub.amount_paid || 0}
                      id="quick-paid-input"
                    />
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={() => {
                        const val = Number(document.getElementById('quick-paid-input').value);
                        updatePayment.mutate({ id: activeSub.id, amount_paid: val });
                        setEditingPayment(null);
                      }}
                    >
                      <Save className="w-3 h-3 mr-1" />Save
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingPayment(null)}>Cancel</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditingPayment(activeSub.id)}>
                    Update Amount Paid
                  </Button>
                )}
              </div>
            )}

            {/* Notes */}
            {activeSub.notes && (
              <p className="text-sm text-muted-foreground italic border-l-2 border-border pl-3">{activeSub.notes}</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-12 border border-dashed rounded-xl text-muted-foreground">
          <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No subscription yet</p>
          <p className="text-sm mt-1">Create a subscription to manage access and payments.</p>
        </div>
      )}

      {/* â”€â”€ Access Control â”€â”€ */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" />Access Control
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40">
            <div>
              <p className="font-medium text-sm">Block Account Access</p>
              <p className="text-xs text-muted-foreground">Prevents client from accessing their program and content.</p>
            </div>
            <Switch
              checked={client?.is_blocked || false}
              onCheckedChange={(v) => toggleBlock.mutate(v)}
            />
          </div>
          {client?.is_blocked && (
            <p className="text-xs text-destructive mt-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />This client is currently blocked from the platform.
            </p>
          )}
        </CardContent>
      </Card>

      {/* â”€â”€ History â”€â”€ */}
      {subscriptions.length > 1 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">Subscription History</p>
          {subscriptions.slice(1).map(sub => {
            const st = computeSubscriptionStatus(sub);
            const cfg = STATUS_CONFIG[st] || STATUS_CONFIG.expired;
            return (
              <div key={sub.id} className="flex items-center justify-between p-3 rounded-xl border bg-card text-sm">
                <div>
                  <p className="font-medium">{formatDate(sub.start_date)} â†’ {formatDate(sub.end_date)}</p>
                  <p className="text-xs text-muted-foreground">{sub.duration_weeks}w Â· ${sub.total_fee || 0} total Â· ${sub.amount_paid || 0} paid</p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.class}`}>{cfg.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* â”€â”€ Action Buttons â”€â”€ */}
      <div className="flex gap-2 flex-wrap">
        {activeSub && computeSubscriptionStatus(activeSub) === 'active' && (
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setShowExtend(true)}>
            <Expand className="w-4 h-4" />Extend Subscription
          </Button>
        )}
        <Button size="sm" className="gap-2" onClick={() => { setOverlapError(null); setForm({ start_date: suggestedStartDate, duration_weeks: 12, total_fee: '', amount_paid: '', notes: '' }); setShowNew(true); }}>
          <Plus className="w-4 h-4" />
          {activeSub ? 'New Subscription' : 'Create Subscription'}
        </Button>
      </div>

      {/* â”€â”€ Extend Subscription Dialog â”€â”€ */}
      <Dialog open={showExtend} onOpenChange={setShowExtend}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Expand className="w-4 h-4 text-primary" />Extend Subscription</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Current: <strong>{activeSub?.duration_weeks} weeks</strong> Â· Ends: <strong>{formatDate(activeSub?.end_date)}</strong>
            </p>
            <div>
              <label className="text-sm font-medium">Weeks to add</label>
              <div className="flex items-center gap-2 mt-1.5">
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setExtendWeeks(w => Math.max(1, w - 1))}>âˆ’</Button>
                <input
                  type="number" min={1}
                  value={extendWeeks}
                  onChange={e => setExtendWeeks(Math.max(1, Number(e.target.value)))}
                  className="w-20 h-9 border rounded-md text-center text-sm bg-transparent"
                />
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setExtendWeeks(w => w + 1)}>+</Button>
              </div>
            </div>
            {activeSub && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">New total:</span>
                  <span className="font-bold text-primary">{(activeSub.duration_weeks || 0) + extendWeeks} weeks</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">New end date:</span>
                  <span className="font-bold text-primary">{formatDate(calcEndDate(activeSub.start_date, (activeSub.duration_weeks || 0) + extendWeeks))}</span>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowExtend(false)}>Cancel</Button>
              <Button className="flex-1 gap-2" onClick={() => extendSub.mutate(extendWeeks)} disabled={extendSub.isPending}>
                {extendSub.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                Extend
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* â”€â”€ New Subscription Dialog â”€â”€ */}
      <Dialog open={showNew} onOpenChange={v => { setShowNew(v); if (!v) setOverlapError(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Subscription</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} />
              </div>
              <div>
                <Label>Duration (weeks)</Label>
                <Input type="number" min={1} value={form.duration_weeks} onChange={e => setForm(p => ({ ...p, duration_weeks: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Total Fee ($)</Label>
                <Input type="number" min={0} step={0.01} placeholder="e.g. 180" value={form.total_fee} onChange={e => setForm(p => ({ ...p, total_fee: e.target.value }))} />
              </div>
              <div>
                <Label>Amount Paid ($)</Label>
                <Input type="number" min={0} step={0.01} placeholder="e.g. 120" value={form.amount_paid} onChange={e => setForm(p => ({ ...p, amount_paid: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>

            {form.start_date && form.duration_weeks && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Access Start:</span>
                  <span className="font-semibold text-primary">{formatDate(form.start_date)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Access End:</span>
                  <span className="font-semibold text-primary">{formatDate(endDate)}</span>
                </div>
                {form.total_fee && form.amount_paid && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Remaining Balance:</span>
                      <span className="font-semibold text-orange-600">${Math.max(0, Number(form.total_fee) - Number(form.amount_paid))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Paid weeks covered:</span>
                      <span className="font-semibold">{Math.floor((Number(form.amount_paid) / Number(form.total_fee)) * Number(form.duration_weeks))} / {form.duration_weeks} weeks</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Overlap warning */}
            {hasOverlap && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 space-y-2">
                <p className="text-sm text-destructive font-medium flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  Cannot create: overlaps an existing active subscription
                </p>
                <p className="text-xs text-muted-foreground">
                  Active sub: {formatDate(overlappingSubs[0]?.start_date)} â†’ {formatDate(overlappingSubs[0]?.end_date)}
                </p>
                <div className="flex gap-2 flex-wrap">
                  {activeSub && computeSubscriptionStatus(activeSub) === 'active' && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setShowNew(false); setShowExtend(true); }}>
                      <Expand className="w-3 h-3" />Extend instead
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setForm(p => ({ ...p, start_date: suggestedStartDate }))}>
                    <ArrowRight className="w-3 h-3" />Use next available date ({formatDate(suggestedStartDate)})
                  </Button>
                </div>
              </div>
            )}
            {overlapError && !hasOverlap && (
              <p className="text-sm text-destructive flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />{overlapError}
              </p>
            )}

            <Button
              className="w-full gap-2"
              disabled={!form.start_date || !form.duration_weeks || createSub.isPending || hasOverlap}
              onClick={() => createSub.mutate()}
            >
              {createSub.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {createSub.isPending ? 'Creating...' : 'Create Subscription'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
