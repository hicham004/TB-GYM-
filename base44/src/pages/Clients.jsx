import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, UserPlus, ChevronRight, ShieldAlert, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import AddClientDialog from '@/components/clients/AddClientDialog';

export default function Clients() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const { data: allUsers = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.entities.User.list(),
  });

  const { data: pendingInvitations = [], isLoading: loadingInvitations } = useQuery({
    queryKey: ['pending-invitations'],
    queryFn: () => api.entities.ClientInvitation.filter({ status: 'pending' }, '-created_date'),
  });

  // Registered non-admin, non-deleted users
  const registeredClients = allUsers.filter(u => u.role !== 'admin' && !u.is_deleted);
  const registeredEmails = new Set(registeredClients.map(u => u.email?.toLowerCase()));

  // Pending invitations that don't yet have a registered user account
  const pendingOnly = pendingInvitations.filter(
    inv => !registeredEmails.has(inv.email?.toLowerCase())
  );

  // Merge: registered clients first, then pending-only as virtual profiles
  const allClients = [
    ...registeredClients.map(u => ({ ...u, _type: 'registered' })),
    ...pendingOnly.map(inv => ({
      id: `inv_${inv.id}`,
      _invitationId: inv.id,
      _type: 'invited',
      full_name: inv.full_name || '',
      email: inv.email,
      phone: inv.phone,
      goal: inv.goal,
      payment_status: inv.payment_status,
      is_blocked: false,
    })),
  ];

  const filtered = allClients.filter(c => {
    if (!search) return true;
    const s = search.toLowerCase();
    return c.full_name?.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s);
  });

  const paymentBadge = (status) => {
    if (status === 'paid') return <Badge className="bg-chart-3 text-white border-0">Paid</Badge>;
    if (status === 'overdue') return <Badge variant="destructive">Overdue</Badge>;
    return <Badge variant="secondary">Not Paid</Badge>;
  };

  const isLoading = loadingUsers || loadingInvitations;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clients</h1>
          <p className="text-muted-foreground mt-1">
            {registeredClients.length} registered Â· {pendingOnly.length} invited
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <UserPlus className="w-4 h-4 mr-2" />Add Client
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="space-y-3">
        {filtered.map(client => {
          const isInvited = client._type === 'invited';
          const href = isInvited ? `/clients/invited/${client._invitationId}` : `/clients/${client.id}`;

          return (
            <Link key={client.id} to={href}>
              <Card className="border-0 shadow-sm hover:shadow-lg transition-all cursor-pointer mb-3">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${isInvited ? 'bg-muted' : 'bg-primary/10'}`}>
                      {isInvited
                        ? <Mail className="w-5 h-5 text-muted-foreground" />
                        : <span className="text-lg font-bold text-primary">
                            {(client.full_name || client.email || 'C')[0].toUpperCase()}
                          </span>
                      }
                    </div>
                    <div>
                      <p className="font-semibold">{client.full_name || 'Pending Signup'}</p>
                      <p className="text-sm text-muted-foreground">{client.email}</p>
                      {client.goal && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">ðŸŽ¯ {client.goal}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {isInvited && (
                      <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
                        <Mail className="w-3 h-3" />Invited
                      </Badge>
                    )}
                    {client.is_blocked && (
                      <Badge variant="destructive" className="gap-1"><ShieldAlert className="w-3 h-3" />Blocked</Badge>
                    )}
                    {paymentBadge(client.payment_status)}
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}

        {filtered.length === 0 && !isLoading && (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-lg font-medium">No clients found</p>
            <p className="text-sm mt-1">Add your first client to get started</p>
          </div>
        )}
      </div>

      <AddClientDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['clients'] });
          queryClient.invalidateQueries({ queryKey: ['pending-invitations'] });
        }}
      />
    </div>
  );
}
