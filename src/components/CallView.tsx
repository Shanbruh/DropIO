import { useRef, useEffect, useState } from 'react';
import { PhoneOff, Mic, MicOff, Video, VideoOff, Phone } from 'lucide-react';
import { usePeer } from '../context/PeerContext';

export function CallOverlay() {
  const { callStatus, callType, localStream, remoteStream, endCall, acceptCall } = usePeer();
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (callStatus === 'active') {
      startRef.current = Date.now();
      const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
      return () => clearInterval(iv);
    } else {
      setElapsed(0);
    }
  }, [callStatus]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
      setMuted(!muted);
    }
  };

  const toggleCam = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
      setCamOff(!camOff);
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  if (callStatus === 'idle') return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)]/95 backdrop-blur-xl">
      {/* Content */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {callType === 'video' && callStatus === 'active' ? (
          <>
            {/* Remote video full */}
            <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
            {/* Local video PiP */}
            <div className="absolute top-4 right-4 w-28 h-40 sm:w-36 sm:h-48 rounded-2xl overflow-hidden border-2 border-[var(--color-border)] shadow-2xl z-10">
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              {camOff && (
                <div className="absolute inset-0 bg-[var(--color-surface)] flex items-center justify-center">
                  <VideoOff size={20} className="text-[var(--color-text3)]" />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="text-center">
            {/* Voice call avatar */}
            <div className={`w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent2)] flex items-center justify-center mb-6 ${callStatus === 'active' ? '' : 'animate-pulse-ring'}`}>
              <Phone size={32} className="text-white" />
            </div>
            <p className="text-lg font-semibold text-[var(--color-text)]">
              {callStatus === 'calling' ? 'Calling...' : callStatus === 'incoming' ? 'Incoming Call' : callType === 'video' ? 'Video Call' : 'Voice Call'}
            </p>
            {callStatus === 'active' && (
              <p className="text-[var(--color-green)] text-sm font-mono mt-2">{fmt(elapsed)}</p>
            )}
            {/* Hidden audio elements for voice-only calls */}
            <audio ref={remoteVideoRef as any} autoPlay playsInline className="hidden" />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex-shrink-0 pb-12 pt-4 px-6">
        {callStatus === 'incoming' ? (
          <div className="flex justify-center gap-8">
            <button onClick={endCall} className="w-16 h-16 rounded-full bg-[var(--color-red)] flex items-center justify-center shadow-lg shadow-red-500/30 active:scale-95 transition-transform">
              <PhoneOff size={24} className="text-white" />
            </button>
            <button onClick={acceptCall} className="w-16 h-16 rounded-full bg-[var(--color-green)] flex items-center justify-center shadow-lg shadow-green-500/30 active:scale-95 transition-transform">
              <Phone size={24} className="text-white" />
            </button>
          </div>
        ) : (
          <div className="flex justify-center gap-5">
            <button onClick={toggleMute} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${muted ? 'bg-[var(--color-red)]/20 text-[var(--color-red)]' : 'bg-[var(--color-surface2)] border border-[var(--color-border)] text-[var(--color-text)]'}`}>
              {muted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            {callType === 'video' && (
              <button onClick={toggleCam} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${camOff ? 'bg-[var(--color-red)]/20 text-[var(--color-red)]' : 'bg-[var(--color-surface2)] border border-[var(--color-border)] text-[var(--color-text)]'}`}>
                {camOff ? <VideoOff size={20} /> : <Video size={20} />}
              </button>
            )}
            <button onClick={endCall} className="w-14 h-14 rounded-full bg-[var(--color-red)] flex items-center justify-center shadow-lg shadow-red-500/30 active:scale-95 transition-transform">
              <PhoneOff size={20} className="text-white" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
