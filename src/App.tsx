import { useState, useEffect } from 'react';
import { MessageSquare, FolderUp, LogOut, Phone, Video, Zap } from 'lucide-react';
import { PeerProvider, usePeer } from './context/PeerContext';
import { PairScreen } from './components/PairScreen';
import { ChatView } from './components/ChatView';
import { FileView } from './components/FileView';
import { CallOverlay } from './components/CallView';

function ConnectedView() {
  const [tab, setTab] = useState<'chat' | 'files'>('chat');
  const { disconnect, myCode, messages, transfers, startCall, callStatus } = usePeer();
  const [unreadChat, setUnreadChat] = useState(0);
  const [unreadFiles, setUnreadFiles] = useState(0);
  const [prevMsgLen, setPrevMsgLen] = useState(0);
  const [prevTxLen, setPrevTxLen] = useState(0);

  useEffect(() => {
    if (messages.length > prevMsgLen && tab !== 'chat') {
      setUnreadChat(p => p + (messages.length - prevMsgLen));
    }
    setPrevMsgLen(messages.length);
  }, [messages.length, tab, prevMsgLen]);

  useEffect(() => {
    if (transfers.length > prevTxLen && tab !== 'files') {
      setUnreadFiles(p => p + (transfers.length - prevTxLen));
    }
    setPrevTxLen(transfers.length);
  }, [transfers.length, tab, prevTxLen]);

  useEffect(() => {
    if (tab === 'chat') setUnreadChat(0);
    if (tab === 'files') setUnreadFiles(0);
  }, [tab]);

  return (
    <div className="flex flex-col h-screen bg-[var(--color-bg)]">
      {/* Call Overlay */}
      <CallOverlay />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 glass-strong flex-shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent2)] flex items-center justify-center">
            <Zap size={14} className="text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--color-text)]">DropIO</span>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)] animate-pulse" />
                <span className="text-[10px] text-[var(--color-green)]">Connected</span>
              </div>
            </div>
            {myCode && (
              <span className="text-[10px] font-mono text-[var(--color-text3)]">Room: {myCode.toUpperCase()}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {callStatus === 'idle' && (
            <>
              <button
                onClick={() => startCall('voice')}
                className="w-8 h-8 rounded-lg bg-[var(--color-surface2)] border border-[var(--color-border)] flex items-center justify-center hover:border-[var(--color-green)]/40 hover:text-[var(--color-green)] text-[var(--color-text3)] transition-all"
                title="Voice Call"
              >
                <Phone size={14} />
              </button>
              <button
                onClick={() => startCall('video')}
                className="w-8 h-8 rounded-lg bg-[var(--color-surface2)] border border-[var(--color-border)] flex items-center justify-center hover:border-[var(--color-accent2)]/40 hover:text-[var(--color-accent2)] text-[var(--color-text3)] transition-all"
                title="Video Call"
              >
                <Video size={14} />
              </button>
            </>
          )}
          <button
            onClick={disconnect}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-text3)] hover:text-[var(--color-red)] hover:bg-[var(--color-red)]/10 transition-all"
            title="Disconnect"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'chat' ? <ChatView /> : <FileView />}
      </div>

      {/* Tab Bar */}
      <div className="flex glass-strong flex-shrink-0 z-20">
        {([
          { key: 'chat' as const, icon: MessageSquare, label: 'Chat', badge: unreadChat },
          { key: 'files' as const, icon: FolderUp, label: 'Files', badge: unreadFiles },
        ]).map(({ key, icon: Icon, label, badge }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex flex-col items-center py-2.5 gap-1 transition-all relative ${
              tab === key ? 'text-[var(--color-accent)]' : 'text-[var(--color-text3)] hover:text-[var(--color-text2)]'
            }`}
          >
            {tab === key && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent2)]" />
            )}
            <div className="relative">
              <Icon size={20} />
              {badge > 0 && tab !== key && (
                <div className="absolute -top-1.5 -right-2 min-w-[16px] h-4 bg-[var(--color-accent)] rounded-full flex items-center justify-center shadow-lg shadow-[var(--color-accent-glow)]">
                  <span className="text-[9px] font-bold text-white px-1">{badge > 99 ? '99+' : badge}</span>
                </div>
              )}
            </div>
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AppContent() {
  const { isConnected } = usePeer();
  return isConnected ? <ConnectedView /> : <PairScreen />;
}

export default function App() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }, []);

  return (
    <PeerProvider>
      <AppContent />
    </PeerProvider>
  );
}
