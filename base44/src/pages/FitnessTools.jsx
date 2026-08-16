import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calculator, Flame, Dumbbell, BarChart3, Target } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { calculateWeight, estimate1RM, getRpePercentage, PLATE_INCREMENTS } from '@/lib/rpeUtils';

// â”€â”€â”€ RPE Calculator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const REP_OPTIONS = [1,2,3,4,5,6,7,8,9,10,11,12];
const RPE_OPTIONS = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

function RPEWeightCalculator() {
  const [mode, setMode]           = useState('weight'); // 'weight' | '1rm'
  const [oneRM, setOneRM]         = useState('');
  const [reps, setReps]           = useState('');
  const [rpe, setRpe]             = useState('');
  const [weight, setWeight]       = useState('');
  const [increment, setIncrement] = useState(2.5);

  // Live calculations â€” no button needed
  const weightResult = useMemo(() => {
    if (mode !== 'weight') return null;
    const rm = Number(oneRM), r = Number(reps), p = Number(rpe);
    if (!rm || !r || !p) return null;
    const pct    = getRpePercentage(r, p);
    const rawKg  = rm * pct;
    const roundedKg = calculateWeight(rm, r, p, increment);
    return { pct: Math.round(pct * 1000) / 10, raw: Math.round(rawKg * 10) / 10, rounded: roundedKg };
  }, [mode, oneRM, reps, rpe, increment]);

  const oneRMResult = useMemo(() => {
    if (mode !== '1rm') return null;
    const w = Number(weight), r = Number(reps), p = Number(rpe);
    if (!w || !r || !p) return null;
    const estimated = estimate1RM(w, r, p);
    const pct = getRpePercentage(r, p);
    return { estimated, pct: Math.round(pct * 1000) / 10 };
  }, [mode, weight, reps, rpe]);

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Calculator className="w-5 h-5 text-primary" />RPE Weight Calculator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Mode toggle */}
        <div className="flex gap-2 p-1 bg-muted rounded-lg">
          {['weight', '1rm'].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${mode === m ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {m === 'weight' ? 'Weight from 1RM' : 'Estimate 1RM'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {mode === 'weight' ? (
            <div>
              <Label>Your 1RM (kg)</Label>
              <Input type="number" value={oneRM} onChange={e => setOneRM(e.target.value)} placeholder="e.g. 100" className="mt-1" />
            </div>
          ) : (
            <div>
              <Label>Weight Lifted (kg)</Label>
              <Input type="number" value={weight} onChange={e => setWeight(e.target.value)} placeholder="e.g. 80" className="mt-1" />
            </div>
          )}

          {/* Reps selector */}
          <div>
            <Label>Reps</Label>
            <Select value={String(reps)} onValueChange={v => setReps(v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select reps" /></SelectTrigger>
              <SelectContent>
                {REP_OPTIONS.map(r => <SelectItem key={r} value={String(r)}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* RPE selector */}
          <div className="col-span-2">
            <Label>RPE</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {RPE_OPTIONS.map(r => (
                <button
                  key={r}
                  onClick={() => setRpe(String(r))}
                  className={`px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-all ${String(rpe) === String(r) ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary/50'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Plate increment â€” only relevant for weight mode */}
          {mode === 'weight' && (
            <div className="col-span-2">
              <Label>Plate Rounding</Label>
              <div className="flex gap-2 mt-1">
                {PLATE_INCREMENTS.map(inc => (
                  <button
                    key={inc.value}
                    onClick={() => setIncrement(inc.value)}
                    className={`px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-all ${increment === inc.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}
                  >
                    {inc.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Live result */}
        {mode === 'weight' && weightResult && (
          <div className="grid grid-cols-3 gap-3">
            <div className="p-4 rounded-xl bg-primary/5 text-center border border-primary/20 col-span-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">% of 1RM</p>
              <p className="text-2xl font-bold text-primary mt-1">{weightResult.pct}%</p>
            </div>
            <div className="p-4 rounded-xl bg-primary/5 text-center border border-primary/20">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Exact</p>
              <p className="text-2xl font-bold text-primary mt-1">{weightResult.raw} kg</p>
            </div>
            <div className="p-4 rounded-xl bg-chart-3/10 text-center border border-chart-3/30">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Rounded ({increment}kg)</p>
              <p className="text-2xl font-bold text-chart-3 mt-1">{weightResult.rounded} kg</p>
            </div>
          </div>
        )}

        {mode === '1rm' && oneRMResult && (
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-xl bg-primary/5 text-center border border-primary/20">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Estimated 1RM</p>
              <p className="text-3xl font-bold text-primary mt-1">{oneRMResult.estimated} kg</p>
            </div>
            <div className="p-4 rounded-xl bg-muted/50 text-center border border-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Set was</p>
              <p className="text-3xl font-bold text-foreground mt-1">{oneRMResult.pct}%</p>
              <p className="text-xs text-muted-foreground">of estimated 1RM</p>
            </div>
          </div>
        )}

        {/* Quick reference: all targets for this 1RM */}
        {mode === 'weight' && oneRM && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">All RPE 8 targets for {oneRM}kg 1RM</p>
            <div className="flex flex-wrap gap-2">
              {REP_OPTIONS.map(r => {
                const w = calculateWeight(Number(oneRM), r, 8, increment);
                if (!w) return null;
                const pct = getRpePercentage(r, 8);
                return (
                  <div key={r} className="px-2 py-1 rounded bg-muted text-xs text-center min-w-[52px]">
                    <div className="font-semibold">{r} rep{r > 1 ? 's' : ''}</div>
                    <div className="text-primary font-bold">{w}kg</div>
                    <div className="text-muted-foreground">{Math.round(pct * 100)}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// â”€â”€â”€ Full RPE Ã— Reps Matrix â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function RPEMatrix() {
  const [oneRM, setOneRM]         = useState('');
  const [highlight, setHighlight] = useState(null);

  const rpeRows = [10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6];
  const repCols = [1,2,3,4,5,6,7,8,9,10,11,12];

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />RPE Ã— Reps Matrix
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="w-44">
            <Label>1RM (kg) â€” optional</Label>
            <Input type="number" value={oneRM} onChange={e => setOneRM(e.target.value)} placeholder="e.g. 100" className="mt-1" />
          </div>
          {oneRM && <p className="text-xs text-muted-foreground pb-2">Showing weights for {oneRM}kg 1RM</p>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-[500px]">
            <thead>
              <tr className="bg-muted/80">
                <th className="p-2 text-left font-bold border border-border/50 sticky left-0 bg-muted/80 z-10">RPE \ Reps</th>
                {repCols.map(r => (
                  <th
                    key={r}
                    className={`p-2 text-center font-bold border border-border/50 ${highlight?.rep === r ? 'bg-primary/20' : ''}`}
                  >
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rpeRows.map(rpeVal => (
                <tr key={rpeVal} className="hover:bg-muted/20">
                  <td className={`p-2 font-bold border border-border/50 sticky left-0 bg-card z-10 ${highlight?.rpe === rpeVal ? 'bg-primary/20' : ''}`}>
                    <Badge
                      variant={rpeVal >= 9 ? 'destructive' : rpeVal >= 7.5 ? 'default' : 'secondary'}
                      className="font-mono text-[10px]"
                    >
                      {rpeVal}
                    </Badge>
                  </td>
                  {repCols.map(repVal => {
                    const pct = getRpePercentage(repVal, rpeVal);
                    const pctDisplay = pct ? `${Math.round(pct * 1000) / 10}%` : 'â€”';
                    const wtDisplay  = oneRM && pct
                      ? `${Math.round(Number(oneRM) * pct * 10) / 10}`
                      : null;
                    const isHigh = pct >= 0.9;
                    const isLow  = pct < 0.65;
                    return (
                      <td
                        key={repVal}
                        onMouseEnter={() => setHighlight({ rpe: rpeVal, rep: repVal })}
                        onMouseLeave={() => setHighlight(null)}
                        className={`p-1.5 border border-border/50 text-center cursor-default transition-colors
                          ${highlight?.rpe === rpeVal && highlight?.rep === repVal ? 'bg-primary/10 ring-1 ring-primary/50' : ''}
                          ${isHigh ? 'text-destructive font-semibold' : isLow ? 'text-muted-foreground' : ''}
                        `}
                      >
                        <div className="font-mono leading-tight">
                          {pctDisplay}
                          {wtDisplay && <div className="text-primary font-bold">{wtDisplay}</div>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Based on Mike Tuchscherer's canonical RTS chart â€” the same table used by calculaterpe.com.
        </p>
      </CardContent>
    </Card>
  );
}

// â”€â”€â”€ RPE Reference Chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function RPEChart() {
  const rpeData = [
    { rpe: 10,  rir: 0,   description: 'Maximum effort',  detail: 'Absolute max â€” could not do another rep' },
    { rpe: 9.5, rir: 0.5, description: 'Near maximum',    detail: 'Could maybe do 1 more' },
    { rpe: 9,   rir: 1,   description: 'Very hard',       detail: 'Could do 1 more rep' },
    { rpe: 8.5, rir: 1.5, description: 'Hard',            detail: 'Definitely 1, maybe 2 more' },
    { rpe: 8,   rir: 2,   description: 'Hard',            detail: 'Could do 2 more reps' },
    { rpe: 7.5, rir: 2.5, description: 'Moderate-hard',   detail: 'Could do 2â€“3 more reps' },
    { rpe: 7,   rir: 3,   description: 'Moderate',        detail: 'Could do 3 more reps' },
    { rpe: 6.5, rir: 3.5, description: 'Moderate',        detail: 'Could do 3â€“4 more reps' },
    { rpe: 6,   rir: 4,   description: 'Easy-moderate',   detail: 'Could do 4+ more reps' },
  ];
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Dumbbell className="w-5 h-5 text-primary" />RPE Reference Chart</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-semibold">RPE</th>
                <th className="text-left p-3 font-semibold">RIR</th>
                <th className="text-left p-3 font-semibold">Effort</th>
                <th className="text-left p-3 font-semibold hidden sm:table-cell">Description</th>
              </tr>
            </thead>
            <tbody>
              {rpeData.map(row => (
                <tr key={row.rpe} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="p-3">
                    <Badge variant={row.rpe >= 9 ? 'destructive' : row.rpe >= 7 ? 'default' : 'secondary'} className="font-mono">
                      {row.rpe}
                    </Badge>
                  </td>
                  <td className="p-3 font-mono text-muted-foreground">{row.rir}</td>
                  <td className="p-3 font-medium">{row.description}</td>
                  <td className="p-3 text-muted-foreground hidden sm:table-cell">{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// â”€â”€â”€ BMR Calculator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function BMRCalculator() {
  const [gender, setGender]     = useState('male');
  const [age, setAge]           = useState('');
  const [weight, setWeight]     = useState('');
  const [height, setHeight]     = useState('');
  const [activity, setActivity] = useState('1.55');
  const [result, setResult]     = useState(null);

  const calculate = () => {
    const w = Number(weight), h = Number(height), a = Number(age);
    if (!w || !h || !a) return;
    const bmr = gender === 'male' ? 10 * w + 6.25 * h - 5 * a + 5 : 10 * w + 6.25 * h - 5 * a - 161;
    setResult({ bmr: Math.round(bmr), tdee: Math.round(bmr * Number(activity)) });
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Flame className="w-5 h-5 text-destructive" />BMR & TDEE Calculator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Gender</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Age</Label><Input type="number" value={age} onChange={e => setAge(e.target.value)} placeholder="25" className="mt-1" /></div>
          <div><Label>Weight (kg)</Label><Input type="number" value={weight} onChange={e => setWeight(e.target.value)} placeholder="75" className="mt-1" /></div>
          <div><Label>Height (cm)</Label><Input type="number" value={height} onChange={e => setHeight(e.target.value)} placeholder="175" className="mt-1" /></div>
        </div>
        <div>
          <Label>Activity Level</Label>
          <Select value={activity} onValueChange={setActivity}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1.2">Sedentary (little/no exercise)</SelectItem>
              <SelectItem value="1.375">Light (1-3 days/week)</SelectItem>
              <SelectItem value="1.55">Moderate (3-5 days/week)</SelectItem>
              <SelectItem value="1.725">Very Active (6-7 days/week)</SelectItem>
              <SelectItem value="1.9">Extra Active (athlete)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={calculate} className="w-full">Calculate</Button>
        {result && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="p-4 rounded-xl bg-primary/5 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">BMR</p>
              <p className="text-3xl font-bold text-primary mt-1">{result.bmr}</p>
              <p className="text-xs text-muted-foreground">cal/day</p>
            </div>
            <div className="p-4 rounded-xl bg-destructive/5 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">TDEE</p>
              <p className="text-3xl font-bold text-destructive mt-1">{result.tdee}</p>
              <p className="text-xs text-muted-foreground">cal/day</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// â”€â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function FitnessTools() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Fitness Tools</h1>
      <Tabs defaultValue="rpe-calc">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="rpe-calc"   className="gap-1"><Calculator className="w-4 h-4" />RPE Calculator</TabsTrigger>
          <TabsTrigger value="rpe-matrix" className="gap-1"><Target className="w-4 h-4" />RPE Matrix</TabsTrigger>
          <TabsTrigger value="bmr"        className="gap-1"><Flame className="w-4 h-4" />BMR & TDEE</TabsTrigger>
          <TabsTrigger value="rpe-chart"  className="gap-1"><Dumbbell className="w-4 h-4" />RPE Chart</TabsTrigger>
        </TabsList>
        <TabsContent value="rpe-calc"   className="mt-4"><RPEWeightCalculator /></TabsContent>
        <TabsContent value="rpe-matrix" className="mt-4"><RPEMatrix /></TabsContent>
        <TabsContent value="bmr"        className="mt-4"><BMRCalculator /></TabsContent>
        <TabsContent value="rpe-chart"  className="mt-4"><RPEChart /></TabsContent>
      </Tabs>
    </div>
  );
}
