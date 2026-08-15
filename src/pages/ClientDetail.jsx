import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Save, Shield, ShieldAlert, Dumbbell, Loader2, Bell, CheckCheck, AlertTriangle, CreditCard, Calendar, Info, MessageCircle, User, TrendingUp, Layers, ClipboardList, Trash2, Wallet, Scale } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { differenceInYears } from 'date-fns';
import ChatSection from '@/components/chat/ChatSection';
import StrengthDatabase from '@/components/clients/StrengthDatabase';
import CategoryPermissions from '@/components/clients/CategoryPermissions';
import ProgramTable from '@/components/program/ProgramTable';
import DeleteClientDialog from '@/components/clients/DeleteClientDialog';
import ClientPrograms from '@/components/clients/ClientPrograms';
import ClientSubscriptionPanel from '@/components/clients/ClientSubscription';
import BodyWeightTracking from '@/components/clients/BodyWeightTracking';
import { formatDate, formatDateTime, calcEndDate, calcPaymentDueDate, todayISO } from '@/lib/dateUtils';

const notifIcons = {
  payment_warning: CreditCard,
  payment_overdue: AlertTriangle,
  program_ending: Calendar,
  program_ended: Calendar,
  coach_update: Info,
  new_message: MessageCircle,
  general: Info,
};

const notifColors = {
  payment_warning: 'bg-chart-4/10 text-chart-4',
  payment_overdue: 'bg-destructive/10 text-destructive',
  program_ending: 'bg-primary/10 text-primary',
  program_ended: 'bg-chart-2/10 text-chart-2',
  coach_update: 'bg-chart-3/10 text-chart-3',
  new_message: 'bg-primary/10 text-primary',
  general: 'bg-muted text-muted-foreground',
};

export default function ClientDetail() {
  const clientId = window.location.pathname.split('/').pop();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: clients = [] } = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => api.entities.User.filter({ id: clientId }),
  });
  const client = clients[0];

  const { data: clientNotifications = [] } = useQuery({
    queryKey: ['client-notifications', clientId],
    queryFn: () => api.entities.Notification.filter({ user_id: clientId }, '-created_date'),
    enabled: !!clientId,
  });

  const assignedProgramId = client?.assigned_program_id;

  const { data: assignedProgramArr = [] } = useQuery({
    queryKey: ['assigned-program', assignedProgramId],
    queryFn: () => api.entities.TrainingProgram.filter({ id: assignedProgramId }),
    enabled: !!assignedProgramId,
  });
  const assignedProgram = assignedProgramArr[0];

  const { data: assignedProgramExercises = [] } = useQuery({
    queryKey: ['assigned-program-exercises', assignedProgramId],
    queryFn: () => api.entities.ProgramExercise.filter({ program_id: assignedProgramId }),
    enabled: !!assignedProgramId,
  });

  const { data: exerciseLibrary = [] } = useQuery({
    queryKey: ['exercises'],
    queryFn: () => api.entities.Exercise.list(),
  });

  const { data: clientStrengthRecords = [] } = useQuery({
    queryKey: ['client-strength', clientId],
    queryFn: () => api.entities.ClientStrengthRecord.filter({ client_id: clientId }),
    enabled: !!clientId,
  });

  const [formData, setFormData] = useState(null);
  const [weightLogs, setWeightLogs] = useState([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    api.entities.WeightLog.filter({ client_id: clientId }, '-date', 7)
      .then(logs => setWeightLogs(logs))
      .catch(() => {});
  }, [clientId]);

  // Auto-sync invitation data if client profile is missing data
  useEffect(() => {
    if (!client) return;

    const syncInvitationData = async () => {
      // Only sync if no cycles exist yet (fresh account)
      const existingCycles = await api.entities.ProgramCycle.filter({ client_id: clientId });
      if (existingCycles.length > 0) return;

      try {
        const invitations = await api.entities.ClientInvitation.filter({ email: client.email, status: 'pending' });
        const inv = invitations[0];
        if (!inv) return;

        const today = todayISO();
        const resolvedStart = inv.program_start_date || today;
        const resolvedEnd = inv.program_end_date || calcEndDate(resolvedStart, inv.program_duration_weeks || 4);
        const resolvedPaymentDue = inv.payment_due_date || calcPaymentDueDate(resolvedStart);

        // Sync all invitation data to user profile
        const syncPayload = {
          phone: inv.phone || undefined,
          date_of_birth: inv.date_of_birth || undefined,
          height_cm: inv.height_cm || undefined,
          weight_kg: inv.weight_kg || undefined,
          starting_weight_kg: inv.starting_weight_kg || undefined,
          goal: inv.goal || undefined,
          medical_conditions: inv.medical_conditions || undefined,
          allergies: inv.allergies || undefined,
          payment_status: inv.payment_status,
          payment_due_date: resolvedPaymentDue,
          program_start_date: resolvedStart,
          program_end_date: resolvedEnd,
          program_duration_weeks: inv.program_duration_weeks || 4,
          account_start_date: inv.created_date ? inv.created_date.split('T')[0] : today,
        };
        await api.entities.User.update(clientId, syncPayload);
        // Create the initial program cycle
        await api.entities.ProgramCycle.create({
          client_id: clientId,
          program_name: inv.program_name || 'Phase 1',
          start_date: resolvedStart,
          end_date: resolvedEnd,
          duration_weeks: inv.program_duration_weeks || 4,
          payment_due_date: resolvedPaymentDue,
          payment_status: inv.payment_status,
          status: 'active',
        });

        // Mark invitation as synced
        await api.entities.ClientInvitation.update(inv.id, { status: 'synced' });

        queryClient.invalidateQueries({ queryKey: ['client', clientId] });
        queryClient.invalidateQueries({ queryKey: ['program-cycles', clientId] });
      } catch {
        // Silent fail â€” coach can enter data manually
      }
    };

    syncInvitationData();
  }, [client?.id]);

  useEffect(() => {
    if (client && !formData) {
      let currentWeight = client.weight_kg;
      if (!currentWeight && client.starting_weight_kg) currentWeight = client.starting_weight_kg;

      setFormData({
        phone: client.phone || '',
        date_of_birth: client.date_of_birth || '',
        height_cm: client.height_cm || '',
        weight_kg: currentWeight || '',
        starting_weight_kg: client.starting_weight_kg || '',
        goal: client.goal || '',
        medical_conditions: client.medical_conditions || '',
        allergies: client.allergies || '',
        payment_status: client.payment_status || 'not_paid',
        payment_due_date: client.payment_due_date || '',
        account_start_date: client.account_start_date || '',
        program_start_date: client.program_start_date || '',
        program_end_date: client.program_end_date || '',
        program_duration_weeks: client.program_duration_weeks || 4,
        is_blocked: client.is_blocked || false,
        can_edit_weight_lifted: client.can_edit_weight_lifted !== false,
        can_edit_rpe: client.can_edit_rpe || false,
        can_edit_rir: client.can_edit_rir || false,
        assigned_program_id: client.assigned_program_id || '',
        assigned_diet_plan_id: client.assigned_diet_plan_id || '',
      });
    }
  }, [client]);

  useEffect(() => {
    if (!weightLogs.length || !formData) return;
    const avg = weightLogs.reduce((sum, l) => sum + l.weight_kg, 0) / weightLogs.length;
    const avgRounded = Math.round(avg * 10) / 10;
    setFormData(prev => prev ? { ...prev, weight_kg: avgRounded } : prev);
  }, [weightLogs.length]);

  // Auto-calculate program end date and payment due date when start/duration changes
  const handleProgramDateChange = (field, value) => {
    setFormData(prev => {
      if (!prev) return prev;
      const updated = { ...prev, [field]: value };
      const start = field === 'program_start_date' ? value : updated.program_start_date;
      const weeks = field === 'program_duration_weeks' ? Number(value) : Number(updated.program_duration_weeks);
      if (start && weeks) {
        updated.program_end_date = calcEndDate(start, weeks);
        updated.payment_due_date = calcPaymentDueDate(start);
      }
      return updated;
    });
  };

  const updateClient = useMutation({
    mutationFn: async (data) => {
      const today = todayISO();
      const resolvedStart = data.program_start_date || today;
      const weeks = Number(data.program_duration_weeks) || 4;
      const resolvedEnd = data.program_end_date || calcEndDate(resolvedStart, weeks);
      const resolvedPaymentDue = data.payment_due_date || calcPaymentDueDate(resolvedStart);

      const payload = {
        ...data,
        program_start_date: resolvedStart,
        program_end_date: resolvedEnd,
        program_duration_weeks: weeks,
        payment_due_date: resolvedPaymentDue,
        weight_kg: data.weight_kg || data.starting_weight_kg || undefined,
      };
      await api.entities.User.update(clientId, payload);

      await api.entities.Notification.create({
        user_id: clientId,
        title: 'Your profile was updated',
        message: 'Your coach has updated your profile or program information.',
        type: 'coach_update',
        read: false,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client-notifications', clientId] });
      queryClient.invalidateQueries({ queryKey: ['program-cycles', clientId] });
      toast.success('Changes saved!');
    },
    onError: (err) => {
      toast.error('Failed to save: ' + (err?.message || 'Unknown error'));
    },
  });

  const markNotifRead = useMutation({
    mutationFn: (id) => api.entities.Notification.update(id, { read: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client-notifications', clientId] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unread = clientNotifications.filter(n => !n.read);
      await Promise.all(unread.map(n => api.entities.Notification.update(n.id, { read: true })));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client-notifications', clientId] }),
  });

  if (!client || !formData) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  const set = (k, v) => setFormData(p => ({ ...p, [k]: v }));
  const age = formData.date_of_birth ? differenceInYears(new Date(), new Date(formData.date_of_birth)) : null;
  const unreadNotifCount = clientNotifications.filter(n => !n.read).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/clients')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{client.full_name || 'Pending Signup'}</h1>
          <p className="text-muted-foreground text-sm">{client.email}</p>
        </div>
        {client.is_blocked && <Badge variant="destructive"><ShieldAlert className="w-3 h-3 mr-1" />Blocked</Badge>}
        <Button
          variant="outline"
          size="sm"
          className="text-destructive border-destructive/40 hover:bg-destructive hover:text-white gap-1.5"
          onClick={() => setShowDeleteDialog(true)}
        >
          <Trash2 className="w-4 h-4" />
          Delete Account
        </Button>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="profile" className="flex items-center gap-1"><User className="w-3.5 h-3.5" />Profile</TabsTrigger>
          <TabsTrigger value="subscription" className="flex items-center gap-1"><Wallet className="w-3.5 h-3.5" />Subscription</TabsTrigger>
          <TabsTrigger value="permissions" className="flex items-center gap-1"><Shield className="w-3.5 h-3.5" />Permissions</TabsTrigger>
          <TabsTrigger value="client-programs" className="flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" />Client Programs</TabsTrigger>
          <TabsTrigger value="weight" className="flex items-center gap-1"><Scale className="w-3.5 h-3.5" />Weight Tracking</TabsTrigger>
          <TabsTrigger value="strength" className="flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" />1RM Database</TabsTrigger>
          <TabsTrigger value="current-program" className="flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" />Current Program</TabsTrigger>
          <TabsTrigger value="video-access" className="flex items-center gap-1"><Layers className="w-3.5 h-3.5" />Video Access</TabsTrigger>
          <TabsTrigger value="chat" className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />Chat</TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-1">
            <Bell className="w-3.5 h-3.5" />Notifications
            {unreadNotifCount > 0 && (
              <Badge className="bg-destructive text-destructive-foreground text-xs px-1.5 py-0 h-4 min-w-4">{unreadNotifCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Subscription Tab */}
        <TabsContent value="subscription" className="mt-4">
          <ClientSubscriptionPanel client={client} clientId={clientId} />
        </TabsContent>
        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Contact Info</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Phone</Label>
                <Input value={formData.phone} onChange={e => set('phone', e.target.value)} />
              </div>
              <div>
                <Label>Date of Birth</Label>
                <div className="relative">
                  <Input type="date" value={formData.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} />
                  {age !== null && (
                    <Badge className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary/10 text-primary border-0 text-xs pointer-events-none">
                      Age: {age}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Physical Stats</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div><Label>Height (cm)</Label><Input type="number" value={formData.height_cm} onChange={e => set('height_cm', Number(e.target.value))} /></div>
              <div><Label>Current Weight (kg)</Label><Input type="number" value={formData.weight_kg} onChange={e => set('weight_kg', Number(e.target.value))} /></div>
              <div><Label>Starting Weight (kg)</Label><Input type="number" value={formData.starting_weight_kg} onChange={e => set('starting_weight_kg', Number(e.target.value))} /></div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Goals & Health</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div><Label>Goal</Label><Input value={formData.goal} onChange={e => set('goal', e.target.value)} placeholder="e.g. Lose weight, build muscle..." /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label>Medical Conditions</Label><Textarea rows={2} value={formData.medical_conditions} onChange={e => set('medical_conditions', e.target.value)} /></div>
                <div><Label>Allergies</Label><Textarea rows={2} value={formData.allergies} onChange={e => set('allergies', e.target.value)} /></div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Account Dates</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Account Start Date</Label>
                <Input type="date" value={formData.account_start_date} onChange={e => set('account_start_date', e.target.value)} />
                {formData.account_start_date && <p className="text-xs text-muted-foreground mt-1">{formatDate(formData.account_start_date)}</p>}
              </div>
            </CardContent>
          </Card>

          <Button onClick={() => updateClient.mutate(formData)} disabled={updateClient.isPending} className="gap-2">
            {updateClient.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {updateClient.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </TabsContent>

        {/* Permissions Tab */}
        <TabsContent value="permissions" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Shield className="w-5 h-5" />Training Permissions</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {[
                { key: 'can_edit_weight_lifted', label: 'Edit Weight Lifted', desc: 'Client can input weights' },
                { key: 'can_edit_rpe', label: 'Edit RPE', desc: 'Client can change RPE values' },
                { key: 'can_edit_rir', label: 'Edit RIR', desc: 'Client can change RIR values' },
              ].map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div><p className="font-medium text-sm">{label}</p><p className="text-xs text-muted-foreground">{desc}</p></div>
                  <Switch checked={formData[key]} onCheckedChange={v => set(key, v)} />
                </div>
              ))}
            </CardContent>
          </Card>
          <Button onClick={() => updateClient.mutate(formData)} disabled={updateClient.isPending} className="gap-2">
            {updateClient.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {updateClient.isPending ? 'Saving...' : 'Save Permissions'}
          </Button>
        </TabsContent>

        {/* Client Programs Tab (merged Assignments + History) */}
        <TabsContent value="client-programs" className="mt-4">
          <ClientPrograms client={client} clientId={clientId} />
        </TabsContent>

        {/* Current Program Tab */}
        <TabsContent value="current-program" className="mt-4 space-y-4">
          {!assignedProgramId ? (
            <div className="text-center py-16 text-muted-foreground">
              <Dumbbell className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">No program assigned</p>
              <p className="text-sm mt-1">Assign a training program in the Assignments tab.</p>
            </div>
          ) : !assignedProgram ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div>
                <h3 className="font-semibold text-lg">{assignedProgram.name}</h3>
                <p className="text-sm text-muted-foreground">{assignedProgram.num_weeks} weeks Â· {assignedProgram.num_days_per_week} days/week Â· {assignedProgramExercises.length} exercises total</p>
              </div>
              <Card className="border-0 shadow-sm overflow-hidden">
                <CardContent className="p-0 pb-2">
                  <ProgramTable
                   program={assignedProgram}
                   programExercises={assignedProgramExercises}
                   exerciseLibrary={exerciseLibrary}
                   isAdmin={true}
                   onAddExercise={() => {}}
                   clientStrengthRecords={clientStrengthRecords}
                  />
                </CardContent>
              </Card>
              {assignedProgram.admin_notes && (
                <Card className="border-0 shadow-sm">
                  <CardHeader><CardTitle className="text-sm">Program Notes</CardTitle></CardHeader>
                  <CardContent><p className="text-sm text-muted-foreground whitespace-pre-wrap">{assignedProgram.admin_notes}</p></CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* Weight Tracking Tab */}
        <TabsContent value="weight" className="mt-4">
          <BodyWeightTracking clientId={clientId} isAdmin={true} client={client} />
        </TabsContent>

        {/* 1RM Database Tab */}
        <TabsContent value="strength" className="mt-4">
          <StrengthDatabase clientId={clientId} />
        </TabsContent>

        {/* Video Access Tab */}
        <TabsContent value="video-access" className="mt-4">
          <CategoryPermissions clientId={clientId} />
        </TabsContent>

        {/* Chat Tab */}
        <TabsContent value="chat" className="mt-4">
          <ChatSection clientId={clientId} isAdmin={true} clientUserId={clientId} />
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Client Notifications</h3>
              <p className="text-sm text-muted-foreground">{unreadNotifCount} unread for {client.full_name || client.email}</p>
            </div>
            {unreadNotifCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()}>
                <CheckCheck className="w-4 h-4 mr-2" />Mark all read
              </Button>
            )}
          </div>
          <div className="space-y-3">
            {clientNotifications.map(notif => {
              const Icon = notifIcons[notif.type] || Info;
              const colorClass = notifColors[notif.type] || notifColors.general;
              return (
                <Card key={notif.id} className={`border-0 shadow-sm transition-all ${!notif.read ? 'ring-2 ring-primary/20' : 'opacity-70'}`}>
                  <CardContent className="p-4 flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-sm">{notif.title}</p>
                          <p className="text-sm text-muted-foreground mt-0.5">{notif.message}</p>
                        </div>
                        {!notif.read && (
                          <Button variant="ghost" size="sm" className="flex-shrink-0 text-xs" onClick={() => markNotifRead.mutate(notif.id)}>
                            Mark read
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">{formatDateTime(notif.created_date)}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {clientNotifications.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No notifications for this client yet</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <DeleteClientDialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        client={client}
        onDeleted={() => navigate('/clients')}
      />
    </div>
  );
}
