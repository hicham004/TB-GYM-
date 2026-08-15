import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Save, Mail, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { differenceInYears } from 'date-fns';
import { formatDate, calcEndDate, calcPaymentDueDate, todayISO } from '@/lib/dateUtils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
export default function InvitedClientDetail() {
  const invitationId = window.location.pathname.split('/').pop();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showDelete, setShowDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: invitations = [], isLoading } = useQuery({
    queryKey: ['invitation', invitationId],
    queryFn: () => api.entities.ClientInvitation.filter({ id: invitationId }),
    enabled: !!invitationId,
  });
  const invitation = invitations[0];

  const [form, setForm] = useState(null);

  useEffect(() => {
    if (invitation && !form) {
      setForm({
        full_name: invitation.full_name || '',
        phone: invitation.phone || '',
        date_of_birth: invitation.date_of_birth || '',
        height_cm: invitation.height_cm || '',
        weight_kg: invitation.weight_kg || '',
        starting_weight_kg: invitation.starting_weight_kg || '',
        goal: invitation.goal || '',
        medical_conditions: invitation.medical_conditions || '',
        allergies: invitation.allergies || '',
        program_name: invitation.program_name || 'Phase 1',
        program_duration_weeks: invitation.program_duration_weeks || 4,
        program_start_date: invitation.program_start_date || '',
        program_end_date: invitation.program_end_date || '',
        payment_due_date: invitation.payment_due_date || '',
        payment_status: invitation.payment_status || 'not_paid',
        welcome_message: invitation.welcome_message || '',
      });
    }
  }, [invitation]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleDateChange = (field, value) => {
    setForm(prev => {
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

  const save = useMutation({
    mutationFn: () => api.entities.ClientInvitation.update(invitationId, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitation', invitationId] });
      queryClient.invalidateQueries({ queryKey: ['pending-invitations'] });
      toast.success('Client profile updated!');
    },
    onError: (err) => toast.error('Save failed: ' + (err?.message || '')),
  });

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await api.entities.ClientInvitation.delete(invitationId);
      toast.success('Invitation removed. Email can now be reused.');
      navigate('/clients');
    } catch (err) {
      toast.error('Delete failed: ' + (err?.message || ''));
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading || !form) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!invitation) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-muted-foreground">Invitation not found.</p>
        <Button variant="outline" onClick={() => navigate('/clients')}>Back to Clients</Button>
      </div>
    );
  }

  const age = form.date_of_birth ? differenceInYears(new Date(), new Date(form.date_of_birth)) : null;
  const resolvedStart = form.program_start_date || todayISO();
  const resolvedEnd = form.program_end_date || calcEndDate(resolvedStart, form.program_duration_weeks || 4);
  const resolvedPaymentDue = form.payment_due_date || calcPaymentDueDate(resolvedStart);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/clients')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{form.full_name || 'Invited Client'}</h1>
          <p className="text-muted-foreground text-sm">{invitation.email}</p>
        </div>
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <Mail className="w-3 h-3" />Invited â€” Awaiting Registration
        </Badge>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive border-destructive/40 hover:bg-destructive hover:text-white gap-1.5"
          onClick={() => setShowDelete(true)}
        >
          <Trash2 className="w-4 h-4" />Remove
        </Button>
      </div>

      <div className="rounded-xl bg-primary/5 border border-primary/10 px-4 py-3 text-sm text-primary">
        This client has been invited but hasn't registered yet. All data entered here will be automatically applied to their profile when they sign up.
      </div>

      <div className="space-y-4">
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">Contact Info</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Full Name</Label>
              <Input value={form.full_name} onChange={e => set('full_name', e.target.value)} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
            <div>
              <Label>Date of Birth</Label>
              <div className="relative">
                <Input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} />
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
            <div><Label>Height (cm)</Label><Input type="number" value={form.height_cm} onChange={e => set('height_cm', Number(e.target.value))} /></div>
            <div><Label>Current Weight (kg)</Label><Input type="number" value={form.weight_kg} onChange={e => set('weight_kg', Number(e.target.value))} /></div>
            <div><Label>Starting Weight (kg)</Label><Input type="number" value={form.starting_weight_kg} onChange={e => set('starting_weight_kg', Number(e.target.value))} /></div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">Goals & Health</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div><Label>Goal</Label><Input value={form.goal} onChange={e => set('goal', e.target.value)} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label>Medical Conditions</Label><Textarea rows={2} value={form.medical_conditions} onChange={e => set('medical_conditions', e.target.value)} /></div>
              <div><Label>Allergies</Label><Textarea rows={2} value={form.allergies} onChange={e => set('allergies', e.target.value)} /></div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">Program & Payment</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label>Program Name</Label>
              <Input value={form.program_name} onChange={e => set('program_name', e.target.value)} />
            </div>
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={form.program_start_date} onChange={e => handleDateChange('program_start_date', e.target.value)} />
              {form.program_start_date && <p className="text-xs text-muted-foreground mt-1">{formatDate(form.program_start_date)}</p>}
            </div>
            <div>
              <Label>Duration (weeks)</Label>
              <Input type="number" min={1} value={form.program_duration_weeks} onChange={e => handleDateChange('program_duration_weeks', e.target.value)} />
            </div>
            <div>
              <Label>End Date <span className="text-xs text-muted-foreground font-normal">(auto)</span></Label>
              <Input type="date" value={resolvedEnd} readOnly className="bg-muted/50" />
              <p className="text-xs text-muted-foreground mt-1">{formatDate(resolvedEnd)}</p>
            </div>
            <div>
              <Label>Payment Due <span className="text-xs text-muted-foreground font-normal">(start + 5 days)</span></Label>
              <Input type="date" value={resolvedPaymentDue} readOnly className="bg-muted/50" />
              <p className="text-xs text-muted-foreground mt-1">{formatDate(resolvedPaymentDue)}</p>
            </div>
            <div>
              <Label>Payment Status</Label>
              <Select value={form.payment_status} onValueChange={v => set('payment_status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="not_paid">Not Paid</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Welcome Message</Label>
              <Textarea rows={3} value={form.welcome_message} onChange={e => set('welcome_message', e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Button onClick={() => save.mutate()} disabled={save.isPending} className="gap-2">
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {save.isPending ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Delete confirmation */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <DialogTitle className="text-destructive">Remove Invitation</DialogTitle>
            </div>
            <DialogDescription className="text-left">
              This will remove the invitation for <strong>{invitation.email}</strong>. The email address will become available to invite again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={isDeleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting} className="gap-2">
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {isDeleting ? 'Removing...' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
