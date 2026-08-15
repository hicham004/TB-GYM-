import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { api } from '@/api/localClient';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Mail, MessageCircle } from 'lucide-react';
import { formatDate, calcEndDate, calcPaymentDueDate, todayISO } from '@/lib/dateUtils';
import PhoneInput from './PhoneInput';

const DURATION_OPTIONS = [2, 4, 6, 8, 12, 16];

function calcAge(dob) {
  if (!dob) return null;
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

const defaultForm = {
  full_name: '',
  email: '',
  phone: '',
  date_of_birth: '',
  height_cm: '',
  weight_kg: '',
  starting_weight_kg: '',
  goal: '',
  medical_conditions: '',
  allergies: '',
  program_name: '',
  program_duration_weeks: 4,
  program_start_date: '',
  payment_status: 'not_paid',
  welcome_message: '',
  invite_via: ['email'], // 'email' and/or 'whatsapp'
};

export default function AddClientDialog({ open, onOpenChange, onSuccess }) {
  const [form, setForm] = useState(defaultForm);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [customDuration, setCustomDuration] = useState(false);

  const toggleInviteVia = (method) => {
    setForm(p => {
      const current = p.invite_via || ['email'];
      if (current.includes(method)) {
        // Don't allow deselecting all
        if (current.length === 1) return p;
        return { ...p, invite_via: current.filter(m => m !== method) };
      }
      return { ...p, invite_via: [...current, method] };
    });
  };

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const resolvedStart = form.program_start_date || todayISO();
  const endDate = calcEndDate(resolvedStart, form.program_duration_weeks || 4);
  const paymentDueDate = calcPaymentDueDate(resolvedStart);
  const age = calcAge(form.date_of_birth);

  const handleClose = () => {
    if (loading) return;
    setForm(defaultForm);
    setDone(false);
    setCustomDuration(false);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!form.full_name.trim()) { toast.error('Full name is required'); return; }
    if (!form.email) { toast.error('Email is required'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { toast.error('Please enter a valid email address'); return; }
    const inviteVia = form.invite_via || ['email'];
    if (inviteVia.includes('whatsapp')) {
      if (!form.phone) { toast.error('Phone number is required for WhatsApp invitation'); return; }
      const digits = form.phone.replace(/\D/g, '');
      if (digits.length < 7) { toast.error('Please enter a valid phone number for WhatsApp'); return; }
    }

    setLoading(true);
    try {
      const today = todayISO();
      const resolvedStartFinal = form.program_start_date || today;
      const resolvedEnd = calcEndDate(resolvedStartFinal, form.program_duration_weeks || 4);
      const resolvedPaymentDue = calcPaymentDueDate(resolvedStartFinal);
      const effectiveWeight = form.weight_kg || form.starting_weight_kg || '';

      // 1. Remove any old pending invitations for this email (handle deleted-email reuse)
      const oldInvitations = await api.entities.ClientInvitation.filter({ email: form.email });
      await Promise.all(oldInvitations.map(inv => api.entities.ClientInvitation.delete(inv.id)));

      // 2. Save invitation record â€” this IS the client profile until they register
      await api.entities.ClientInvitation.create({
        full_name: form.full_name || undefined,
        email: form.email,
        phone: form.phone || undefined,
        date_of_birth: form.date_of_birth || undefined,
        height_cm: form.height_cm ? Number(form.height_cm) : undefined,
        weight_kg: effectiveWeight ? Number(effectiveWeight) : undefined,
        starting_weight_kg: form.starting_weight_kg ? Number(form.starting_weight_kg) : undefined,
        goal: form.goal || undefined,
        medical_conditions: form.medical_conditions || undefined,
        allergies: form.allergies || undefined,
        program_name: form.program_name || 'Phase 1',
        program_duration_weeks: form.program_duration_weeks || 4,
        program_start_date: resolvedStartFinal,
        program_end_date: resolvedEnd,
        payment_due_date: resolvedPaymentDue,
        payment_status: form.payment_status,
        welcome_message: form.welcome_message || undefined,
        status: 'pending',
      });

      // 3. Send the platform invitation (email)
      if (inviteVia.includes('email')) {
        await api.users.inviteUser(form.email, 'user');
      }

      // 3b. Open WhatsApp if selected
      if (inviteVia.includes('whatsapp') && form.phone) {
        const digits = form.phone.replace(/\D/g, '');
        const appName = 'FitCoach';
        const welcomeText = form.welcome_message
          ? `\n\n"${form.welcome_message}"`
          : '';
        const msg = `Hello ${form.full_name || 'there'},\n\nYour coach has invited you to access your personal coaching portal on ${appName}.${welcomeText}\n\nPlease check your email (${form.email}) for your invitation link to activate your account and get started.\n\nLooking forward to working with you! ðŸ’ª`;
        const waUrl = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
        window.open(waUrl, '_blank');
      }

      // 4. Try to immediately sync data onto the user record if it already exists
      try {
        const users = await api.entities.User.filter({ email: form.email });
        if (users[0]) {
          const userId = users[0].id;
          await api.entities.User.update(userId, {
            phone: form.phone || undefined,
            date_of_birth: form.date_of_birth || undefined,
            height_cm: form.height_cm ? Number(form.height_cm) : undefined,
            weight_kg: effectiveWeight ? Number(effectiveWeight) : undefined,
            starting_weight_kg: form.starting_weight_kg ? Number(form.starting_weight_kg) : undefined,
            goal: form.goal || undefined,
            medical_conditions: form.medical_conditions || undefined,
            allergies: form.allergies || undefined,
            payment_status: form.payment_status,
            payment_due_date: resolvedPaymentDue,
            program_start_date: resolvedStartFinal,
            program_end_date: resolvedEnd,
            program_duration_weeks: form.program_duration_weeks || 4,
            account_start_date: today,
            is_deleted: false,
            is_blocked: false,
          });

          // Create first program cycle
          await api.entities.ProgramCycle.create({
            client_id: userId,
            program_name: form.program_name || 'Phase 1',
            start_date: resolvedStartFinal,
            end_date: resolvedEnd,
            duration_weeks: form.program_duration_weeks || 4,
            payment_due_date: resolvedPaymentDue,
            payment_status: form.payment_status,
            status: 'active',
          });

          // Mark invitation as synced
          const invitations = await api.entities.ClientInvitation.filter({ email: form.email });
          if (invitations[0]) {
            await api.entities.ClientInvitation.update(invitations[0].id, { status: 'synced' });
          }
        }
      } catch {
        // Profile sync will happen when client first logs in â€” invitation data is stored
      }

      setDone(true);
      const channels = inviteVia.join(' & ');
      toast.success(`Invitation sent via ${channels} to ${form.full_name || form.email}!`);
      onSuccess?.();
    } catch (err) {
      const msg = err?.message || String(err);
      if (msg.toLowerCase().includes('already')) {
        toast.error('This email is already registered or invited.');
      } else {
        toast.error('Failed to send invitation: ' + msg);
      }
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-md text-center py-10">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Invitation Sent!</h2>
              <p className="text-muted-foreground mt-1">Client profile created for</p>
              <p className="font-semibold text-primary mt-1">{form.full_name || form.email}</p>
              <p className="text-sm text-muted-foreground mt-1">{form.email}</p>
              <p className="text-sm text-muted-foreground mt-2">
                They appear in the client dashboard immediately.
                {(form.invite_via || ['email']).includes('email') && ' Invitation email sent.'}
                {(form.invite_via || ['email']).includes('whatsapp') && ' WhatsApp message opened.'}
              </p>
            </div>
            <div className="flex gap-3 mt-2">
              <Button variant="outline" onClick={handleClose}>Close</Button>
              <Button onClick={() => { setForm(defaultForm); setDone(false); }}>Invite Another</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Add New Client</DialogTitle>
          <p className="text-sm text-muted-foreground">All data is saved immediately to the client profile. Choose how to invite below.</p>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Contact Info */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Contact Info</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Full Name <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="John Doe"
                  value={form.full_name}
                  onChange={e => set('full_name', e.target.value)}
                />
              </div>
              <div>
                <Label>Email <span className="text-destructive">*</span></Label>
                <Input
                  type="email"
                  placeholder="client@email.com"
                  value={form.email}
                  onChange={e => set('email', e.target.value)}
                  className={!form.email ? '' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) ? 'border-destructive' : 'border-green-500'}
                />
              </div>
              <div>
                <Label>Phone Number</Label>
                <PhoneInput value={form.phone} onChange={v => set('phone', v)} />
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
            </div>
          </section>

          {/* Physical Stats */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Physical Stats</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div><Label>Height (cm)</Label><Input type="number" placeholder="175" value={form.height_cm} onChange={e => set('height_cm', e.target.value)} /></div>
              <div><Label>Current Weight (kg)</Label><Input type="number" placeholder="80" value={form.weight_kg} onChange={e => set('weight_kg', e.target.value)} /></div>
              <div><Label>Starting Weight (kg)</Label><Input type="number" placeholder="85" value={form.starting_weight_kg} onChange={e => set('starting_weight_kg', e.target.value)} /></div>
            </div>
          </section>

          {/* Goals & Health */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Goals & Health</h3>
            <div><Label>Goal</Label><Input placeholder="e.g. Lose 10kg, build muscle..." value={form.goal} onChange={e => set('goal', e.target.value)} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Medical Conditions</Label><Textarea placeholder="Any relevant medical info..." rows={2} value={form.medical_conditions} onChange={e => set('medical_conditions', e.target.value)} /></div>
              <div><Label>Allergies</Label><Textarea placeholder="Food or supplement allergies..." rows={2} value={form.allergies} onChange={e => set('allergies', e.target.value)} /></div>
            </div>
          </section>

          {/* Program Info */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Program Information</h3>
            <div>
              <Label>Program Name</Label>
              <Input placeholder="e.g. Meso 1, Phase 1, Cut Program..." value={form.program_name} onChange={e => set('program_name', e.target.value)} />
            </div>
            <div>
              <Label>Start Date <span className="text-muted-foreground font-normal text-xs">(leave empty to use today)</span></Label>
              <Input
                type="date"
                value={form.program_start_date}
                onChange={e => set('program_start_date', e.target.value)}
                className="w-48"
              />
            </div>
            <div>
              <Label>Duration (weeks)</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {DURATION_OPTIONS.map(w => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => { set('program_duration_weeks', w); setCustomDuration(false); }}
                    className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all
                      ${form.program_duration_weeks === w && !customDuration
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:border-primary/50'}`}
                  >
                    {w}w
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCustomDuration(true)}
                  className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all
                    ${customDuration ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary/50'}`}
                >
                  Custom
                </button>
              </div>
            </div>
            {customDuration && (
              <div className="flex items-center gap-2">
                <Input type="number" min="1" className="w-28" placeholder="Weeks" value={form.program_duration_weeks} onChange={e => set('program_duration_weeks', Number(e.target.value))} />
                <span className="text-sm text-muted-foreground">weeks</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-muted/50 text-sm">
              <div><span className="text-muted-foreground">Start:</span> <span className="font-medium">{formatDate(resolvedStart)}{!form.program_start_date && <span className="text-xs text-muted-foreground ml-1">(today)</span>}</span></div>
              <div><span className="text-muted-foreground">End:</span> <span className="font-medium">{formatDate(endDate)}</span></div>
              <div><span className="text-muted-foreground">Duration:</span> <span className="font-medium">{form.program_duration_weeks} weeks</span></div>
              <div><span className="text-muted-foreground">Payment Due:</span> <span className="font-medium text-chart-4">{formatDate(paymentDueDate)}</span></div>
            </div>
            <p className="text-xs text-muted-foreground">Payment due date is automatically set to 5 days after the start date.</p>
          </section>

          {/* Payment */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Payment</h3>
            <div className="w-48">
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
          </section>

          {/* Welcome Message */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Welcome Message (Optional)</h3>
            <Textarea placeholder="Write a personal welcome message for your client..." rows={3} value={form.welcome_message} onChange={e => set('welcome_message', e.target.value)} />
          </section>
        </div>

        {/* Invite Method */}
        <section className="space-y-3 pt-2 border-t">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Send Invitation Via</h3>
          <div className="flex gap-3">
            {[
              { id: 'email', label: 'Email', icon: Mail },
              { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
            ].map(({ id, label, icon: Icon }) => {
              const active = (form.invite_via || ['email']).includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleInviteVia(id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all
                    ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40 text-muted-foreground'}`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              );
            })}
          </div>
          {(form.invite_via || ['email']).includes('whatsapp') && !form.phone && (
            <p className="text-xs text-destructive">Phone number required for WhatsApp invitation.</p>
          )}
        </section>

        <div className="flex justify-end gap-3 pt-2 border-t">
          <Button variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading || !form.email || !form.full_name}>
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : 'Send Invitation'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
