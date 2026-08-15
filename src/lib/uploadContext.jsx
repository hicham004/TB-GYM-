import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { api } from '@/api/localClient';

const UploadContext = createContext(null);

export function UploadProvider({ children }) {
  const [uploads, setUploads] = useState({}); // { [id]: { id, filename, progress, status, url, exerciseId } }
  const idRef = useRef(0);

  const startUpload = useCallback(async (file, { onComplete, onError } = {}) => {
    const id = `upload_${++idRef.current}`;
    setUploads(prev => ({
      ...prev,
      [id]: { id, filename: file.name, filesize: file.size, progress: 0, status: 'uploading', url: null },
    }));

    // Simulated progress up to 90%
    let sim = 0;
    const interval = setInterval(() => {
      sim = Math.min(sim + Math.random() * 10 + 2, 90);
      setUploads(prev => prev[id] ? { ...prev, [id]: { ...prev[id], progress: Math.round(sim) } } : prev);
    }, 400);

    try {
      const { file_url } = await api.integrations.Core.UploadFile({ file });
      clearInterval(interval);
      setUploads(prev => prev[id] ? { ...prev, [id]: { ...prev[id], progress: 100, status: 'processing' } } : prev);
      // Brief processing phase
      setTimeout(() => {
        setUploads(prev => prev[id] ? { ...prev, [id]: { ...prev[id], status: 'done', url: file_url } } : prev);
        onComplete?.(file_url, id);
      }, 1200);
    } catch (err) {
      clearInterval(interval);
      setUploads(prev => prev[id] ? { ...prev, [id]: { ...prev[id], status: 'failed', progress: 0 } } : prev);
      onError?.(err, id);
    }

    return id;
  }, []);

  const dismissUpload = useCallback((id) => {
    setUploads(prev => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  return (
    <UploadContext.Provider value={{ uploads, startUpload, dismissUpload }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  return useContext(UploadContext);
}
