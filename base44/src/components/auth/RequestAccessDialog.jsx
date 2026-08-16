import React, { useState } from 'react';
import { api } from '@/api/localClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

export default function RequestAccessDialog({ open, onClose }) {
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', message: '' });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleClose = () => {
    if (loading) return;
    setForm({ full_name: '', email: '', phone: '', message: '' });
    setDone(false);
    onClose();
  };

  const handleSubmit = async () => {
    if (!form.full_name.trim()) { toast.error('Full name is required'); return; }
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      toast.error('A valid email is required');
      return;
    }

    setLoading(true);
    try {
      await api.entities.AccessRequest.create({
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        message: form.message.trim(),
        status: 'pending',
      });

      // Notify admins about the new access request
      try {
        const admins = await api.entities.User.filter({ role: 'admin' });
        await Promise.all(admins.map(admin =>
          api.entities.Notification.create({
            user_id: admin.id,
            title: 'New Access Request',
            message: `${form.full_name.trim()} (${form.email.trim().toLowerCase()}) has submitted an access request.`,
            type: 'general',
            read: false,
          })
        ));
      } catch {
        // Non-critical â€” request was still submitted
      }

      setDone(true);
    } catch (err) {
      toast.error('Failed to submit request: ' + (err?.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        {done ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="w-9 h-9 text-green-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Request Submitted!</h2>
              <p className="text-muted-foreground mt-2 text-sm">
                Your access request has been sent to the coach for review. You'll receive an invitation email once approved.
              </p>
            </div>
            <Button onClick={handleClose} className="mt-2 w-full">Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                </div>
                <DialogTitle>Request Access</DialogTitle>
              </div>
              <DialogDescription>
                This is a private platform. Submit your details and the coach will review your request.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Full Name <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="Your full name"
                  value={form.full_name}
                  onChange={e => set('full_name', e.target.value)}
                />
              </div>
              <div>
                <Label>Email Address <span className="text-destructive">*</span></Label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={e => set('email', e.target.value)}
                />
              </div>
              <div>
                <Label>Phone Number</Label>
                <Input
                  placeholder="+1 234 567 8900"
                  value={form.phone}
                  onChange={e => set('phone', e.target.value)}
                />
              </div>
              <div>
                <Label>Message (Optional)</Label>
                <Textarea
                  placeholder="Tell the coach about your goals..."
                  rows={3}
                  value={form.message}
                  onChange={e => set('message', e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={handleClose} disabled={loading} className="flex-1">Cancel</Button>
              <Button
                onClick={handleSubmit}
                disabled={loading || !form.full_name || !form.email}
                className="flex-1 gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loading ? 'Submitting...' : 'Submit Request'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
