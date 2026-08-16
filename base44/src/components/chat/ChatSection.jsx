import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/localClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, MessageCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

export default function ChatSection({ clientId, isAdmin, clientUserId }) {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const scrollRef = useRef(null);
  const queryKey = ['chat', clientId];

  const { data: messages = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => api.entities.ChatMessage.filter({ client_id: clientId }, 'created_date'),
    enabled: !!clientId,
    refetchInterval: 3000,
  });

  const sendMessage = useMutation({
    mutationFn: async (data) => {
      const msg = await api.entities.ChatMessage.create(data);
      // Create notification for the other party
      if (isAdmin && clientUserId) {
        // Notify the client
        await api.entities.Notification.create({
          user_id: clientUserId,
          title: 'New message from your Coach',
          message: data.message.length > 80 ? data.message.slice(0, 80) + 'â€¦' : data.message,
          type: 'new_message',
          read: false,
        });
      }
      return msg;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setMessage('');
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = () => {
    if (!message.trim() || !clientId) return;
    sendMessage.mutate({
      client_id: clientId,
      sender_role: isAdmin ? 'admin' : 'client',
      sender_name: user?.full_name || user?.email || (isAdmin ? 'Coach' : 'Client'),
      message: message.trim(),
    });
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-primary" />
          Chat with {isAdmin ? 'Client' : 'Coach'}
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80 overflow-y-auto mb-4 space-y-3 p-2 rounded-lg bg-muted/20">
          {!isLoading && messages.length === 0 && (
            <p className="text-center text-muted-foreground text-sm py-12">No messages yet. Say hello! ðŸ‘‹</p>
          )}
          {messages.map(msg => {
            const isMe = (isAdmin && msg.sender_role === 'admin') || (!isAdmin && msg.sender_role === 'client');
            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm ${
                  isMe
                    ? 'bg-primary text-primary-foreground rounded-br-md'
                    : 'bg-card border border-border rounded-bl-md'
                }`}>
                  <p className={`text-xs mb-1 font-medium ${isMe ? 'opacity-70' : 'text-muted-foreground'}`}>
                    {msg.sender_name}
                  </p>
                  <p className="leading-relaxed">{msg.message}</p>
                  <p className={`text-[10px] mt-1.5 ${isMe ? 'opacity-50' : 'text-muted-foreground'}`}>
                    {msg.created_date ? format(new Date(msg.created_date), 'MMM d, HH:mm') : ''}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={scrollRef} />
        </div>
        <div className="flex gap-2">
          <Input
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Type a message..."
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            disabled={sendMessage.isPending}
          />
          <Button onClick={handleSend} size="icon" disabled={!message.trim() || sendMessage.isPending}>
            {sendMessage.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
