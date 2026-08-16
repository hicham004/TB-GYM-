import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Clock, Mail, Phone, MessageSquare, Loader2, ShieldCheck } from 'lucide-react';
import { formatDateTime } from '@/lib/dateUtils';
import { toast } from 'sonner';

const statusConfig = {
  pending:  { label: 'Pending',  variant: 'secondary',    icon: Clock },
  approved: { label: 'Approved', variant: 'default',      icon: CheckCircle2 },
  rejected: { label: 'Rejected', variant: 'destructive',  icon: XCircle },
};

export default function AccessRequests() {
  const queryClient = useQueryClient();
  const [processingId, setProcessingId] = useState(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['access-requests'],
    queryFn: () => api.entities.AccessRequest.list('-created_date'),
  });

  const pending  = requests.filter(r => r.status === 'pending');
  const reviewed = requests.filter(r => r.status !== 'pending');

  const approve = useMutation({
    mutationFn: async (req) => {
      setProcessingId(req.id);

      // Remove old invitations for this email to allow fresh start
      const oldInvitations = await api.entities.ClientInvitation.filter({ email: req.email }).catch(() => []);
      await Promise.all(oldInvitations.map(inv => api.entities.ClientInvitation.delete(inv.id)));

      // Create a ClientInvitation so the client appears immediately in the client list
      await api.entities.ClientInvitation.create({
        full_name: req.full_name || '',
        email: req.email,
        phone: req.phone || undefined,
        program_name: 'Phase 1',
        program_duration_weeks: 4,
        payment_status: 'not_paid',
        status: 'pending',
      });

      // Send platform invitation
      await api.users.inviteUser(req.email, 'user');

      // Update request status
      await api.entities.AccessRequest.update(req.id, {
        status: 'approved',
        reviewed_at: new Date().toISOString(),
      });
    },
    onSuccess: (_, req) => {
      queryClient.invalidateQueries({ queryKey: ['access-requests'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['pending-invitations'] });
      toast.success(`Approved and invitation sent to ${req.email}`);
    },
    onError: (err, req) => {
      const msg = err?.message || '';
      if (msg.toLowerCase().includes('already')) {
        api.entities.AccessRequest.update(req.id, { status: 'approved', reviewed_at: new Date().toISOString() })
          .then(() => queryClient.invalidateQueries({ queryKey: ['access-requests'] }));
        toast.info('User already has an account or invitation. Request marked as approved.');
      } else {
        toast.error('Failed to approve: ' + msg);
      }
    },
    onSettled: () => setProcessingId(null),
  });

  const reject = useMutation({
    mutationFn: async (req) => {
      setProcessingId(req.id);
      await api.entities.AccessRequest.update(req.id, {
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-requests'] });
      toast.success('Request rejected.');
    },
    onError: (err) => toast.error('Failed to reject: ' + (err?.message || '')),
    onSettled: () => setProcessingId(null),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Access Requests</h1>
          <p className="text-muted-foreground mt-0.5">
            {pending.length} pending request{pending.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Pending */}
      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Clock className="w-4 h-4" /> Pending Review
          </h2>
          {pending.map(req => (
            <RequestCard
              key={req.id}
              req={req}
              isProcessing={processingId === req.id}
              onApprove={() => approve.mutate(req)}
              onReject={() => reject.mutate(req)}
            />
          ))}
        </section>
      )}

      {pending.length === 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center text-muted-foreground">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium">All caught up!</p>
            <p className="text-sm mt-1">No pending access requests.</p>
          </CardContent>
        </Card>
      )}

      {/* Reviewed */}
      {reviewed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Previously Reviewed
          </h2>
          {reviewed.map(req => (
            <RequestCard key={req.id} req={req} isProcessing={false} readOnly />
          ))}
        </section>
      )}
    </div>
  );
}

function RequestCard({ req, isProcessing, onApprove, onReject, readOnly }) {
  const cfg = statusConfig[req.status] || statusConfig.pending;
  const StatusIcon = cfg.icon;

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{req.full_name}</span>
              <Badge variant={cfg.variant} className="gap-1 text-xs">
                <StatusIcon className="w-3 h-3" />
                {cfg.label}
              </Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 flex-shrink-0" />{req.email}
              </span>
              {req.phone && (
                <span className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 flex-shrink-0" />{req.phone}
                </span>
              )}
            </div>
            {req.message && (
              <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span className="italic">"{req.message}"</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Submitted {req.created_date ? formatDateTime(req.created_date) : 'â€”'}
              {req.reviewed_at && ` Â· Reviewed ${formatDateTime(req.reviewed_at)}`}
            </p>
          </div>

          {!readOnly && (
            <div className="flex gap-2 flex-shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="text-destructive border-destructive/30 hover:bg-destructive hover:text-white gap-1.5"
                onClick={onReject}
                disabled={isProcessing}
              >
                {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                Reject
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={onApprove}
                disabled={isProcessing}
              >
                {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Approve &amp; Invite
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
