import { useCallback, useState } from 'react';
import type { Attachment } from '../types/pair';

interface Props {
  attachments: Attachment[];
  pairId: string;
  panel: 'left' | 'right';
  onUpload: (pairId: string, file: File, panel: 'left' | 'right') => Promise<void>;
  onDelete: (pairId: string, attachmentId: string) => Promise<void>;
}

export default function AttachmentZone({ attachments, pairId, panel, onUpload, onDelete }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<Attachment | null>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      onUpload(pairId, file, panel);
    }
  }, [pairId, panel, onUpload]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) onUpload(pairId, file, panel);
      }
    }
  }, [pairId, panel, onUpload]);

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onPaste={handlePaste}
      tabIndex={0}
      className={`border border-dashed rounded p-2 min-h-[52px] transition-colors ${
        isDragging ? 'border-accent bg-accent/10' : 'border-border'
      }`}
    >
      {attachments.length === 0 && (
        <p className="text-xs text-text-muted text-center py-1">
          Drop files here or Cmd+V
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {attachments.map(att => {
          const fileUrl = `/attachments/${pairId}/attachments/${att.storedName || att.filename}`;
          return (
            <div key={att.id} className="relative group">
              {att.mimeType.startsWith('image/') ? (
                <img
                  src={fileUrl}
                  alt={att.filename}
                  className="w-12 h-12 object-cover rounded cursor-pointer"
                  onClick={() => setPreview(att)}
                />
              ) : (
                <div
                  className="w-12 h-12 bg-bg-tertiary rounded flex items-center justify-center text-xs text-text-secondary cursor-pointer"
                  onClick={() => setPreview(att)}
                >
                  {att.filename.split('.').pop()?.toUpperCase()}
                </div>
              )}
              <button
                onClick={() => onDelete(pairId, att.id)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-error rounded-full text-white text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              >
                x
              </button>
            </div>
          );
        })}
      </div>

      {preview && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center"
          onClick={() => setPreview(null)}
        >
          <div className="max-w-4xl max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            {preview.mimeType.startsWith('image/') ? (
              <img src={`/attachments/${pairId}/attachments/${preview.storedName || preview.filename}`} alt={preview.filename} className="max-w-full" />
            ) : (
              <div className="bg-bg-secondary p-8 rounded text-text-primary">
                <p>{preview.filename}</p>
              </div>
            )}
            <button
              onClick={() => setPreview(null)}
              className="absolute top-4 right-4 text-white text-2xl hover:text-error"
            >
              x
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
