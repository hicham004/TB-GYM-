import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Save, MessageSquare, User, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * DayNotes â€” renders coach note + client note for a specific program day.
 * isAdmin=true  â†’ can edit coach_note, sees client_note as read-only
 * isAdmin=false â†’ can edit client_note, sees coach_note as read-only
 */
export default function DayNotes({ programId, clientId, week, day, isAdmin }) {
  const queryClient = useQueryClient();
  const queryKey = ['day-note', programId, clientId, week, day];

  const [coachDraft, setCoachDraft] = useState('');
  const [clientDraft, setClientDraft] = useState('');

  const { data: notes = [] } = useQuery({
    queryKey,
    queryFn: () =>
      api.entities.DayNote.filter({
        program_id: programId,
        client_id: clientId,
        week,
        day,
      }),
    enabled: !!programId && !!clientId,
  });

  const note = notes[0] || null;

  useEffect(() => {
    setCoachDraft(note?.coach_note || '');
    setClientDraft(note?.client_note || '');
  }, [note?.id, note?.coach_note, note?.client_note]);

  const saveNote = useMutation({
    mutationFn: async (patch) => {
      if (note?.id) {
        return api.entities.DayNote.update(note.id, patch);
      } else {
        return api.entities.DayNote.create({
          program_id: programId,
          client_id: clientId,
          week,
          day,
          ...patch,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Note saved');
    },
    onError: (err) => toast.error('Failed to save: ' + (err?.message || '')),
  });

  const handleSaveCoach = () => saveNote.mutate({ coach_note: coachDraft });
  const handleSaveClient = () => saveNote.mutate({ client_note: clientDraft });

  const coachChanged = coachDraft !== (note?.coach_note || '');
  const clientChanged = clientDraft !== (note?.client_note || '');

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
      {/* Coach Note */}
      <Card className="border border-primary/20 shadow-none bg-primary/5">
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-primary">
            <MessageSquare className="w-3.5 h-3.5" />
            Coach Note
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 space-y-2">
          {isAdmin ? (
            <>
              <Textarea
                value={coachDraft}
                onChange={e => setCoachDraft(e.target.value)}
                placeholder="Add coaching instruction for this day..."
                rows={3}
                className="text-sm resize-none"
              />
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={!coachChanged || saveNote.isPending}
                onClick={handleSaveCoach}
              >
                {saveNote.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap min-h-[2rem]">
              {note?.coach_note || <span className="italic opacity-60">No coach note for this day</span>}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Client Note */}
      <Card className="border border-chart-3/20 shadow-none bg-chart-3/5">
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-chart-3">
            <User className="w-3.5 h-3.5" />
            Client Note
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 space-y-2">
          {!isAdmin ? (
            <>
              <Textarea
                value={clientDraft}
                onChange={e => setClientDraft(e.target.value)}
                placeholder="Add your own note for this day (e.g. shoulder pain, energy level)..."
                rows={3}
                className="text-sm resize-none"
              />
              <Button
                size="sm"
                className="h-7 text-xs gap-1 bg-chart-3 hover:bg-chart-3/90 text-white"
                disabled={!clientChanged || saveNote.isPending}
                onClick={handleSaveClient}
              >
                {saveNote.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap min-h-[2rem]">
              {note?.client_note || <span className="italic opacity-60">No client note for this day</span>}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
