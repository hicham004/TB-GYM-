import React, { useState } from 'react';
import { useUpload } from '@/lib/uploadContext';
import { Upload, CheckCircle2, XCircle, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadManager() {
  const { uploads, dismissUpload } = useUpload();
  const [collapsed, setCollapsed] = useState(false);

  const list = Object.values(uploads);
  if (list.length === 0) return null;

  const activeCount = list.filter(u => u.status === 'uploading' || u.status === 'processing').length;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl shadow-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-primary cursor-pointer select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2 text-primary-foreground">
          <Upload className="w-4 h-4" />
          <span className="text-sm font-semibold">
            {activeCount > 0 ? `Uploading (${activeCount})` : `Uploads (${list.length})`}
          </span>
        </div>
        {collapsed ? <ChevronUp className="w-4 h-4 text-primary-foreground" /> : <ChevronDown className="w-4 h-4 text-primary-foreground" />}
      </div>

      {/* Upload list */}
      {!collapsed && (
        <div className="max-h-64 overflow-y-auto divide-y divide-border">
          {list.map(upload => (
            <div key={upload.id} className="px-4 py-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{upload.filename}</p>
                  {upload.filesize && <p className="text-xs text-muted-foreground">{formatBytes(upload.filesize)}</p>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {upload.status === 'uploading' && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
                  {upload.status === 'processing' && <Loader2 className="w-4 h-4 text-chart-4 animate-spin" />}
                  {upload.status === 'done' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                  {upload.status === 'failed' && <XCircle className="w-4 h-4 text-destructive" />}
                  {(upload.status === 'done' || upload.status === 'failed') && (
                    <button onClick={() => dismissUpload(upload.id)} className="p-0.5 hover:text-muted-foreground transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              {(upload.status === 'uploading' || upload.status === 'processing') && (
                <>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${upload.status === 'processing' ? 'bg-chart-4 animate-pulse' : 'bg-primary'}`}
                      style={{ width: `${upload.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {upload.status === 'processing' ? 'Processing video...' : `${upload.progress}%`}
                  </p>
                </>
              )}
              {upload.status === 'done' && <p className="text-xs text-green-600 font-medium">Ready</p>}
              {upload.status === 'failed' && <p className="text-xs text-destructive">Upload failed</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
