import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Layers, Save, Loader2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

export default function CategoryPermissions({ clientId }) {
  const queryClient = useQueryClient();
  const [permissions, setPermissions] = useState({});
  const [isDirty, setIsDirty] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['exercise-categories'],
    queryFn: () => api.entities.ExerciseCategory.list(),
  });

  const { data: existingPerms = [], isSuccess } = useQuery({
    queryKey: ['category-permissions', clientId],
    queryFn: () => api.entities.CategoryPermission.filter({ client_id: clientId }),
    enabled: !!clientId,
  });

  // Initialize permissions from existing records
  useEffect(() => {
    if (isSuccess && categories.length > 0) {
      const perms = {};
      categories.forEach(cat => {
        const existing = existingPerms.find(p => p.category_id === cat.id);
        // Default: allowed = true if no record exists
        perms[cat.id] = existing ? existing.allowed : true;
      });
      setPermissions(perms);
    }
  }, [isSuccess, categories.length, existingPerms.length]);

  const saveAll = useMutation({
    mutationFn: async () => {
      await Promise.all(
        categories.map(async (cat) => {
          const allowed = permissions[cat.id] !== false;
          const existing = existingPerms.find(p => p.category_id === cat.id);
          if (existing) {
            if (existing.allowed !== allowed) {
              await api.entities.CategoryPermission.update(existing.id, { allowed });
            }
          } else {
            await api.entities.CategoryPermission.create({
              client_id: clientId,
              category_id: cat.id,
              allowed,
            });
          }
        })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['category-permissions', clientId] });
      setIsDirty(false);
      toast.success('Video category permissions updated!');
    },
    onError: () => toast.error('Failed to save permissions'),
  });

  const toggle = (catId) => {
    setPermissions(prev => ({ ...prev, [catId]: !prev[catId] }));
    setIsDirty(true);
  };

  const allowedCount = Object.values(permissions).filter(Boolean).length;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            Video Category Access
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {allowedCount}/{categories.length} allowed
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">Control which exercise video categories this client can see</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {categories.map(cat => {
            const allowed = permissions[cat.id] !== false;
            return (
              <div
                key={cat.id}
                className={`flex items-center justify-between p-3 rounded-lg transition-colors ${allowed ? 'bg-muted/40' : 'bg-muted/20 opacity-60'}`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{cat.icon || 'ðŸ’ª'}</span>
                  <div>
                    <p className="font-medium text-sm">{cat.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      {allowed ? (
                        <><Eye className="w-3 h-3 text-chart-3" />Visible to client</>
                      ) : (
                        <><EyeOff className="w-3 h-3" />Hidden from client</>
                      )}
                    </p>
                  </div>
                </div>
                <Switch checked={allowed} onCheckedChange={() => toggle(cat.id)} />
              </div>
            );
          })}
          {categories.length === 0 && (
            <p className="text-center text-muted-foreground text-sm py-6">No categories in library yet</p>
          )}
        </div>

        {categories.length > 0 && (
          <Button
            className="mt-4 w-full gap-2"
            onClick={() => saveAll.mutate()}
            disabled={!isDirty || saveAll.isPending}
          >
            {saveAll.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saveAll.isPending ? 'Saving...' : 'Save Permissions'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
