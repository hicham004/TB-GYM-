import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FlaskConical, CreditCard, AlertTriangle, ShieldAlert,
  Bell, CheckCircle2, Clock, TrendingUp, Play, SkipForward,
  CalendarClock, Ban, DollarSign
} from 'lucide-react';
import { addDays, differenceInDays, parseISO, isAfter, isBefore, format } from 'date-fns';

function calcEndDate(start, weeks) {
  const d = addDays(parseISO(start), weeks * 7);
  return d.toISOString().split('T')[0];
}

function computeStatus(simDate, startDate, endDate, isBlocked) {
  if (isBlocked) return 'blocked';
  const sim = parseISO(simDate);
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (isBefore(sim, start)) return 'pending';
  if (isAfter(sim, end)) return 'expired';
  return 'active';
}

function computePaidWeeks(durationWeeks, totalFee, amountPaid) {
  if (!totalFee) return durationWeeks;
  const ratio = Math.min(1, amountPaid / totalFee);
  return Math.floor(ratio * durationWeeks);
}

function SimResult({ label, value, type = 'default' }) {
  const colors = {
    default: 'bg-muted/50',
    success: 'bg-green-500/10 border border-green-500/20',
    warning: 'bg-orange-500/10 border border-orange-500/20',
    danger: 'bg-destructive/10 border border-destructive/20',
    info: 'bg-primary/10 border border-primary/20',
  };
  return (
    <div className={`rounded-lg p-3 ${colors[type]}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-semibold text-sm mt-0.5 ${type === 'danger' ? 'text-destructive' : type === 'warning' ? 'text-orange-600 dark:text-orange-400' : type === 'success' ? 'text-green-700 dark:text-green-400' : type === 'info' ? 'text-primary' : ''}`}>
        {value}
      </p>
    </div>
  );
}

export default function SubscriptionSimulator() {
  const today = new Date().toISOString().split('T')[0];

  const [config, setConfig] = useState({
    startDate: today,
    durationWeeks: 12,
    totalFee: 180,
    amountPaid: 120,
  });

  const [simDate, setSimDate] = useState(today);
  const [isBlocked, setIsBlocked] = useState(false);
  const [log, setLog] = useState([]);

  const endDate = config.startDate && config.durationWeeks
    ? calcEndDate(config.startDate, Number(config.durationWeeks))
    : '';

  const paidWeeks = computePaidWeeks(Number(config.durationWeeks), Number(config.totalFee), Number(config.amountPaid));
  const unpaidWeeks = Math.max(0, Number(config.durationWeeks) - paidWeeks);
  const paidUntilDate = config.startDate ? addDays(parseISO(config.startDate), paidWeeks * 7) : null;
  const remainingBalance = Math.max(0, Number(config.totalFee) - Number(config.amountPaid));

  const status = endDate ? computeStatus(simDate, config.startDate, endDate, isBlocked) : 'pending';
  const daysToEnd = endDate ? differenceInDays(parseISO(endDate), parseISO(simDate)) : null;
  const daysToPaidEnd = paidUntilDate ? differenceInDays(paidUntilDate, parseISO(simDate)) : null;

  // Logic evaluations
  const shouldSendRenewalReminder = daysToEnd !== null && daysToEnd <= 2 && daysToEnd >= 0 && status === 'active';
  const shouldSendPaymentWarning = daysToPaidEnd !== null && daysToPaidEnd <= 3 && daysToPaidEnd >= 0 && unpaidWeeks > 0;
  const shouldBlock = status === 'expired' || (daysToPaidEnd !== null && daysToPaidEnd < 0 && unpaidWeeks > 0);
  const hasOutstandingBalance = remainingBalance > 0;

  const addLog = (msg, type = 'info') => {
    setLog(prev => [{
      id: Date.now(),
      msg,
      type,
      date: simDate,
      time: new Date().toLocaleTimeString()
    }, ...prev].slice(0, 20));
  };

  const simulate = (newDate, label) => {
    const prevDate = simDate;
    setSimDate(newDate);
    addLog(`${label}: Simulated date â†’ ${format(parseISO(newDate), 'dd MMM yyyy')}`, 'info');

    // Check what events would fire
    const newDaysToEnd = endDate ? differenceInDays(parseISO(endDate), parseISO(newDate)) : null;
    const newDaysToPaid = paidUntilDate ? differenceInDays(paidUntilDate, parseISO(newDate)) : null;
    const newStatus = endDate ? computeStatus(newDate, config.startDate, endDate, isBlocked) : 'pending';

    if (newDaysToEnd !== null && newDaysToEnd <= 2 && newDaysToEnd >= 0) {
      addLog(`ðŸ“§ RENEWAL REMINDER would fire â€” ${newDaysToEnd} day(s) until subscription ends`, 'warning');
    }
    if (newDaysToPaid !== null && newDaysToPaid <= 3 && newDaysToPaid >= 0 && unpaidWeeks > 0) {
      addLog(`ðŸ’³ PAYMENT WARNING would fire â€” ${newDaysToPaid} day(s) until unpaid weeks begin`, 'warning');
    }
    if (newStatus === 'expired') {
      addLog(`ðŸš« SUBSCRIPTION EXPIRED â€” account would be blocked`, 'danger');
    }
    if (newDaysToPaid !== null && newDaysToPaid < 0 && unpaidWeeks > 0) {
      addLog(`âš ï¸ CLIENT IN UNPAID PERIOD â€” ${Math.abs(newDaysToPaid)} days into unpaid weeks`, 'danger');
    }
  };

  const LOG_COLORS = {
    info: 'bg-primary/8 border-primary/20 text-primary',
    warning: 'bg-orange-500/10 border-orange-500/20 text-orange-700 dark:text-orange-400',
    danger: 'bg-destructive/10 border-destructive/20 text-destructive',
    success: 'bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-400',
  };

  const STATUS_DISPLAY = {
    active:   { label: 'Active',   class: 'bg-green-500/15 text-green-700 dark:text-green-400' },
    expired:  { label: 'Expired',  class: 'bg-destructive/15 text-destructive' },
    blocked:  { label: 'Blocked',  class: 'bg-destructive/15 text-destructive' },
    pending:  { label: 'Pending',  class: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  };

  const set = (k, v) => setConfig(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FlaskConical className="w-6 h-6 text-primary" />
          Subscription Simulator
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Test reminders, payment blocks, and expiration logic without waiting in real time.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* â”€â”€ Config â”€â”€ */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><CreditCard className="w-4 h-4" />Subscription Config</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Start Date</Label>
                  <Input type="date" value={config.startDate} onChange={e => set('startDate', e.target.value)} />
                </div>
                <div>
                  <Label>Duration (weeks)</Label>
                  <Input type="number" min={1} value={config.durationWeeks} onChange={e => set('durationWeeks', e.target.value)} />
                </div>
                <div>
                  <Label>Total Fee ($)</Label>
                  <Input type="number" min={0} value={config.totalFee} onChange={e => set('totalFee', e.target.value)} />
                </div>
                <div>
                  <Label>Amount Paid ($)</Label>
                  <Input type="number" min={0} value={config.amountPaid} onChange={e => set('amountPaid', e.target.value)} />
                </div>
              </div>
              {endDate && (
                <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Access End:</span><span className="font-semibold">{format(parseISO(endDate), 'dd MMM yyyy')}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Paid weeks:</span><span className="font-semibold">{paidWeeks} / {config.durationWeeks}</span></div>
                  {paidUntilDate && <div className="flex justify-between"><span className="text-muted-foreground">Paid until:</span><span className="font-semibold">{format(paidUntilDate, 'dd MMM yyyy')}</span></div>}
                  <div className="flex justify-between"><span className="text-muted-foreground">Remaining:</span><span className="font-semibold text-orange-600">${remainingBalance}</span></div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="w-4 h-4" />Simulate Date</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Current Simulated Date</Label>
                <Input type="date" value={simDate} onChange={e => setSimDate(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => simulate(addDays(parseISO(simDate), 1).toISOString().split('T')[0], '+1 Day')}>
                  <Play className="w-3 h-3" />Day +1
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => simulate(addDays(parseISO(simDate), 7).toISOString().split('T')[0], '+7 Days')}>
                  <SkipForward className="w-3 h-3" />Day +7
                </Button>
                {endDate && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => simulate(addDays(parseISO(endDate), -2).toISOString().split('T')[0], '2 days before end')}>
                    <Bell className="w-3 h-3" />2d Before End
                  </Button>
                )}
                {endDate && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => simulate(addDays(parseISO(endDate), 1).toISOString().split('T')[0], 'Day after expiry')}>
                    <Ban className="w-3 h-3" />Simulate Expiry
                  </Button>
                )}
                {paidUntilDate && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => simulate(addDays(paidUntilDate, -3).toISOString().split('T')[0], '3 days before unpaid period')}>
                    <AlertTriangle className="w-3 h-3" />Unpaid Warning
                  </Button>
                )}
                {paidUntilDate && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => simulate(addDays(paidUntilDate, 1).toISOString().split('T')[0], 'Enter unpaid period')}>
                    <DollarSign className="w-3 h-3" />Unpaid Period
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* â”€â”€ Live Status â”€â”€ */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4" />Live Status</CardTitle>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_DISPLAY[status]?.class}`}>
                  {STATUS_DISPLAY[status]?.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Simulated date: <strong>{format(parseISO(simDate), 'dd MMM yyyy')}</strong></p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <SimResult label="Days Until End" value={daysToEnd !== null ? `${Math.max(0, daysToEnd)} days` : 'â€”'} type={daysToEnd !== null && daysToEnd <= 7 ? 'warning' : 'default'} />
                <SimResult label="Days Until Unpaid Period" value={daysToPaidEnd !== null && unpaidWeeks > 0 ? `${Math.max(0, daysToPaidEnd)} days` : 'N/A'} type={daysToPaidEnd !== null && daysToPaidEnd <= 3 && unpaidWeeks > 0 ? 'warning' : 'default'} />
                <SimResult label="Subscription Status" value={STATUS_DISPLAY[status]?.label} type={status === 'active' ? 'success' : status === 'expired' ? 'danger' : 'default'} />
                <SimResult label="Outstanding Balance" value={`$${remainingBalance}`} type={remainingBalance > 0 ? 'warning' : 'success'} />
              </div>

              <div className="space-y-2 pt-2 border-t">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions That Would Fire</p>
                {shouldSendRenewalReminder && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-xs text-orange-700 dark:text-orange-400">
                    <Bell className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Renewal reminder email + notification would fire</span>
                  </div>
                )}
                {shouldSendPaymentWarning && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-xs text-orange-700 dark:text-orange-400">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Payment warning email + notification would fire</span>
                  </div>
                )}
                {shouldBlock && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                    <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Account would be blocked</span>
                  </div>
                )}
                {!shouldSendRenewalReminder && !shouldSendPaymentWarning && !shouldBlock && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-700 dark:text-green-400">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>No actions â€” subscription is healthy on this date</span>
                  </div>
                )}
              </div>
              <div className="space-y-1.5 pt-2 border-t">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Blocking Logic</p>
                <div className="text-xs space-y-1 text-muted-foreground">
                  <p className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-green-600" />Weeks 1â€“{paidWeeks}: Full access, no warnings</p>
                  {unpaidWeeks > 0 && <p className="flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 text-orange-500" />3 days before week {paidWeeks + 1}: Payment warning sent</p>}
                  {unpaidWeeks > 0 && <p className="flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 text-orange-500" />Week {paidWeeks + 1} onward: Warnings (not blocked yet)</p>}
                  <p className="flex items-center gap-1.5"><ShieldAlert className="w-3 h-3 text-destructive" />2 days before end: Renewal reminder sent</p>
                  <p className="flex items-center gap-1.5"><Ban className="w-3 h-3 text-destructive" />After end date: Account blocked</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Event Log */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" />Simulation Log</CardTitle>
            </CardHeader>
            <CardContent>
              {log.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Use the simulator buttons above to generate log entries.</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {log.map(entry => (
                    <div key={entry.id} className={`text-xs p-2 rounded border ${LOG_COLORS[entry.type] || LOG_COLORS.info}`}>
                      <span className="opacity-70 mr-2">{entry.time}</span>
                      {entry.msg}
                    </div>
                  ))}
                </div>
              )}
              {log.length > 0 && (
                <Button variant="ghost" size="sm" className="mt-2 text-xs h-7" onClick={() => setLog([])}>Clear Log</Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
