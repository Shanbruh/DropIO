import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Mic, Square, Play, Pause } from 'lucide-react';
import { usePeer } from '../context/PeerContext';

function VoicePlayer({ url, duration, isMine }: { url: string; duration: number; isMine: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const a = new Audio(url);
    audioRef.current = a;
    a.addEventListener('timeupdate', () => setProgress(a.currentTime / (a.duration || duration)));
    a.addEventListener('ended', () => { setPlaying(false); setProgress(0); });
    return () => { a.pause(); a.src = ''; };
  }, [url, duration]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-3 min-w-[180px]">
      <button onClick={toggle} className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isMine ? 'bg-white/20 hover:bg-white/30' : 'bg-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/30'} transition-colors`}>
        {playing ? <Pause size={14} className={isMine ? 'text-white' : 'text-[var(--color-accent)]'} /> : <Play size={14} className={`${isMine ? 'text-white' : 'text-[var(--color-accent)]'} ml-0.5`} />}
      </button>
      <div className="flex-1">
        <div className={`h-1.5 rounded-full ${isMine ? 'bg-white/20' : 'bg-[var(--color-border)]'} overflow-hidden`}>
          <div className={`h-full rounded-full transition-all ${isMine ? 'bg-white/70' : 'bg-[var(--color-accent)]'}`} style={{ width: `${progress * 100}%` }} />
        </div>
        <div className={`text-[10px] mt-1 ${isMine ? 'text-white/60' : 'text-[var(--color-text3)]'}`}>{fmt(duration)}</div>
      </div>
    </div>
  );
}

export function ChatView() {
  const { messages, sendMessage, sendVoiceNote } = usePeer();
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const t = text.trim();
    if (!t) return;
    sendMessage(t);
    setText('');
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const dur = (Date.now() - startTimeRef.current) / 1000;
        if (dur > 0.5) sendVoiceNote(blob, dur);
        setRecording(false);
        setRecordTime(0);
        if (timerRef.current) clearInterval(timerRef.current);
      };
      recorderRef.current = mr;
      startTimeRef.current = Date.now();
      mr.start();
      setRecording(true);
      timerRef.current = setInterval(() => {
        setRecordTime((Date.now() - startTimeRef.current) / 1000);
      }, 100);
    } catch {
      // mic access denied
    }
  }, [sendVoiceNote]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--color-surface2)] border border-[var(--color-border)] flex items-center justify-center mb-3 opacity-50">
              <Send size={20} className="text-[var(--color-text3)]" />
            </div>
            <p className="text-[var(--color-text3)] text-sm">No messages yet</p>
            <p className="text-[var(--color-text3)] text-xs mt-1 opacity-60">Send a message or voice note</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender === 'me' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
            <div className={`max-w-[80%] px-4 py-2.5 ${m.sender === 'me' ? 'msg-bubble-me text-white' : 'msg-bubble-peer text-[var(--color-text)]'}`}>
              {m.type === 'voice' && m.audioUrl ? (
                <VoicePlayer url={m.audioUrl} duration={m.audioDuration ?? 0} isMine={m.sender === 'me'} />
              ) : (
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{m.text}</p>
              )}
              <p className={`text-[10px] mt-1 ${m.sender === 'me' ? 'text-white/40' : 'text-[var(--color-text3)]'}`}>
                {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-3 pb-3 pt-1">
        <div className="glass-strong rounded-2xl flex items-end gap-2 px-3 py-2">
          {recording ? (
            <div className="flex-1 flex items-center gap-3 py-1.5">
              <div className="w-3 h-3 rounded-full bg-[var(--color-red)] animate-recording" />
              <span className="text-sm text-[var(--color-red)] font-mono">{fmt(recordTime)}</span>
              <span className="text-xs text-[var(--color-text3)]">Recording...</span>
            </div>
          ) : (
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Type a message..."
              rows={1}
              className="flex-1 bg-transparent outline-none text-sm text-[var(--color-text)] placeholder:text-[var(--color-text3)] resize-none max-h-24 py-1.5"
            />
          )}
          {recording ? (
            <button onClick={stopRecording} className="w-9 h-9 rounded-xl bg-[var(--color-red)]/20 flex items-center justify-center hover:bg-[var(--color-red)]/30 transition-colors flex-shrink-0">
              <Square size={16} className="text-[var(--color-red)]" />
            </button>
          ) : text.trim() ? (
            <button onClick={handleSend} className="w-9 h-9 rounded-xl bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent2)] flex items-center justify-center hover:opacity-90 transition-opacity flex-shrink-0 shadow-lg shadow-[var(--color-accent-glow)]">
              <Send size={16} className="text-white" />
            </button>
          ) : (
            <button onClick={startRecording} className="w-9 h-9 rounded-xl bg-[var(--color-surface2)] flex items-center justify-center hover:bg-[var(--color-surface3)] transition-colors flex-shrink-0 border border-[var(--color-border)]">
              <Mic size={16} className="text-[var(--color-text2)]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
