import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  Scale, TrendingDown, TrendingUp, Minus, Target, AlertTriangle, Trash2, Pencil, Save, X, ChevronDown, ChevronUp, BarChart2,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/dateUtils';
import { parseISO, differenceInDays, format } from 'date-fns';

// â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function avg(arr) {
  if (!arr.length) return null;
  return Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10;
}

function buildWeeks(logs, startDate) {
  if (!logs.length) return [];
  // Sort ascending
  const sorted = [...logs].sort((a, b) => (a.date > b.date ? 1 : -1));
  const anchor = startDate ? parseISO(startDate) : parseISO(sorted[0].date);

  // Assign each log to a week number (1-based)
  const logsWithWeek = sorted.map(log => {
    const dayDiff = differenceInDays(parseISO(log.date), anchor);
    const weekNum = Math.max(1, Math.floor(dayDiff / 7) + 1);
    return { ...log, weekNum, dayOfWeek: (dayDiff % 7) + 1 };
  });

  // Group by week
  const weekMap = {};
  logsWithWeek.forEach(log => {
    if (!weekMap[log.weekNum]) weekMap[log.weekNum] = [];
    weekMap[log.weekNum].push(log);
  });

  // Fill up to current week
  const maxWeek = Math.max(...Object.keys(weekMap).map(Number));
  const today = new Date();
  const currentWeekNum = Math.max(1, Math.floor(differenceInDays(today, anchor) / 7) + 1);
  const totalWeeks = Math.max(maxWeek, currentWeekNum);

  return Array.from({ length: totalWeeks }, (_, i) => ({
    weekNum: i + 1,
    logs: weekMap[i + 1] || [],
    average: avg((weekMap[i + 1] || []).map(l => l.weight_kg)),
  }));
}

function StatCard({ icon: Icon, label, value, sub, color = 'primary', highlight }) {
  const colorMap = {
    primary: 'bg-primary/10 text-primary',
    green: 'bg-green-500/10 text-green-600 dark:text-green-400',
    red: 'bg-red-500/10 text-red-600 dark:text-red-400',
    orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    muted: 'bg-muted text-muted-foreground',
  };
  return (
    <Card className={`border-0 shadow-sm ${highlight ? 'ring-1 ring-primary/30' : ''}`}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${colorMap[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground leading-none mb-1">{label}</p>
          <p className="text-xl font-bold leading-none">{value ?? 'â€”'}</p>
          {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// â”€â”€â”€ main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function BodyWeightTracking({ clientId, isAdmin = false, client = null }) {
  const queryClient = useQueryClient();
  const [expandedWeeks, setExpandedWeeks] = useState({});
  const [newWeights, setNewWeights] = useState({}); // weekNum_day -> value
  const [newNotes, setNewNotes] = useState({});
  const [editingLog, setEditingLog] = useState(null); // { id, weight_kg, note }
  const [editVal, setEditVal] = useState('');
  const [editNote, setEditNote] = useState('');
  const [showGraph, setShowGraph] = useState(true);
  const [targetWeight, setTargetWeight] = useState(client?.target_weight_kg || '');
  const [editingTarget, setEditingTarget] = useState(false);

  const { data: weightLogs = [] } = useQuery({
    queryKey: ['weight-logs', clientId],
    queryFn: () => api.entities.WeightLog.filter({ client_id: clientId }, 'date'),
    enabled: !!clientId,
  });

  const addLog = useMutation({
    mutationFn: (data) => api.entities.WeightLog.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weight-logs', clientId] });
      toast.success('Weight logged');
    },
  });

  const updateLog = useMutation({
    mutationFn: ({ id, data }) => api.entities.WeightLog.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weight-logs', clientId] });
      setEditingLog(null);
      toast.success('Entry updated');
    },
  });

  const deleteLog = useMutation({
    mutationFn: (id) => api.entities.WeightLog.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weight-logs', clientId] });
      toast.success('Entry deleted');
    },
  });

  const saveTarget = useMutation({
    mutationFn: (val) => api.entities.User.update(clientId, { target_weight_kg: val }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      setEditingTarget(false);
      toast.success('Target weight saved');
    },
  });

  // â”€â”€ derived data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const startDate = client?.account_start_date || client?.program_start_date || null;
  const weeks = useMemo(() => buildWeeks(weightLogs, startDate), [weightLogs, startDate]);

  const startingWeight = client?.starting_weight_kg || client?.weight_kg || null;
  const completedWeeks = weeks.filter(w => w.average !== null);
  const latestWeekAvg = completedWeeks.length ? completedWeeks[completedWeeks.length - 1].average : null;
  const firstWeekAvg = completedWeeks.length ? completedWeeks[0].average : startingWeight;
  const totalChange = latestWeekAvg && firstWeekAvg ? Math.round((latestWeekAvg - firstWeekAvg) * 10) / 10 : null;
  const weeklyRate = completedWeeks.length >= 2
    ? Math.round(((latestWeekAvg - completedWeeks[0].average) / (completedWeeks.length - 1)) * 10) / 10
    : null;

  const tgtW = parseFloat(client?.target_weight_kg || targetWeight) || null;
  const goalProgress = tgtW && startingWeight && latestWeekAvg !== null
    ? Math.min(100, Math.max(0, Math.round(
        Math.abs(startingWeight - latestWeekAvg) / Math.abs(startingWeight - tgtW) * 100
      )))
    : null;

  // Plateau detection: last 2 full weeks < 0.3 kg change
  const lastTwo = completedWeeks.slice(-2);
  const plateauDetected = lastTwo.length === 2 && Math.abs(lastTwo[1].average - lastTwo[0].average) < 0.3;

  // Trend
  const trendLabel = weeklyRate === null ? null
    : weeklyRate < -0.1 ? 'Losing'
    : weeklyRate > 0.1 ? 'Gaining'
    : 'Maintaining';

  // Chart data
  const chartData = useMemo(() => {
    const points = [];
    weeks.forEach(w => {
      w.logs.forEach(log => {
        points.push({ label: formatDate(log.date), weight: log.weight_kg, type: 'daily' });
      });
      if (w.average !== null) {
        points.push({ label: `Wk ${w.weekNum} avg`, weight: w.average, avg: w.average, weekLabel: true });
      }
    });
    return points;
  }, [weeks]);

  // Per-week analytics
  const weeklyChanges = completedWeeks.map((w, i) =>
    i === 0 ? null : Math.round((w.average - completedWeeks[i - 1].average) * 10) / 10
  ).filter(v => v !== null);

  const fastestDropWeek = completedWeeks.length >= 2
    ? completedWeeks.reduce((best, w, i) => {
        if (i === 0) return best;
        const delta = w.average - completedWeeks[i - 1].average;
        return (!best || delta < best.delta) ? { weekNum: w.weekNum, delta } : best;
      }, null)
    : null;

  // â”€â”€ handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleLogDay = (weekNum, dayNum) => {
    const key = `${weekNum}_${dayNum}`;
    const val = parseFloat(newWeights[key]);
    if (!val) return;

    const anchor = startDate ? parseISO(startDate) : (weightLogs.length ? parseISO([...weightLogs].sort((a, b) => a.date > b.date ? 1 : -1)[0].date) : new Date());
    const dayOffset = (weekNum - 1) * 7 + (dayNum - 1);
    const logDate = new Date(anchor);
    logDate.setDate(logDate.getDate() + dayOffset);
    const dateStr = format(logDate, 'yyyy-MM-dd');

    addLog.mutate({
      client_id: clientId,
      date: dateStr,
      weight_kg: val,
      note: newNotes[key] || '',
    });
    setNewWeights(p => { const n = { ...p }; delete n[key]; return n; });
    setNewNotes(p => { const n = { ...p }; delete n[key]; return n; });
  };

  const toggleWeek = (num) => setExpandedWeeks(p => ({ ...p, [num]: !p[num] }));

  return (
    <div className="space-y-6">
      {/* â”€â”€ Overview Cards â”€â”€ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon={Scale} label="Starting Weight" value={startingWeight ? `${startingWeight} kg` : null} color="blue" />
        <StatCard
          icon={Scale}
          label="Current Weight"
          value={latestWeekAvg ? `${latestWeekAvg} kg` : (startingWeight ? `${startingWeight} kg` : null)}
          sub="latest weekly avg"
          color="primary"
          highlight
        />
        <StatCard
          icon={totalChange !== null && totalChange < 0 ? TrendingDown : TrendingUp}
          label="Total Change"
          value={totalChange !== null ? `${totalChange > 0 ? '+' : ''}${totalChange} kg` : null}
          color={totalChange !== null ? (totalChange < 0 ? 'green' : 'red') : 'muted'}
        />
        <StatCard
          icon={BarChart2}
          label="Weekly Rate"
          value={weeklyRate !== null ? `${weeklyRate > 0 ? '+' : ''}${weeklyRate} kg/wk` : null}
          color={weeklyRate !== null ? (weeklyRate < 0 ? 'green' : weeklyRate > 0 ? 'red' : 'muted') : 'muted'}
        />
        <div className="col-span-2 sm:col-span-1">
          {tgtW && goalProgress !== null ? (
            <Card className="border-0 shadow-sm h-full">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-orange-500" />
                  <span className="text-xs text-muted-foreground">Goal Progress</span>
                </div>
                <p className="text-sm font-semibold">{startingWeight} â†’ {tgtW} kg</p>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${goalProgress}%` }} />
                </div>
                <p className="text-xs font-bold text-orange-600 dark:text-orange-400">{goalProgress}%</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-0 shadow-sm h-full">
              <CardContent className="p-4 flex flex-col justify-center gap-2">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Target Weight</span>
                </div>
                {isAdmin && editingTarget ? (
                  <div className="flex gap-1">
                    <Input type="number" step={0.1} value={targetWeight} onChange={e => setTargetWeight(e.target.value)} className="h-7 text-xs w-20" />
                    <Button size="sm" className="h-7 px-2" onClick={() => saveTarget.mutate(parseFloat(targetWeight))}><Save className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditingTarget(false)}><X className="w-3 h-3" /></Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="font-bold">{tgtW ? `${tgtW} kg` : <span className="text-muted-foreground text-sm">Not set</span>}</p>
                    {isAdmin && (
                      <button onClick={() => setEditingTarget(true)} className="text-muted-foreground hover:text-foreground">
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      {/* â”€â”€ Trend / Plateau Alert â”€â”€ */}
      {(trendLabel || plateauDetected) && (
        <div className="flex flex-wrap gap-2">
          {trendLabel && (
            <Badge className={
              trendLabel === 'Losing' ? 'bg-green-500/15 text-green-700 dark:text-green-400 border-0' :
              trendLabel === 'Gaining' ? 'bg-red-500/15 text-red-600 border-0' :
              'bg-muted text-muted-foreground border-0'
            }>
              {trendLabel === 'Losing' ? <TrendingDown className="w-3 h-3 mr-1" /> : trendLabel === 'Gaining' ? <TrendingUp className="w-3 h-3 mr-1" /> : <Minus className="w-3 h-3 mr-1" />}
              {trendLabel}
            </Badge>
          )}
          {plateauDetected && (
            <Badge className="bg-orange-500/15 text-orange-600 dark:text-orange-400 border-0 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Plateau detected â€” no significant change in last 2 weeks
            </Badge>
          )}
        </div>
      )}

      {/* â”€â”€ Graph â”€â”€ */}
      {chartData.length > 1 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Weight Progression</CardTitle>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowGraph(g => !g)}>
                {showGraph ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {showGraph ? 'Hide' : 'Show'}
              </Button>
            </div>
          </CardHeader>
          {showGraph && (
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval="preserveStartEnd" />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', fontSize: 12 }}
                      formatter={(val) => [`${val} kg`]}
                    />
                    <Line type="monotone" dataKey="weight" stroke="hsl(var(--primary)/50%)" strokeWidth={1.5} dot={{ r: 3, fill: 'hsl(var(--primary))' }} name="Daily" />
                    <Line type="monotone" dataKey="avg" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 4, fill: 'hsl(var(--primary))' }} connectNulls name="Weekly Avg" />
                    {tgtW && <ReferenceLine y={tgtW} stroke="hsl(var(--chart-4))" strokeDasharray="4 4" label={{ value: `Target: ${tgtW}kg`, fontSize: 10, fill: 'hsl(var(--chart-4))' }} />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* â”€â”€ Weekly Tables â”€â”€ */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Scale className="w-4 h-4 text-primary" />
          Weekly Weigh-In Log
        </h3>

        {weeks.length === 0 && (
          <div className="text-center py-16 border border-dashed rounded-xl text-muted-foreground">
            <Scale className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No weigh-ins recorded yet</p>
            <p className="text-sm mt-1">Start logging below.</p>
          </div>
        )}

        {/* Quick log for today (client view) when no weeks exist yet */}
        {weeks.length === 0 && !isAdmin && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <p className="text-sm font-medium mb-2">Log today's weight to get started</p>
              <div className="flex gap-2 items-center">
                <Input
                  type="number"
                  step={0.1}
                  placeholder="Enter today's weight (kg)"
                  value={newWeights['today'] || ''}
                  onChange={e => setNewWeights(p => ({ ...p, today: e.target.value }))}
                  className="flex-1"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const val = parseFloat(newWeights['today']);
                      if (!val) return;
                      addLog.mutate({
                        client_id: clientId,
                        date: format(new Date(), 'yyyy-MM-dd'),
                        weight_kg: val,
                        note: '',
                      });
                      setNewWeights(p => { const n = { ...p }; delete n['today']; return n; });
                    }
                  }}
                />
                <Button
                  disabled={!newWeights['today']}
                  onClick={() => {
                    const val = parseFloat(newWeights['today']);
                    if (!val) return;
                    addLog.mutate({
                      client_id: clientId,
                      date: format(new Date(), 'yyyy-MM-dd'),
                      weight_kg: val,
                      note: '',
                    });
                    setNewWeights(p => { const n = { ...p }; delete n['today']; return n; });
                  }}
                >
                  <Save className="w-4 h-4 mr-1" />Save Weight
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {[...weeks].reverse().map(week => {
          const isExpanded = expandedWeeks[week.weekNum] !== false; // default open for latest
          const isCurrentWeek = week.weekNum === weeks.length;

          return (
            <Card key={week.weekNum} className={`border-0 shadow-sm overflow-hidden ${isCurrentWeek ? 'ring-1 ring-primary/20' : ''}`}>
              <button
                className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
                onClick={() => toggleWeek(week.weekNum)}
              >
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm">Week {week.weekNum}</span>
                  {isCurrentWeek && <Badge className="bg-primary/10 text-primary border-0 text-xs">Current</Badge>}
                  {week.average !== null && (
                    <span className="text-sm text-muted-foreground">
                      Avg: <span className="font-bold text-foreground">{week.average} kg</span>
                    </span>
                  )}
                  {week.logs.length === 0 && <span className="text-xs text-muted-foreground">No entries</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{week.logs.length}/7 days</span>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </button>

              {isExpanded && (
                <CardContent className="pt-0 pb-4">
                  {/* Day table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 px-2 text-xs text-muted-foreground font-medium w-16">Day</th>
                          <th className="text-left py-2 px-2 text-xs text-muted-foreground font-medium">Weight</th>
                          <th className="text-left py-2 px-2 text-xs text-muted-foreground font-medium hidden sm:table-cell">Note</th>
                          <th className="w-28" />
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: 7 }, (_, d) => {
                          const dayNum = d + 1;
                          const log = week.logs.find(l => l.dayOfWeek === dayNum);
                          const key = `${week.weekNum}_${dayNum}`;
                          const isEditing = editingLog?.id === log?.id;

                          return (
                            <tr key={dayNum} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                              <td className="py-2 px-2 text-muted-foreground font-medium">Day {dayNum}</td>
                              <td className="py-2 px-2">
                                {isEditing ? (
                                  <Input
                                    type="number" step={0.1}
                                    value={editVal}
                                    onChange={e => setEditVal(e.target.value)}
                                    className="h-7 w-24 text-xs"
                                    autoFocus
                                  />
                                ) : log ? (
                                  <span className="font-semibold">{log.weight_kg} kg</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground italic">â€”</span>
                                )}
                              </td>
                              <td className="py-2 px-2 hidden sm:table-cell">
                                {isEditing ? (
                                  <Input
                                    value={editNote}
                                    onChange={e => setEditNote(e.target.value)}
                                    className="h-7 text-xs"
                                    placeholder="Note..."
                                  />
                                ) : (
                                  <span className="text-xs text-muted-foreground">{log?.note || ''}</span>
                                )}
                              </td>
                              <td className="py-2 px-2">
                                {isEditing ? (
                                  <div className="flex gap-1">
                                    <Button size="sm" className="h-6 px-2" onClick={() => updateLog.mutate({ id: log.id, data: { weight_kg: parseFloat(editVal), note: editNote } })}>
                                      <Save className="w-3 h-3" />
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setEditingLog(null)}>
                                      <X className="w-3 h-3" />
                                    </Button>
                                  </div>
                                ) : log ? (
                                  <div className="flex gap-1">
                                    <button onClick={() => { setEditingLog(log); setEditVal(String(log.weight_kg)); setEditNote(log.note || ''); }} className="text-muted-foreground hover:text-foreground p-1">
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                    {isAdmin && (
                                      <button onClick={() => deleteLog.mutate(log.id)} className="text-destructive hover:text-destructive/80 p-1">
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <div className="flex gap-1 items-center">
                                    <Input
                                      type="number"
                                      step={0.1}
                                      placeholder="Enter weight"
                                      value={newWeights[key] || ''}
                                      onChange={e => setNewWeights(p => ({ ...p, [key]: e.target.value }))}
                                      className="h-7 w-24 text-xs"
                                      onKeyDown={e => e.key === 'Enter' && handleLogDay(week.weekNum, dayNum)}
                                    />
                                    {newWeights[key] && (
                                      <Button size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => handleLogDay(week.weekNum, dayNum)}>
                                        <Save className="w-3 h-3" />
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {week.average !== null && (
                        <tfoot>
                          <tr className="bg-primary/5">
                            <td colSpan={4} className="px-2 py-2.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-muted-foreground">Week {week.weekNum} Average</span>
                                <span className="font-bold text-primary text-sm">{week.average} kg</span>
                              </div>
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* â”€â”€ Analytics Section â”€â”€ */}
      {completedWeeks.length >= 2 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-primary" />
              Week-by-Week Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Weekly change list */}
            <div className="space-y-2">
              {completedWeeks.map((w, i) => {
                if (i === 0) return null;
                const change = Math.round((w.average - completedWeeks[i - 1].average) * 10) / 10;
                return (
                  <div key={w.weekNum} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 text-sm">
                    <span className="text-muted-foreground">Wk {completedWeeks[i - 1].weekNum} â†’ Wk {w.weekNum}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{completedWeeks[i - 1].average} â†’ {w.average} kg</span>
                      <Badge className={`border-0 text-xs ${change < -0.05 ? 'bg-green-500/15 text-green-700 dark:text-green-400' : change > 0.05 ? 'bg-red-500/15 text-red-600' : 'bg-muted text-muted-foreground'}`}>
                        {change > 0 ? '+' : ''}{change} kg
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-border">
              <div className="p-3 rounded-xl bg-muted/40 text-center">
                <p className="text-xs text-muted-foreground mb-1">Avg Weekly Change</p>
                <p className="font-bold text-base">{weeklyRate !== null ? `${weeklyRate > 0 ? '+' : ''}${weeklyRate} kg/wk` : 'â€”'}</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/40 text-center">
                <p className="text-xs text-muted-foreground mb-1">Best Drop Week</p>
                <p className="font-bold text-base text-green-600 dark:text-green-400">
                  {fastestDropWeek ? `Wk ${fastestDropWeek.weekNum} (${fastestDropWeek.delta.toFixed(1)} kg)` : 'â€”'}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-muted/40 text-center">
                <p className="text-xs text-muted-foreground mb-1">Weeks Tracked</p>
                <p className="font-bold text-base">{completedWeeks.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
