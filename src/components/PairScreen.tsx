import { useState, useRef, useEffect } from 'react';
import { Zap, ArrowRight, Copy, Check, Loader2, Wifi } from 'lucide-react';
import { usePeer } from '../context/PeerContext';

export function PairScreen() {
  const { createSession, joinSession, myCode, isConnecting, error, clearError } = usePeer();
  const [mode, setMode] = useState<'pick' | 'create' | 'join'>('pick');
  const [code, setCode] = useState(['', '', '']);
  const [copied, setCopied] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (mode === 'join') inputsRef.current[0]?.focus();
  }, [mode]);

  const handleInput = (i: number, v: string) => {
    const ch = v.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(-1);
    const next = [...code];
    next[i] = ch;
    setCode(next);
    if (ch && i < 2) inputsRef.current[i + 1]?.focus();
    if (i === 2 && ch) {
      const full = next.join('');
      if (full.length === 3) joinSession(full);
    }
  };

  const handleKey = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) {
      inputsRef.current[i - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const txt = e.clipboardData.getData('text').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 3);
    const next = ['', '', ''];
    for (let i = 0; i < txt.length; i++) next[i] = txt[i];
    setCode(next);
    if (txt.length === 3) {
      joinSession(txt);
    } else {
      inputsRef.current[txt.length]?.focus();
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(myCode.toUpperCase());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 relative overflow-hidden">
      {/* BG effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-80 h-80 rounded-full bg-[var(--color-accent)] opacity-[0.04] blur-[80px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-[var(--color-accent2)] opacity-[0.04] blur-[80px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10 animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent2)] mb-4 shadow-lg shadow-[var(--color-accent-glow)]">
            <Zap size={28} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-[var(--color-text2)] bg-clip-text text-transparent">
            DropIO
          </h1>
          <p className="text-[var(--color-text3)] text-sm mt-1.5">Peer-to-peer file transfer & chat</p>
        </div>

        {error && (
          <div className="mb-5 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2 animate-fade-in" onClick={clearError}>
            <span className="flex-1">{error}</span>
            <span className="text-red-500/50 text-xs cursor-pointer">✕</span>
          </div>
        )}

        {/* Mode: Pick */}
        {mode === 'pick' && (
          <div className="space-y-3 animate-slide-up">
            <button
              onClick={() => { setMode('create'); createSession(); }}
              className="w-full glass rounded-2xl p-5 flex items-center gap-4 hover:border-[var(--color-accent)]/40 transition-all group active:scale-[0.98]"
            >
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent2)] flex items-center justify-center flex-shrink-0 shadow-lg shadow-[var(--color-accent-glow)]">
                <Wifi size={20} className="text-white" />
              </div>
              <div className="text-left flex-1">
                <div className="font-semibold text-[var(--color-text)]">Create Room</div>
                <div className="text-xs text-[var(--color-text3)] mt-0.5">Get a code to share with your peer</div>
              </div>
              <ArrowRight size={18} className="text-[var(--color-text3)] group-hover:text-[var(--color-accent)] transition-colors" />
            </button>

            <button
              onClick={() => setMode('join')}
              className="w-full glass rounded-2xl p-5 flex items-center gap-4 hover:border-[var(--color-accent2)]/40 transition-all group active:scale-[0.98]"
            >
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--color-accent2)] to-[var(--color-green)] flex items-center justify-center flex-shrink-0 shadow-lg shadow-[rgba(92,140,252,0.3)]">
                <ArrowRight size={20} className="text-white" />
              </div>
              <div className="text-left flex-1">
                <div className="font-semibold text-[var(--color-text)]">Join Room</div>
                <div className="text-xs text-[var(--color-text3)] mt-0.5">Enter a 3-character room code</div>
              </div>
              <ArrowRight size={18} className="text-[var(--color-text3)] group-hover:text-[var(--color-accent2)] transition-colors" />
            </button>
          </div>
        )}

        {/* Mode: Create */}
        {mode === 'create' && (
          <div className="animate-slide-up">
            <div className="glass rounded-2xl p-8 text-center">
              {!myCode ? (
                <div className="py-6">
                  <Loader2 size={36} className="mx-auto text-[var(--color-accent)] animate-spin mb-4" />
                  <p className="text-[var(--color-text2)] text-sm">Creating room...</p>
                </div>
              ) : (
                <>
                  <p className="text-[var(--color-text3)] text-xs uppercase tracking-widest mb-5">Your Room Code</p>
                  <div className="flex justify-center gap-3 mb-6">
                    {myCode.split('').map((ch, i) => (
                      <div key={i} className="w-16 h-20 rounded-xl bg-[var(--color-surface2)] border border-[var(--color-border)] flex items-center justify-center text-3xl font-bold text-white tracking-wider glow-border animate-float" style={{ animationDelay: `${i * 0.15}s` }}>
                        {ch.toUpperCase()}
                      </div>
                    ))}
                  </div>
                  <button onClick={copyCode} className="btn-primary inline-flex items-center gap-2 text-sm">
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? 'Copied!' : 'Copy Code'}
                  </button>
                  <div className="mt-6 flex items-center justify-center gap-2 text-[var(--color-text3)] text-xs">
                    <Loader2 size={12} className="animate-spin" />
                    Waiting for peer to connect...
                  </div>
                </>
              )}
            </div>
            <button onClick={() => setMode('pick')} className="mt-4 text-sm text-[var(--color-text3)] hover:text-[var(--color-text2)] transition-colors w-full text-center">
              ← Back
            </button>
          </div>
        )}

        {/* Mode: Join */}
        {mode === 'join' && (
          <div className="animate-slide-up">
            <div className="glass rounded-2xl p-8 text-center">
              {isConnecting ? (
                <div className="py-6">
                  <Loader2 size={36} className="mx-auto text-[var(--color-accent2)] animate-spin mb-4" />
                  <p className="text-[var(--color-text2)] text-sm">Connecting...</p>
                </div>
              ) : (
                <>
                  <p className="text-[var(--color-text3)] text-xs uppercase tracking-widest mb-5">Enter Room Code</p>
                  <div className="flex justify-center gap-3 mb-6">
                    {[0, 1, 2].map(i => (
                      <input
                        key={i}
                        ref={el => { inputsRef.current[i] = el; }}
                        type="text"
                        inputMode="text"
                        maxLength={1}
                        value={code[i]}
                        onChange={e => handleInput(i, e.target.value)}
                        onKeyDown={e => handleKey(i, e)}
                        onPaste={i === 0 ? handlePaste : undefined}
                        className="w-16 h-20 rounded-xl bg-[var(--color-surface2)] border border-[var(--color-border)] text-center text-3xl font-bold text-white outline-none focus:border-[var(--color-accent2)] focus:ring-2 focus:ring-[var(--color-accent2)]/20 transition-all uppercase"
                      />
                    ))}
                  </div>
                  <p className="text-[var(--color-text3)] text-xs">Type or paste the 3-character code</p>
                </>
              )}
            </div>
            <button onClick={() => { setMode('pick'); setCode(['', '', '']); clearError(); }} className="mt-4 text-sm text-[var(--color-text3)] hover:text-[var(--color-text2)] transition-colors w-full text-center">
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
