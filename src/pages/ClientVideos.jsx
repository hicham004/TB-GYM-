import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Play, Dumbbell, Search, ArrowLeft, Layers, Video } from 'lucide-react';

export default function ClientVideos() {
  const { user } = useCurrentUser();
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [search, setSearch] = useState('');
  const [videoModal, setVideoModal] = useState(null); // { url, title }

  const { data: categories = [] } = useQuery({
    queryKey: ['exercise-categories'],
    queryFn: () => api.entities.ExerciseCategory.list(),
  });

  const { data: exercises = [] } = useQuery({
    queryKey: ['exercises'],
    queryFn: () => api.entities.Exercise.list(),
  });

  const { data: permissions = [], isLoading: loadingPerms } = useQuery({
    queryKey: ['category-permissions', user?.id],
    queryFn: () => api.entities.CategoryPermission.filter({ client_id: user?.id }),
    enabled: !!user?.id,
  });

  // Only show categories where allowed === true (explicit grant)
  const allowedCategoryIds = new Set(
    permissions.filter(p => p.allowed).map(p => p.category_id)
  );
  const visibleCategories = categories.filter(cat => allowedCategoryIds.has(cat.id));

  const selectedCategory = categories.find(c => c.id === selectedCategoryId);

  const filteredExercises = exercises
    .filter(ex => ex.category_id === selectedCategoryId && ex.video_url)
    .filter(ex => !search || ex.title?.toLowerCase().includes(search.toLowerCase()));

  if (loadingPerms) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // â”€â”€â”€ Category Grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!selectedCategoryId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Videos</h1>
          <p className="text-muted-foreground mt-1">
            {visibleCategories.length} {visibleCategories.length === 1 ? 'category' : 'categories'} available
          </p>
        </div>

        {visibleCategories.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">
            <Layers className="w-14 h-14 mx-auto mb-4 opacity-25" />
            <p className="text-lg font-semibold">No videos available yet</p>
            <p className="text-sm mt-1">Your coach hasn't assigned any video categories to you yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {visibleCategories.map(cat => {
              const count = exercises.filter(e => e.category_id === cat.id && e.video_url).length;
              return (
                <Card
                  key={cat.id}
                  className="border-0 shadow-sm hover:shadow-lg transition-all cursor-pointer group"
                  onClick={() => { setSelectedCategoryId(cat.id); setSearch(''); }}
                >
                  <CardContent className="p-5 text-center">
                    <div className="text-4xl mb-3">{cat.icon || 'ðŸ’ª'}</div>
                    <h3 className="font-semibold text-sm leading-tight">{cat.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{count} video{count !== 1 ? 's' : ''}</p>
                    <div className="mt-3 flex items-center justify-center gap-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium">
                      <Video className="w-3 h-3" /> Watch
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // â”€â”€â”€ Exercise List within Category â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => { setSelectedCategoryId(null); setSearch(''); }}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {selectedCategory?.icon} {selectedCategory?.name}
          </h1>
          <p className="text-muted-foreground mt-0.5">{filteredExercises.length} video{filteredExercises.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search exercises..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {filteredExercises.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Dumbbell className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No videos found</p>
          <p className="text-sm">No exercises with videos in this category yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredExercises.map(ex => (
            <Card
              key={ex.id}
              className="border-0 shadow-sm hover:shadow-lg transition-all overflow-hidden cursor-pointer group"
              onClick={() => setVideoModal({ url: ex.video_url, title: ex.title })}
            >
              {/* Thumbnail / Placeholder */}
              <div className="relative aspect-video bg-muted flex items-center justify-center overflow-hidden">
                {ex.thumbnail_url ? (
                  <img src={ex.thumbnail_url} alt={ex.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
                    <Dumbbell className="w-10 h-10" />
                  </div>
                )}
                {/* Play overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                    <Play className="w-7 h-7 text-primary ml-1" />
                  </div>
                </div>
              </div>
              <CardContent className="p-4">
                <h3 className="font-semibold truncate">{ex.title}</h3>
                {ex.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{ex.description}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Video Player Modal â€” NO download */}
      {videoModal && (
        <Dialog open={!!videoModal} onOpenChange={() => setVideoModal(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{videoModal.title}</DialogTitle>
            </DialogHeader>
            <video
              src={videoModal.url}
              controls
              autoPlay
              controlsList="nodownload"
              onContextMenu={e => e.preventDefault()}
              className="w-full rounded-lg"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
