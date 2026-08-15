import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, ClipboardList, Trash2, Copy, Users, ChevronDown, ChevronRight, ExternalLink, Folder, FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

export default function Programs() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', num_weeks: 4, num_days_per_week: 5 });
  const [duplicating, setDuplicating] = useState(null);
  const [dupName, setDupName] = useState('');
  const [expandedClients, setExpandedClients] = useState({});

  const { data: programs = [] } = useQuery({
    queryKey: ['programs'],
    queryFn: () => api.entities.TrainingProgram.list('-created_date'),
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['all-users'],
    queryFn: () => api.entities.User.list(),
  });

  const createProgram = useMutation({
    mutationFn: (data) => api.entities.TrainingProgram.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programs'] });
      setShowCreate(false);
      setForm({ name: '', description: '', num_weeks: 4, num_days_per_week: 5 });
      toast.success('Program created');
    },
  });

  const deleteProgram = useMutation({
    mutationFn: (id) => api.entities.TrainingProgram.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programs'] });
      toast.success('Program deleted');
    },
  });

  const duplicateProgram = useMutation({
    mutationFn: async ({ program, newName }) => {
      const newProg = await api.entities.TrainingProgram.create({
        name: newName,
        description: program.description,
        num_weeks: program.num_weeks,
        num_days_per_week: program.num_days_per_week,
        admin_notes: program.admin_notes,
      });
      const exercises = await api.entities.ProgramExercise.filter({ program_id: program.id });
      if (exercises.length > 0) {
        await Promise.all(exercises.map(ex => {
          const { id, created_date, updated_date, created_by, program_id, ...rest } = ex;
          return api.entities.ProgramExercise.create({ ...rest, program_id: newProg.id, completed: false });
        }));
      }
      return newProg;
    },
    onSuccess: (newProg) => {
      queryClient.invalidateQueries({ queryKey: ['programs'] });
      setDuplicating(null);
      setDupName('');
      toast.success(`Program duplicated as "${newProg.name}"`);
    },
  });

  // Templates = programs without a client assignment
  const templates = programs.filter(p => !p.assigned_client_id);
  // Client programs = programs assigned to a specific client
  const clientPrograms = programs.filter(p => !!p.assigned_client_id);

  // Group client programs by client id
  const byClient = {};
  clientPrograms.forEach(prog => {
    if (!byClient[prog.assigned_client_id]) byClient[prog.assigned_client_id] = [];
    byClient[prog.assigned_client_id].push(prog);
  });

  const userById = Object.fromEntries(allUsers.map(u => [u.id, u]));

  const toggleClient = (id) => setExpandedClients(p => ({ ...p, [id]: !p[id] }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Training Programs</h1>
          <p className="text-muted-foreground mt-1">{templates.length} templates Â· {clientPrograms.length} client copies</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />New Program</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Program</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Push Pull Legs" /></div>
              <div><Label>Description</Label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Weeks</Label><Input type="number" min={1} max={24} value={form.num_weeks} onChange={e => setForm(p => ({ ...p, num_weeks: Number(e.target.value) }))} /></div>
                <div><Label>Days/Week</Label><Input type="number" min={1} max={7} value={form.num_days_per_week} onChange={e => setForm(p => ({ ...p, num_days_per_week: Number(e.target.value) }))} /></div>
              </div>
              <Button onClick={() => createProgram.mutate(form)} disabled={!form.name} className="w-full">Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates" className="gap-2"><ClipboardList className="w-4 h-4" />Templates</TabsTrigger>
          <TabsTrigger value="client-programs" className="gap-2">
            <Users className="w-4 h-4" />Client Programs
            {clientPrograms.length > 0 && (
              <Badge className="bg-primary/15 text-primary border-0 text-xs px-1.5">{clientPrograms.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* â”€â”€ Templates Tab â”€â”€ */}
        <TabsContent value="templates" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(prog => (
              <Card key={prog.id} className="border-0 shadow-sm hover:shadow-lg transition-all group">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <Link to={`/programs/${prog.id}`} className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                          <ClipboardList className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold">{prog.name}</h3>
                          <p className="text-xs text-muted-foreground">{prog.num_weeks} weeks Â· {prog.num_days_per_week} days/week</p>
                        </div>
                      </div>
                      {prog.description && <p className="text-sm text-muted-foreground line-clamp-2">{prog.description}</p>}
                    </Link>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" title="Duplicate"
                        onClick={() => { setDuplicating(prog); setDupName(`${prog.name} (Copy)`); }}>
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteProgram.mutate(prog.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {templates.length === 0 && (
            <div className="text-center py-20 text-muted-foreground">
              <ClipboardList className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">No templates yet</p>
              <p className="text-sm">Create your first training program template</p>
            </div>
          )}
        </TabsContent>

        {/* â”€â”€ Client Programs Tab â”€â”€ */}
        <TabsContent value="client-programs" className="mt-4">
          <div className="space-y-3">
            {Object.entries(byClient).map(([clientId, progs]) => {
              const user = userById[clientId];
              const clientName = user?.full_name || user?.email || clientId;
              const isOpen = expandedClients[clientId];
              return (
                <div key={clientId} className="rounded-xl border border-border overflow-hidden">
                  {/* Folder header */}
                  <button
                    className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors text-left"
                    onClick={() => toggleClient(clientId)}
                  >
                    {isOpen
                      ? <FolderOpen className="w-5 h-5 text-primary flex-shrink-0" />
                      : <Folder className="w-5 h-5 text-muted-foreground flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-sm">{clientName}</span>
                      {user?.email && user?.full_name && (
                        <span className="text-xs text-muted-foreground ml-2">{user.email}</span>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs">{progs.length} program{progs.length !== 1 ? 's' : ''}</Badge>
                    {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  </button>

                  {/* Programs list */}
                  {isOpen && (
                    <div className="border-t border-border divide-y divide-border/60">
                      {progs.map(prog => (
                        <div key={prog.id} className="flex items-center gap-3 px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors">
                          <ClipboardList className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{prog.name}</p>
                            <p className="text-xs text-muted-foreground">{prog.num_weeks}w Â· {prog.num_days_per_week}d/week</p>
                          </div>
                          <Link to={`/programs/${prog.id}`}>
                            <Button variant="ghost" size="icon" title="Open program">
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost" size="icon"
                            className="text-destructive"
                            onClick={() => deleteProgram.mutate(prog.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {Object.keys(byClient).length === 0 && (
              <div className="text-center py-20 text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">No client programs yet</p>
                <p className="text-sm">Assign a template to a client from their profile to auto-create a copy here.</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
      {/* Duplicate Dialog */}
      <Dialog open={!!duplicating} onOpenChange={v => { if (!v) { setDuplicating(null); setDupName(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Duplicate Program</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Copying <span className="font-semibold text-foreground">{duplicating?.name}</span> â€” all weeks, days, and exercises will be duplicated.</p>
            <div>
              <Label>New Program Name</Label>
              <Input value={dupName} onChange={e => setDupName(e.target.value)} placeholder="e.g. Push Pull Legs v2" />
            </div>
            <Button
              className="w-full"
              disabled={!dupName || duplicateProgram.isPending}
              onClick={() => duplicateProgram.mutate({ program: duplicating, newName: dupName })}
            >
              {duplicateProgram.isPending ? 'Duplicating...' : 'Duplicate Program'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
