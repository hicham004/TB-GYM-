import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/api/localClient';
import { CheckCircle2, Clock, Loader2, ShieldCheck, XCircle } from 'lucide-react';

const UserNotRegisteredError = () => {
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true); // start loading while we check status
  const [submitting, setSubmitting] = useState(false);
  const [existingRequest, setExistingRequest] = useState(null); // null | request object
  const [submitted, setSubmitted] = useState(false);

  // Try to get the user's own info and any existing request
  useEffect(() => {
    const init = async () => {
      try {
        // Try to get current user info (email is known from auth token)
        const me = await api.auth.me().catch(() => null);
        if (me?.email) {
          setUserEmail(me.email);
          setUserName(me.full_name || '');
        }

        // Check if an access request already exists for this email
        if (me?.email) {
          const existing = await api.entities.AccessRequest.filter({ email: me.email }).catch(() => []);
          if (existing.length > 0) {
            // Sort by newest first
            const sorted = [...existing].sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
            setExistingRequest(sorted[0]);
          }
        }
      } catch {
        // ignore errors â€” best-effort
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleSubmit = async () => {
    if (!userEmail.trim()) return;
    setSubmitting(true);
    try {
      // Create the access request
      const req = await api.entities.AccessRequest.create({
        full_name: userName.trim() || userEmail.trim(),
        email: userEmail.trim().toLowerCase(),
        phone: phone.trim(),
        message: message.trim(),
        status: 'pending',
      });

      // Notify all admins
      try {
        const admins = await api.entities.User.filter({ role: 'admin' });
        await Promise.all(admins.map(admin =>
          api.entities.Notification.create({
            user_id: admin.id,
            title: 'New Access Request',
            message: `${userName.trim() || userEmail.trim()} (${userEmail.trim()}) has requested access.`,
            type: 'general',
            read: false,
          })
        ));
      } catch {
        // non-critical
      }

      setExistingRequest(req);
      setSubmitted(true);
    } catch (err) {
      alert('Failed to submit: ' + (err?.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Checking your access status...</p>
        </div>
      );
    }

    // Already has a pending request
    if (existingRequest && existingRequest.status === 'pending') {
      return (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="w-14 h-14 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
            <Clock className="w-7 h-7 text-orange-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Request Pending</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Your access request is still pending approval from the coach.
              You'll receive an invitation email once approved.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Submitted for: <strong>{existingRequest.email}</strong>
            </p>
          </div>
          <Button variant="outline" className="w-full" onClick={() => api.auth.logout()}>
            Sign Out
          </Button>
        </div>
      );
    }

    // Request was rejected
    if (existingRequest && existingRequest.status === 'rejected') {
      return (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
            <XCircle className="w-7 h-7 text-destructive" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Access Denied</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Your access request was not approved. Please contact the coach directly for more information.
            </p>
          </div>
          <Button variant="outline" className="w-full" onClick={() => api.auth.logout()}>
            Sign Out
          </Button>
        </div>
      );
    }

    // Request was approved but user somehow still unregistered â€” shouldn't happen normally
    if (existingRequest && existingRequest.status === 'approved') {
      return (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <CheckCircle2 className="w-7 h-7 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Request Approved!</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Your request was approved. Please check your email for an invitation link, or sign out and sign back in.
            </p>
          </div>
          <Button variant="outline" className="w-full" onClick={() => api.auth.logout()}>
            Sign Out &amp; Re-Login
          </Button>
        </div>
      );
    }

    // Just submitted successfully
    if (submitted) {
      return (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <CheckCircle2 className="w-7 h-7 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Request Submitted!</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              The coach has been notified. You'll receive an email invitation once approved.
            </p>
          </div>
          <Button variant="outline" className="w-full" onClick={() => api.auth.logout()}>
            Sign Out
          </Button>
        </div>
      );
    }

    // Show the request form
    return (
      <>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Access Restricted</h1>
            <p className="text-muted-foreground text-sm">This is a private coaching platform. Request access below.</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label>Full Name</Label>
            <Input
              placeholder="Your full name"
              value={userName}
              onChange={e => setUserName(e.target.value)}
            />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={userEmail}
              onChange={e => setUserEmail(e.target.value)}
              readOnly={!!userEmail}
              className={userEmail ? 'bg-muted' : ''}
            />
          </div>
          <div>
            <Label>Phone (optional)</Label>
            <Input
              placeholder="+1 234 567 8900"
              value={phone}
              onChange={e => setPhone(e.target.value)}
            />
          </div>
          <div>
            <Label>Message (optional)</Label>
            <Textarea
              placeholder="Tell the coach about your goals..."
              rows={2}
              value={message}
              onChange={e => setMessage(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-3 mt-4">
          <Button
            className="flex-1 gap-2"
            onClick={handleSubmit}
            disabled={submitting || !userEmail.trim()}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {submitting ? 'Submitting...' : 'Request Access'}
          </Button>
          <Button variant="outline" onClick={() => api.auth.logout()}>
            Sign Out
          </Button>
        </div>
      </>
    );
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-background to-muted/30 p-6">
      <div className="max-w-md w-full bg-card rounded-2xl shadow-lg border border-border p-8">
        {renderContent()}
      </div>
    </div>
  );
};

export default UserNotRegisteredError;
