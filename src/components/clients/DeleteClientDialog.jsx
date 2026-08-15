import React, { useState } from 'react';
import { api } from '@/api/localClient';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function DeleteClientDialog({ open, onClose, client, onDeleted }) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleClose = () => {
    if (isDeleting) return;
    onClose();
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const clientId = client.id;
      const clientEmail = client?.email?.toLowerCase?.() || '';

      // Fetch all related data in parallel
      const [
        programCycles,
        notifications,
        chatMessages,
        strengthRecords,
        weightLogs,
        dietDayLogs,
        categoryPermissions,
        invitations,
        subscriptions,
        programStrengthProfiles,
        dayNotes,
        accessRequests,
        assignedPrograms,
      ] = await Promise.all([
        api.entities.ProgramCycle.filter({ client_id: clientId }).catch(() => []),
        api.entities.Notification.filter({ user_id: clientId }).catch(() => []),
        api.entities.ChatMessage.filter({ client_id: clientId }).catch(() => []),
        api.entities.ClientStrengthRecord.filter({ client_id: clientId }).catch(() => []),
        api.entities.WeightLog.filter({ client_id: clientId }).catch(() => []),
        api.entities.DietDayLog.filter({ client_id: clientId }).catch(() => []),
        api.entities.CategoryPermission.filter({ client_id: clientId }).catch(() => []),
        clientEmail ? api.entities.ClientInvitation.filter({ email: clientEmail }).catch(() => []) : Promise.resolve([]),
        api.entities.ClientSubscription.filter({ client_id: clientId }).catch(() => []),
        api.entities.ProgramStrengthProfile.filter({ client_id: clientId }).catch(() => []),
        api.entities.DayNote.filter({ client_id: clientId }).catch(() => []),
        clientEmail ? api.entities.AccessRequest.filter({ email: clientEmail }).catch(() => []) : Promise.resolve([]),
        api.entities.TrainingProgram.filter({ assigned_client_id: clientId }).catch(() => []),
      ]);

      // For each assigned program, also delete exercises
      const programExercisesArrays = await Promise.all(
        assignedPrograms.map(p =>
          api.entities.ProgramExercise.filter({ program_id: p.id }).catch(() => [])
        )
      );
      const allProgramExercises = programExercisesArrays.flat();

      // Delete everything in parallel
      await Promise.all([
        ...programCycles.map(r => api.entities.ProgramCycle.delete(r.id)),
        ...notifications.map(r => api.entities.Notification.delete(r.id)),
        ...chatMessages.map(r => api.entities.ChatMessage.delete(r.id)),
        ...strengthRecords.map(r => api.entities.ClientStrengthRecord.delete(r.id)),
        ...weightLogs.map(r => api.entities.WeightLog.delete(r.id)),
        ...dietDayLogs.map(r => api.entities.DietDayLog.delete(r.id)),
        ...categoryPermissions.map(r => api.entities.CategoryPermission.delete(r.id)),
        ...invitations.map(r => api.entities.ClientInvitation.delete(r.id)),
        ...subscriptions.map(r => api.entities.ClientSubscription.delete(r.id)),
        ...programStrengthProfiles.map(r => api.entities.ProgramStrengthProfile.delete(r.id)),
        ...dayNotes.map(r => api.entities.DayNote.delete(r.id)),
        ...accessRequests.map(r => api.entities.AccessRequest.delete(r.id)),
        ...allProgramExercises.map(r => api.entities.ProgramExercise.delete(r.id)),
        ...assignedPrograms.map(r => api.entities.TrainingProgram.delete(r.id)),
      ]);

      // Block + soft-delete the user record
      await api.entities.User.update(clientId, {
        is_blocked: true,
        is_deleted: true,
        deleted_at: new Date().toISOString(),
      }).catch(() => {});

      toast.success(`${client.full_name || client.email} has been permanently deleted.`);
      onClose();
      onDeleted();
    } catch (err) {
      toast.error('Deletion failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <DialogTitle className="text-destructive">Delete Client Account</DialogTitle>
          </div>
          <DialogDescription className="space-y-3 text-left text-sm">
            <p>
              This action will <strong>permanently delete</strong> the client account and all associated data for:
            </p>
            <div className="p-3 rounded-lg bg-muted font-medium">
              {client?.full_name || 'Unknown'} â€” {client?.email}
            </div>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground text-xs">
              <li>Login credentials &amp; account access</li>
              <li>All assigned programs &amp; exercises</li>
              <li>Program cycles &amp; subscriptions</li>
              <li>Weight logs &amp; progress data</li>
              <li>Chat messages &amp; notifications</li>
              <li>Strength records, day notes &amp; diet logs</li>
              <li>Invitations &amp; access requests</li>
            </ul>
            <p className="font-semibold text-destructive">This action cannot be undone.</p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={isDeleting}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={isDeleting}
            onClick={handleDelete}
            className="gap-2"
          >
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {isDeleting ? 'Deleting...' : 'Permanently Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
