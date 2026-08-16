import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, Play, Trash2, Dumbbell, ChevronRight, ArrowLeft, FolderOpen, Layers, Download, Upload, Pencil, X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useUpload } from '@/lib/uploadContext';

const CATEGORY_ICONS = ['ðŸ’ª', 'ðŸ‹ï¸', 'ðŸ¦µ', 'ðŸ¤¸', 'ðŸ§˜', 'ðŸƒ', 'ðŸš´', 'ðŸ¤¼', 'ðŸ¥Š', 'âš¡'];

export default function ExerciseLibrary() {
  const queryClient = useQueryClient();
  const { user, isAdmin } = useCurrentUser();
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [search, setSearch] = useState('');
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [showExerciseDialog, setShowExerciseDialog] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: '', icon: 'ðŸ’ª' });
  const [exerciseForm, setExerciseForm] = useState({ title: '', category_id: '', description: '', video_url: '' });
  const [videoPlaying, setVideoPlaying] = useState(null);
  const [pendingVideoFile, setPendingVideoFile] = useState(null);
  const [editingExercise, setEditingExercise] = useState(null); // exercise being edited
  const [editForm, setEditForm] = useState({ title: '', description: '' });
  const [editVideoFile, setEditVideoFile] = useState(null);
  const { startUpload } = useUpload();

  const { data: categories = [] } = useQuery({
    queryKey: ['exercise-categories'],
    queryFn: () => api.entities.ExerciseCategory.list(),
  });

  const { data: exercises = [] } = useQuery({
    queryKey: ['exercises'],
    queryFn: () => api.entities.Exercise.list(),
  });

  // For clients: load their category permissions
  const { data: categoryPermissions = [] } = useQuery({
    queryKey: ['category-permissions', user?.id],
    queryFn: () => api.entities.CategoryPermission.filter({ client_id: user?.id }),
    enabled: !isAdmin && !!user?.id,
  });

  // Filter categories based on client permissions
  const visibleCategories = isAdmin
    ? categories
    : categories.filter(cat => {
        const perm = categoryPermissions.find(p => p.category_id === cat.id);
        // If no record exists, default to allowed
        return perm ? perm.allowed : true;
      });

  const createCategory = useMutation({
    mutationFn: (data) => api.entities.ExerciseCategory.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exercise-categories'] });
      setShowCategoryDialog(false);
      setCategoryForm({ name: '', icon: 'ðŸ’ª' });
      toast.success('Category created successfully!');
    },
  });

  const deleteCategory = useMutation({
    mutationFn: (id) => api.entities.ExerciseCategory.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exercise-categories'] });
      if (selectedCategoryId) setSelectedCategoryId(null);
      toast.success('Category deleted');
    },
  });

  const createExercise = useMutation({
    mutationFn: (data) => handleCreateExercise(data),
  });

  const deleteExercise = useMutation({
    mutationFn: (id) => api.entities.Exercise.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exercises'] });
      toast.success('Exercise deleted');
    },
  });

  const updateExercise = useMutation({
    mutationFn: ({ id, data }) => api.entities.Exercise.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exercises'] });
    },
  });
  const openEditExercise = (ex) => {
    setEditingExercise(ex);
    setEditForm({ title: ex.title, description: ex.description || '' });
    setEditVideoFile(null);
  };

  const handleSaveEdit = async () => {
    if (!editForm.title.trim()) { toast.error('Title is required'); return; }
    // Duplicate check (excluding current exercise)
    const duplicate = exercises.find(e => e.id !== editingExercise.id && e.title.trim().toLowerCase() === editForm.title.trim().toLowerCase() && e.category_id === editingExercise.category_id);
    if (duplicate) { toast.error('An exercise with this name already exists in this category.'); return; }

    await updateExercise.mutateAsync({ id: editingExercise.id, data: { title: editForm.title, description: editForm.description } });

    if (editVideoFile) {
      toast.info('Video uploading in background...');
      const id = editingExercise.id;
      startUpload(editVideoFile, {
        onComplete: async (url) => {
          await api.entities.Exercise.update(id, { video_url: url });
          queryClient.invalidateQueries({ queryKey: ['exercises'] });
          toast.success('Video updated!');
        },
        onError: () => toast.error('Video upload failed'),
      });
    }
    toast.success('Exercise updated!');
    setEditingExercise(null);
  };

  const handleRemoveVideo = async (ex) => {
    await updateExercise.mutateAsync({ id: ex.id, data: { video_url: '' } });
    toast.success('Video removed');
  };

  const handleVideoFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPendingVideoFile(file);
  };

  const handleCreateExercise = async (formData) => {
    // Duplicate check
    const duplicate = exercises.find(e =>
      e.title.trim().toLowerCase() === formData.title.trim().toLowerCase() &&
      e.category_id === formData.category_id
    );
    if (duplicate) {
      toast.error(`"${formData.title}" already exists in this category. Edit the existing exercise instead.`);
      return;
    }
    // Save exercise immediately without video
    const created = await api.entities.Exercise.create({ ...formData, video_url: '' });
    queryClient.invalidateQueries({ queryKey: ['exercises'] });
    setShowExerciseDialog(false);
    setExerciseForm({ title: '', category_id: '', description: '', video_url: '' });
    toast.success('Exercise created! Video uploading in background...');

    if (pendingVideoFile) {
      const file = pendingVideoFile;
      setPendingVideoFile(null);
      startUpload(file, {
        onComplete: async (url) => {
          await api.entities.Exercise.update(created.id, { video_url: url });
          queryClient.invalidateQueries({ queryKey: ['exercises'] });
          toast.success(`Video ready for ${formData.title}`);
        },
        onError: () => toast.error(`Video upload failed for ${formData.title}`),
      });
    }
  };

  const selectedCategory = categories.find(c => c.id === selectedCategoryId);

  const categoryExercises = selectedCategoryId
    ? exercises.filter(e => e.category_id === selectedCategoryId)
    : [];

  const filteredExercises = categoryExercises.filter(ex =>
    !search || ex.title?.toLowerCase().includes(search.toLowerCase())
  );

  // â”€â”€â”€ Category Grid View â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!selectedCategoryId) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Exercise Library</h1>
            <p className="text-muted-foreground mt-1">{visibleCategories.length} categories Â· {exercises.length} exercises</p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowCategoryDialog(true)}>
                <FolderOpen className="w-4 h-4 mr-2" />Add Category
              </Button>
              <Button size="sm" onClick={() => { setExerciseForm(p => ({ ...p, category_id: '' })); setPendingVideoFile(null); setShowExerciseDialog(true); }}>
                <Plus className="w-4 h-4 mr-2" />Add Exercise
              </Button>
            </div>
          )}
        </div>

        {visibleCategories.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Layers className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No categories available</p>
            <p className="text-sm">{isAdmin ? 'Create your first category to organize exercises' : 'Your coach has not granted access to any categories yet'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {visibleCategories.map(cat => {
              const count = exercises.filter(e => e.category_id === cat.id).length;
              return (
                <Card
                  key={cat.id}
                  className="border-0 shadow-sm hover:shadow-lg transition-all cursor-pointer group relative"
                  onClick={() => setSelectedCategoryId(cat.id)}
                >
                  <CardContent className="p-5 text-center">
                    <div className="text-4xl mb-3">{cat.icon || 'ðŸ’ª'}</div>
                    <h3 className="font-semibold text-sm leading-tight">{cat.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{count} exercise{count !== 1 ? 's' : ''}</p>
                    <div className="mt-3 flex items-center justify-center gap-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium">
                      View <ChevronRight className="w-3 h-3" />
                    </div>
                    {isAdmin && (
                      <button
                        onClick={e => { e.stopPropagation(); deleteCategory.mutate(cat.id); }}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-destructive"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Add Category Dialog (admin only) */}
        {isAdmin && (
          <>
            <Dialog open={showCategoryDialog} onOpenChange={setShowCategoryDialog}>
              <DialogContent>
                <DialogHeader><DialogTitle>New Category</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Category Name</Label>
                    <Input placeholder="e.g. Chest, Back, Legs..." value={categoryForm.name} onChange={e => setCategoryForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Icon</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {CATEGORY_ICONS.map(icon => (
                        <button
                          key={icon}
                          onClick={() => setCategoryForm(p => ({ ...p, icon }))}
                          className={`text-2xl p-2 rounded-lg border-2 transition-all ${categoryForm.icon === icon ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button onClick={() => createCategory.mutate(categoryForm)} disabled={!categoryForm.name} className="w-full">
                    Create Category
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={showExerciseDialog} onOpenChange={v => { setShowExerciseDialog(v); if (!v) setPendingVideoFile(null); }}>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>New Exercise</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div><Label>Title</Label><Input value={exerciseForm.title} onChange={e => setExerciseForm(p => ({ ...p, title: e.target.value }))} placeholder="Bench Press" /></div>
                  <div>
                    <Label>Category</Label>
                    <Select value={exerciseForm.category_id} onValueChange={v => setExerciseForm(p => ({ ...p, category_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Description (optional)</Label><Textarea value={exerciseForm.description} onChange={e => setExerciseForm(p => ({ ...p, description: e.target.value }))} rows={2} /></div>
                  <div>
                    <Label>Video <span className="text-xs text-muted-foreground font-normal">(uploads in background)</span></Label>
                    <Input type="file" accept="video/*" onChange={handleVideoFileSelect} />
                    {pendingVideoFile && <p className="text-xs text-primary mt-1 flex items-center gap-1"><Upload className="w-3 h-3" />{pendingVideoFile.name} â€” will upload after saving</p>}
                  </div>
                  <Button onClick={() => createExercise.mutate(exerciseForm)} disabled={!exerciseForm.title || !exerciseForm.category_id || createExercise.isPending} className="w-full">
                    Create Exercise
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    );
  }
  // â”€â”€â”€ Category Detail View â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => { setSelectedCategoryId(null); setSearch(''); }}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {selectedCategory?.icon} {selectedCategory?.name}
            </h1>
            <p className="text-muted-foreground mt-0.5">{categoryExercises.length} exercises</p>
          </div>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => {
            setExerciseForm({ title: '', category_id: selectedCategoryId, description: '', video_url: '' });
            setPendingVideoFile(null);
            setShowExerciseDialog(true);
          }}>
            <Plus className="w-4 h-4 mr-2" />Add Exercise
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search exercises..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {filteredExercises.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Dumbbell className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No exercises found</p>
          <p className="text-sm">{isAdmin ? 'Add your first exercise to this category' : 'No exercises in this category yet'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredExercises.map(ex => (
            <Card key={ex.id} className="border-0 shadow-sm hover:shadow-lg transition-all overflow-hidden group">
              <div className="relative aspect-video bg-muted flex items-center justify-center">
                {videoPlaying === ex.id && ex.video_url ? (
                  // No download attribute for clients â€” controls only allows streaming
                  <video
                    src={ex.video_url}
                    controls
                    autoPlay
                    controlsList={isAdmin ? undefined : 'nodownload'}
                    className="w-full h-full object-cover"
                  />
                ) : ex.video_url ? (
                  <button
                    onClick={() => setVideoPlaying(ex.id)}
                    className="flex flex-col items-center gap-2 text-muted-foreground hover:text-primary transition-colors"
                  >
                    <div className="w-14 h-14 rounded-full bg-background/90 flex items-center justify-center shadow-md">
                      <Play className="w-7 h-7 ml-1" />
                    </div>
                    <span className="text-xs font-medium">Play Video</span>
                  </button>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
                    <Dumbbell className="w-10 h-10" />
                    <span className="text-xs">No video</span>
                    {isAdmin && (
                      <button
                        onClick={() => openEditExercise(ex)}
                        className="text-xs text-primary/60 hover:text-primary flex items-center gap-1 transition-colors"
                      >
                        <Upload className="w-3 h-3" />Upload video
                      </button>
                    )}
                  </div>
                )}
              </div>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{ex.title}</h3>
                    {ex.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{ex.description}</p>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isAdmin && ex.video_url && (
                      <a
                        href={ex.video_url}
                        download
                        onClick={e => e.stopPropagation()}
                        className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                        title="Download video"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    )}
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => openEditExercise(ex)}
                        title="Edit exercise"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => deleteExercise.mutate(ex.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Exercise Dialog (admin only) */}
      {isAdmin && (
        <Dialog open={showExerciseDialog} onOpenChange={v => { setShowExerciseDialog(v); if (!v) setPendingVideoFile(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Exercise â€” {selectedCategory?.name}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Title</Label><Input value={exerciseForm.title} onChange={e => setExerciseForm(p => ({ ...p, title: e.target.value }))} placeholder="Bench Press" /></div>
              <div><Label>Description (optional)</Label><Textarea value={exerciseForm.description} onChange={e => setExerciseForm(p => ({ ...p, description: e.target.value }))} rows={2} /></div>
              <div>
                <Label>Video <span className="text-xs text-muted-foreground font-normal">(uploads in background)</span></Label>
                <Input type="file" accept="video/*" onChange={handleVideoFileSelect} />
                {pendingVideoFile && <p className="text-xs text-primary mt-1 flex items-center gap-1"><Upload className="w-3 h-3" />{pendingVideoFile.name} â€” will upload after saving</p>}
              </div>
              <Button onClick={() => createExercise.mutate(exerciseForm)} disabled={!exerciseForm.title || createExercise.isPending} className="w-full">
                Create Exercise
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {/* Edit Exercise Dialog */}
      {isAdmin && editingExercise && (
        <Dialog open={!!editingExercise} onOpenChange={v => { if (!v) setEditingExercise(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Edit Exercise</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Title</Label><Input value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} /></div>
              <div><Label>Description</Label><Textarea value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} rows={2} /></div>
              <div>
                <Label className="flex items-center gap-2">
                  Video
                  <span className={`text-xs px-2 py-0.5 rounded-full ${editingExercise.video_url ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                    {editVideoFile ? 'New file selected' : editingExercise.video_url ? 'Has video' : 'No video'}
                  </span>
                </Label>
                <div className="flex gap-2 mt-1">
                  <Input type="file" accept="video/*" onChange={e => setEditVideoFile(e.target.files[0] || null)} className="flex-1" />
                  {editingExercise.video_url && !editVideoFile && (
                    <Button variant="outline" size="sm" className="text-destructive shrink-0" onClick={() => handleRemoveVideo(editingExercise)}>
                      <X className="w-4 h-4 mr-1" />Remove
                    </Button>
                  )}
                </div>
                {editVideoFile && <p className="text-xs text-primary mt-1 flex items-center gap-1"><Upload className="w-3 h-3" />{editVideoFile.name} â€” will upload after saving</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setEditingExercise(null)}>Cancel</Button>
                <Button className="flex-1" onClick={handleSaveEdit} disabled={updateExercise.isPending}>Save Changes</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
