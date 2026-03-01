import { useRef, useState, useCallback } from 'react';
import { Upload, Download, File, Image, Film, Music, Archive, FileText, FolderOpen, CheckCircle2, AlertCircle, ArrowUp, ArrowDown } from 'lucide-react';
import { usePeer, FileTransferItem } from '../context/PeerContext';

const fmtSize = (b: number) => {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
};

const fmtSpeed = (b: number) => {
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB/s`;
  return `${(b / 1048576).toFixed(1)} MB/s`;
};

const getIcon = (name: string, type?: string) => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (type?.startsWith('image') || ['png','jpg','jpeg','gif','webp','svg','bmp','ico'].includes(ext)) return <Image size={18} />;
  if (type?.startsWith('video') || ['mp4','mov','avi','mkv','webm'].includes(ext)) return <Film size={18} />;
  if (type?.startsWith('audio') || ['mp3','wav','aac','flac','ogg','m4a'].includes(ext)) return <Music size={18} />;
  if (['zip','rar','7z','tar','gz','bz2','xz'].includes(ext)) return <Archive size={18} />;
  if (['pdf','doc','docx','txt','rtf','csv','xls','xlsx','ppt','pptx'].includes(ext)) return <FileText size={18} />;
  return <File size={18} />;
};

function FileCard({ item }: { item: FileTransferItem }) {
  const pct = Math.round(item.progress * 100);
  const isSend = item.direction === 'send';

  return (
    <div className="glass rounded-xl p-3.5 animate-fade-in">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          item.status === 'complete' ? 'bg-[var(--color-green)]/10 text-[var(--color-green)]'
          : item.status === 'error' ? 'bg-[var(--color-red)]/10 text-[var(--color-red)]'
          : isSend ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
          : 'bg-[var(--color-accent2)]/10 text-[var(--color-accent2)]'
        }`}>
          {getIcon(item.name, item.fileType)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[var(--color-text)] truncate flex-1">{item.name}</p>
            {item.status === 'complete' ? (
              <CheckCircle2 size={14} className="text-[var(--color-green)] flex-shrink-0" />
            ) : item.status === 'error' ? (
              <AlertCircle size={14} className="text-[var(--color-red)] flex-shrink-0" />
            ) : (
              <span className={`flex items-center gap-1 text-xs flex-shrink-0 ${isSend ? 'text-[var(--color-accent)]' : 'text-[var(--color-accent2)]'}`}>
                {isSend ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                {pct}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] text-[var(--color-text3)]">{fmtSize(item.size)}</span>
            {item.status !== 'complete' && item.status !== 'error' && item.speed > 0 && (
              <>
                <span className="text-[var(--color-border)]">·</span>
                <span className="text-[11px] text-[var(--color-text3)]">{fmtSpeed(item.speed)}</span>
              </>
            )}
          </div>
          {(item.status === 'sending' || item.status === 'receiving') && (
            <div className="mt-2 h-1.5 rounded-full bg-[var(--color-surface2)] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${isSend ? 'bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent2)]' : 'bg-gradient-to-r from-[var(--color-accent2)] to-[var(--color-green)]'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>
      {item.status === 'complete' && item.url && (
        <a href={item.url} download={item.name} className="mt-3 flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-[var(--color-green)]/10 text-[var(--color-green)] text-xs font-medium hover:bg-[var(--color-green)]/15 transition-colors">
          <Download size={14} /> Download
        </a>
      )}
    </div>
  );
}

export function FileView() {
  const { sendFile, sendFiles, transfers } = usePeer();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragCountRef = useRef(0);

  const handleFiles = useCallback((fl: FileList | File[]) => {
    const files = Array.from(fl);
    if (files.length === 1) sendFile(files[0]);
    else if (files.length > 1) sendFiles(files);
  }, [sendFile, sendFiles]);

  const onDragEnter = (e: React.DragEvent) => { e.preventDefault(); dragCountRef.current++; setDragging(true); };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); dragCountRef.current--; if (dragCountRef.current <= 0) { setDragging(false); dragCountRef.current = 0; } };
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    dragCountRef.current = 0;

    // Handle folder drops via DataTransferItemList
    const items = e.dataTransfer.items;
    if (items) {
      const allFiles: File[] = [];
      let pending = 0;
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        if (allFiles.length > 0) handleFiles(allFiles);
      };

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const entry = (item as any).webkitGetAsEntry?.() || (item as any).getAsEntry?.();
          if (entry) {
            pending++;
            traverseEntry(entry, allFiles, () => {
              pending--;
              if (pending === 0) finish();
            });
          } else {
            const f = item.getAsFile();
            if (f) allFiles.push(f);
          }
        }
      }
      if (pending === 0) finish();
    } else if (e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="flex flex-col h-full" onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop}>
      <input ref={fileRef} type="file" multiple className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />
      <input ref={folderRef} type="file" multiple {...{ webkitdirectory: '', directory: '' } as any} className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Drop zone / upload buttons */}
        <div className={`relative rounded-2xl border-2 border-dashed transition-all ${
          dragging ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5 scale-[1.01]' : 'border-[var(--color-border)] hover:border-[var(--color-text3)]'
        } p-6 text-center`}>
          {dragging && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[var(--color-accent)]/10 z-10">
              <div className="text-[var(--color-accent)] font-semibold flex items-center gap-2">
                <Upload size={20} /> Drop files here
              </div>
            </div>
          )}
          <div className={dragging ? 'opacity-0' : ''}>
            <div className="w-12 h-12 mx-auto rounded-xl bg-[var(--color-surface2)] border border-[var(--color-border)] flex items-center justify-center mb-3">
              <Upload size={20} className="text-[var(--color-text3)]" />
            </div>
            <p className="text-sm text-[var(--color-text2)] mb-1">Drop files or folders here</p>
            <p className="text-xs text-[var(--color-text3)] mb-4">or choose an option below</p>
            <div className="flex gap-2 justify-center flex-wrap">
              <button onClick={() => fileRef.current?.click()} className="btn-primary text-xs !py-2 !px-4 !rounded-xl flex items-center gap-1.5">
                <Upload size={14} /> Files
              </button>
              <button onClick={() => folderRef.current?.click()} className="text-xs py-2 px-4 rounded-xl bg-[var(--color-surface2)] border border-[var(--color-border)] text-[var(--color-text2)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)] transition-all flex items-center gap-1.5">
                <FolderOpen size={14} /> Folder
              </button>
            </div>
          </div>
        </div>

        {/* Transfer list */}
        {transfers.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-medium text-[var(--color-text3)] uppercase tracking-wider">Transfers</h3>
              <span className="text-[11px] text-[var(--color-text3)]">{transfers.filter(t => t.status === 'complete').length}/{transfers.length} done</span>
            </div>
            {transfers.map(item => <FileCard key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function traverseEntry(entry: any, files: File[], done: () => void) {
  if (entry.isFile) {
    entry.file((f: File) => { files.push(f); done(); }, () => done());
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const readAll = (allEntries: any[]) => {
      reader.readEntries((entries: any[]) => {
        if (entries.length === 0) {
          let pending = allEntries.length;
          if (pending === 0) { done(); return; }
          allEntries.forEach(e => traverseEntry(e, files, () => { pending--; if (pending === 0) done(); }));
        } else {
          readAll(allEntries.concat(entries));
        }
      }, () => done());
    };
    readAll([]);
  } else {
    done();
  }
}
