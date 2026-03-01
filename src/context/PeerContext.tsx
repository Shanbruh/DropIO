import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import Peer from 'peerjs';
import type { DataConnection, MediaConnection } from 'peerjs';

const PEER_PREFIX = 'dropio-v2-';
const PROGRESS_MS = 100;

// ── Adaptive network detection ─────────────────────────────
interface NetworkProfile {
  chunkSize: number;
  maxBuffer: number;
  label: string;
}

function getNetworkProfile(): NetworkProfile {
  const nav = navigator as any;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  if (conn) {
    const type = conn.effectiveType || conn.type || '';
    const downlink = conn.downlink || 10; // Mbps
    console.log(`[DropIO] Network: type=${type}, downlink=${downlink}Mbps`);
    if (type === '4g' || downlink >= 5) {
      return { chunkSize: 256 * 1024, maxBuffer: 16 * 1024 * 1024, label: 'fast (4g/wifi)' };
    }
    if (type === '3g' || downlink >= 1) {
      return { chunkSize: 64 * 1024, maxBuffer: 4 * 1024 * 1024, label: 'medium (3g)' };
    }
    return { chunkSize: 16 * 1024, maxBuffer: 1 * 1024 * 1024, label: 'slow (2g)' };
  }
  // Default: assume decent connection
  return { chunkSize: 256 * 1024, maxBuffer: 16 * 1024 * 1024, label: 'default' };
}

// ── ICE Servers from YOUR Metered.ca account ────────────────
const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

let meteredIceServers: RTCIceServer[] | null = null;

async function fetchTurnCredentials(): Promise<void> {
  try {
    const resp = await fetch(
      'https://dropio.metered.live/api/v1/turn/credentials?apiKey=3d5d6d0e088e4985bf5eab9e5a75275bb071',
      { signal: AbortSignal.timeout(8000) }
    );
    if (resp.ok) {
      const servers = await resp.json();
      if (Array.isArray(servers) && servers.length > 0) {
        meteredIceServers = servers;
        console.log('[DropIO] ✅ Got Metered TURN servers:', servers.length);
      }
    }
  } catch (e) {
    console.warn('[DropIO] ⚠ TURN fetch failed:', e);
  }
}

// Fetch immediately on page load
fetchTurnCredentials();

function getIceServers(): RTCIceServer[] {
  if (meteredIceServers) {
    return [...STUN_SERVERS, ...meteredIceServers];
  }
  // Fallback: STUN only (same-network will work, cross-network may fail)
  console.warn('[DropIO] No TURN servers available — only same-network connections will work');
  return STUN_SERVERS;
}

function makePeerConfig() {
  return {
    host: '0.peerjs.com',
    port: 443,
    path: '/',
    secure: true,
    debug: 1,
    config: {
      iceServers: getIceServers(),
      iceCandidatePoolSize: 10,
    },
  };
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'me' | 'peer';
  timestamp: number;
  type?: 'text' | 'voice';
  audioUrl?: string;
  audioDuration?: number;
}

export interface FileTransferItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  speed: number;
  status: 'sending' | 'receiving' | 'complete' | 'error';
  direction: 'send' | 'receive';
  url?: string;
  fileType?: string;
}

export type CallStatus = 'idle' | 'calling' | 'incoming' | 'active';
export type CallType = 'voice' | 'video';

interface PeerContextType {
  myCode: string;
  isConnected: boolean;
  isWaiting: boolean;
  isConnecting: boolean;
  error: string;
  messages: ChatMessage[];
  transfers: FileTransferItem[];
  callStatus: CallStatus;
  callType: CallType;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  createSession: () => void;
  joinSession: (code: string) => void;
  sendMessage: (text: string) => void;
  sendVoiceNote: (blob: Blob, duration: number) => void;
  sendFile: (file: File) => void;
  sendFiles: (files: File[]) => void;
  disconnect: () => void;
  clearError: () => void;
  startCall: (type: CallType) => void;
  acceptCall: () => void;
  endCall: () => void;
}

const PeerContext = createContext<PeerContextType | null>(null);

export const usePeer = () => {
  const ctx = useContext(PeerContext);
  if (!ctx) throw new Error('usePeer must be used within PeerProvider');
  return ctx;
};

const uid = (): string => Math.random().toString(36).slice(2, 11) + Date.now().toString(36);

interface ActiveRecv {
  id: string; name: string; size: number; mime: string;
  parts: Blob[]; received: number; startTime: number;
}

export function PeerProvider({ children }: { children: React.ReactNode }) {
  const [myCode, setMyCode] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [transfers, setTransfers] = useState<FileTransferItem[]>([]);
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [callType, setCallType] = useState<CallType>('voice');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const mediaConnRef = useRef<MediaConnection | null>(null);
  const recvRef = useRef<ActiveRecv | null>(null);
  const sendingRef = useRef(false);
  const queueRef = useRef<{ file: File; id: string }[]>([]);
  const progressTsRef = useRef<Map<string, number>>(new Map());
  const pendingCallTypeRef = useRef<CallType>('voice');
  const destroyedRef = useRef(false);

  const clearError = useCallback(() => setError(''), []);

  const updateProgress = useCallback((id: string, progress: number, speed: number, force = false) => {
    const now = Date.now();
    const last = progressTsRef.current.get(id) ?? 0;
    if (!force && now - last < PROGRESS_MS) return;
    progressTsRef.current.set(id, now);
    setTransfers(p => p.map(t => (t.id === id ? { ...t, progress, speed } : t)));
  }, []);

  // ── Call helpers ──────────────────────────────────────────
  const stopStream = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach(t => t.stop());
  }, []);

  const endCall = useCallback(() => {
    try { mediaConnRef.current?.close(); } catch { /* */ }
    stopStream(localStream);
    stopStream(remoteStream);
    mediaConnRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setCallStatus('idle');
    try { connRef.current?.send({ t: 'call-end' }); } catch { /* */ }
  }, [localStream, remoteStream, stopStream]);

  const handleMediaConn = useCallback((mc: MediaConnection, stream: MediaStream) => {
    mediaConnRef.current = mc;
    mc.on('stream', (remote) => {
      setRemoteStream(remote);
      setCallStatus('active');
    });
    mc.on('close', () => {
      stopStream(stream);
      setLocalStream(null);
      setRemoteStream(null);
      setCallStatus('idle');
      mediaConnRef.current = null;
    });
    mc.on('error', () => {
      stopStream(stream);
      setLocalStream(null);
      setRemoteStream(null);
      setCallStatus('idle');
      mediaConnRef.current = null;
    });
  }, [stopStream]);

  const startCall = useCallback(async (type: CallType) => {
    const peer = peerRef.current;
    const conn = connRef.current;
    if (!peer || !conn?.open) return;
    setCallType(type);
    setCallStatus('calling');
    conn.send({ t: 'call-req', callType: type });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video',
      });
      setLocalStream(stream);
      const mc = peer.call(conn.peer, stream, { metadata: { callType: type } });
      handleMediaConn(mc, stream);
    } catch {
      setCallStatus('idle');
      setError('Could not access microphone/camera');
    }
  }, [handleMediaConn]);

  const acceptCall = useCallback(async () => {
    const type = pendingCallTypeRef.current;
    setCallType(type);
    setCallStatus('active');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video',
      });
      setLocalStream(stream);
      const mc = mediaConnRef.current;
      if (mc) {
        mc.answer(stream);
        handleMediaConn(mc, stream);
      }
      connRef.current?.send({ t: 'call-accept' });
    } catch {
      setCallStatus('idle');
      setError('Could not access microphone/camera');
    }
  }, [handleMediaConn]);

  // ── Handle incoming data ──────────────────────────────────
  const handleDataRef = useRef<(data: unknown) => void>(() => {});

  const handleData = useCallback((data: unknown) => {
    if (data instanceof ArrayBuffer || data instanceof Uint8Array || data instanceof Blob) {
      const r = recvRef.current;
      if (!r) return;
      let blob: Blob; let size: number;
      if (data instanceof Blob) { blob = data; size = data.size; }
      else if (data instanceof ArrayBuffer) { blob = new Blob([data]); size = data.byteLength; }
      else {
        const u8 = data as Uint8Array;
        const copy = new Uint8Array(u8.byteLength);
        copy.set(u8);
        blob = new Blob([copy.buffer as ArrayBuffer]);
        size = u8.byteLength;
      }
      r.parts.push(blob);
      r.received += size;
      if (r.parts.length >= 500) r.parts = [new Blob(r.parts)];
      const progress = Math.min(r.received / r.size, 1);
      const elapsed = (Date.now() - r.startTime) / 1000;
      const speed = elapsed > 0 ? r.received / elapsed : 0;
      updateProgress(r.id, progress, speed);
      return;
    }

    if (typeof data === 'object' && data !== null) {
      const m = data as Record<string, unknown>;

      if (m.t === 'chat') {
        const audioData = m.audioData as string | undefined;
        setMessages(p => [...p, {
          id: (m.id as string) ?? uid(), text: m.text as string, sender: 'peer', timestamp: (m.ts as number) ?? Date.now(),
          type: (m.msgType as 'text' | 'voice') ?? 'text',
          audioUrl: audioData ? URL.createObjectURL(
            new Blob([Uint8Array.from(atob(audioData), c => c.charCodeAt(0))], { type: 'audio/webm' })
          ) : undefined,
          audioDuration: m.audioDuration as number | undefined,
        }]);
        return;
      }
      if (m.t === 'fs') {
        recvRef.current = {
          id: m.id as string, name: m.name as string, size: m.size as number,
          mime: (m.mime as string) ?? 'application/octet-stream',
          parts: [], received: 0, startTime: Date.now(),
        };
        setTransfers(p => [...p, {
          id: m.id as string, name: m.name as string, size: m.size as number, progress: 0, speed: 0,
          status: 'receiving', direction: 'receive', fileType: m.mime as string,
        }]);
        return;
      }
      if (m.t === 'fe') {
        const r = recvRef.current;
        if (r && r.id === m.id) {
          const blob = new Blob(r.parts, { type: r.mime });
          const url = URL.createObjectURL(blob);
          r.parts = [];
          recvRef.current = null;
          setTransfers(p => p.map(t =>
            t.id === (m.id as string) ? { ...t, status: 'complete' as const, progress: 1, speed: 0, url } : t
          ));
          progressTsRef.current.delete(m.id as string);
        }
        return;
      }
      if (m.t === 'call-req') {
        pendingCallTypeRef.current = (m.callType as CallType) || 'voice';
        setCallType((m.callType as CallType) || 'voice');
        setCallStatus('incoming');
        return;
      }
      if (m.t === 'call-accept') {
        setCallStatus('active');
        return;
      }
      if (m.t === 'call-end') {
        try { mediaConnRef.current?.close(); } catch { /* */ }
        mediaConnRef.current = null;
        setLocalStream(prev => { prev?.getTracks().forEach(t => t.stop()); return null; });
        setRemoteStream(prev => { prev?.getTracks().forEach(t => t.stop()); return null; });
        setCallStatus('idle');
        return;
      }
      if (m.t === 'ping') {
        try { connRef.current?.send({ t: 'pong' }); } catch { /* */ }
        return;
      }
    }
  }, [updateProgress]);

  // Keep ref always up to date
  useEffect(() => {
    handleDataRef.current = handleData;
  }, [handleData]);

  // ── Wire up a DataConnection ────────────────────────────────
  const wireConn = useCallback((conn: DataConnection) => {
    connRef.current = conn;

    conn.on('open', () => {
      console.log('[DropIO] DataConnection OPEN');
      setIsConnected(true);
      setIsWaiting(false);
      setIsConnecting(false);
      setError('');
      // Force arraybuffer for binary
      try {
        const dc = (conn as any).dataChannel ?? (conn as any)._dc;
        if (dc) dc.binaryType = 'arraybuffer';
      } catch { /* */ }
    });

    conn.on('data', (raw: unknown) => {
      handleDataRef.current(raw);
    });

    conn.on('close', () => {
      console.log('[DropIO] DataConnection CLOSED');
      setIsConnected(false);
      connRef.current = null;
    });

    conn.on('error', (e) => {
      console.error('[DropIO] DataConnection error:', e);
    });
  }, []);

  const setupPeerCallListener = useCallback((peer: Peer) => {
    peer.on('call', (mc) => {
      mediaConnRef.current = mc;
      const ct = mc.metadata?.callType || 'voice';
      pendingCallTypeRef.current = ct;
      setCallType(ct);
      setCallStatus('incoming');
    });
  }, []);

  const cleanup = useCallback(() => {
    destroyedRef.current = true;
    try { connRef.current?.close(); } catch { /* */ }
    try { mediaConnRef.current?.close(); } catch { /* */ }
    try { peerRef.current?.destroy(); } catch { /* */ }
    connRef.current = null;
    mediaConnRef.current = null;
    peerRef.current = null;
    setIsConnected(false);
    setIsWaiting(false);
    setIsConnecting(false);
    setMyCode('');
  }, []);

  const disconnect = useCallback(() => {
    stopStream(localStream);
    stopStream(remoteStream);
    cleanup();
    setMessages([]);
    setTransfers([]);
    setCallStatus('idle');
    setLocalStream(null);
    setRemoteStream(null);
    recvRef.current = null;
    sendingRef.current = false;
    queueRef.current = [];
    progressTsRef.current.clear();
  }, [cleanup, localStream, remoteStream, stopStream]);

  const genCode = useCallback((): string => {
    const c = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length: 3 }, () => c[Math.floor(Math.random() * c.length)]).join('');
  }, []);

  // ── CREATE SESSION ────────────────────────────────────────
  const createSession = useCallback(() => {
    cleanup();
    destroyedRef.current = false;
    setIsWaiting(true);
    setError('');

    let attempts = 0;
    const maxAttempts = 5;

    const tryCreate = () => {
      if (destroyedRef.current) return;
      attempts++;
      const code = genCode();
      const peerId = PEER_PREFIX + code;

      console.log(`[DropIO] Creating room "${code}" (attempt ${attempts})`);

      const peer = new Peer(peerId, makePeerConfig());
      peerRef.current = peer;

      const timeout = setTimeout(() => {
        console.warn(`[DropIO] Server timeout (attempt ${attempts})`);
        try { peer.destroy(); } catch { /* */ }
        if (!destroyedRef.current && attempts < maxAttempts) {
          setTimeout(tryCreate, 500);
        } else if (!destroyedRef.current) {
          setError('Server not responding. Check your internet and try again.');
          setIsWaiting(false);
        }
      }, 15000);

      peer.on('open', (id) => {
        clearTimeout(timeout);
        console.log(`[DropIO] Server connected! ID: ${id}, Code: ${code}`);
        setMyCode(code);
      });

      peer.on('connection', (incoming) => {
        console.log('[DropIO] Incoming connection from peer');
        wireConn(incoming);
      });

      setupPeerCallListener(peer);

      peer.on('error', (err: any) => {
        clearTimeout(timeout);
        const errType = err?.type ?? '';
        console.error(`[DropIO] Peer error: ${errType}`, err?.message);

        if (errType === 'unavailable-id' && !destroyedRef.current && attempts < maxAttempts) {
          try { peer.destroy(); } catch { /* */ }
          setTimeout(tryCreate, 300);
        } else if (!destroyedRef.current) {
          setError(errType === 'unavailable-id'
            ? 'Room code collision. Try again.'
            : `Connection error: ${err?.message || errType}`
          );
          setIsWaiting(false);
        }
      });

      peer.on('disconnected', () => {
        console.warn('[DropIO] Disconnected from signaling server, reconnecting...');
        if (peerRef.current === peer && !peer.destroyed && !destroyedRef.current) {
          setTimeout(() => {
            try { peer.reconnect(); } catch { /* */ }
          }, 1000);
        }
      });
    };

    tryCreate();
  }, [cleanup, genCode, wireConn, setupPeerCallListener]);

  // ── JOIN SESSION ──────────────────────────────────────────
  const joinSession = useCallback((code: string) => {
    cleanup();
    destroyedRef.current = false;
    setIsConnecting(true);
    setError('');

    const normalizedCode = code.toLowerCase().trim();
    const targetPeerId = PEER_PREFIX + normalizedCode;

    let attempts = 0;
    const maxAttempts = 3;

    const tryJoin = () => {
      if (destroyedRef.current) return;
      attempts++;

      console.log(`[DropIO] Joining room "${normalizedCode}" → peer "${targetPeerId}" (attempt ${attempts})`);

      const peer = new Peer(makePeerConfig());
      peerRef.current = peer;

      let connected = false;

      const timeout = setTimeout(() => {
        if (!connected && !destroyedRef.current) {
          console.warn(`[DropIO] Join timeout (attempt ${attempts})`);
          try { peer.destroy(); } catch { /* */ }
          if (attempts < maxAttempts) {
            setTimeout(tryJoin, 1000);
          } else {
            setError('Connection timed out. Make sure the other device has the room open and both are online.');
            setIsConnecting(false);
          }
        }
      }, 20000);

      peer.on('open', (myId) => {
        console.log(`[DropIO] Signaling server connected, my ID: ${myId}`);
        console.log(`[DropIO] Connecting to peer: ${targetPeerId}`);

        const conn = peer.connect(targetPeerId, { reliable: true });

        conn.on('open', () => {
          connected = true;
          clearTimeout(timeout);
          console.log('[DropIO] DataConnection OPEN - connected to peer!');
          connRef.current = conn;
          setIsConnected(true);
          setIsWaiting(false);
          setIsConnecting(false);
          setError('');
          try {
            const dc = (conn as any).dataChannel ?? (conn as any)._dc;
            if (dc) dc.binaryType = 'arraybuffer';
          } catch { /* */ }
        });

        conn.on('data', (raw: unknown) => {
          handleDataRef.current(raw);
        });

        conn.on('close', () => {
          console.log('[DropIO] DataConnection closed');
          setIsConnected(false);
          connRef.current = null;
        });

        conn.on('error', (e: any) => {
          console.error('[DropIO] DataConnection error:', e);
          if (!connected && !destroyedRef.current) {
            clearTimeout(timeout);
            try { peer.destroy(); } catch { /* */ }
            if (attempts < maxAttempts) {
              setTimeout(tryJoin, 1000);
            } else {
              setError('Connection failed. Try again.');
              setIsConnecting(false);
            }
          }
        });
      });

      setupPeerCallListener(peer);

      peer.on('error', (err: any) => {
        const errType = err?.type ?? '';
        console.error(`[DropIO] Peer error: ${errType}`, err?.message);

        if (errType === 'peer-unavailable') {
          clearTimeout(timeout);
          connected = true; // prevent timeout handler
          setError('Room not found. Check the code and make sure the other device is waiting.');
          setIsConnecting(false);
          try { peer.destroy(); } catch { /* */ }
        } else if (!connected && !destroyedRef.current) {
          clearTimeout(timeout);
          try { peer.destroy(); } catch { /* */ }
          if (attempts < maxAttempts) {
            setTimeout(tryJoin, 1000);
          } else {
            setError(`Connection failed: ${err?.message || errType}`);
            setIsConnecting(false);
          }
        }
      });

      peer.on('disconnected', () => {
        if (!connected && peerRef.current === peer && !peer.destroyed && !destroyedRef.current) {
          console.warn('[DropIO] Signaling disconnected, retrying...');
          setTimeout(() => {
            try { peer.reconnect(); } catch { /* */ }
          }, 1000);
        }
      });
    };

    tryJoin();
  }, [cleanup, setupPeerCallListener]);

  // ── Send message ──────────────────────────────────────────
  const sendMessage = useCallback((text: string) => {
    const conn = connRef.current;
    if (!conn?.open) return;
    const msg: ChatMessage = { id: uid(), text, sender: 'me', timestamp: Date.now(), type: 'text' };
    conn.send({ t: 'chat', id: msg.id, text, ts: msg.timestamp, msgType: 'text' });
    setMessages(p => [...p, msg]);
  }, []);

  const sendVoiceNote = useCallback((blob: Blob, duration: number) => {
    const conn = connRef.current;
    if (!conn?.open) return;
    const reader = new FileReader();
    reader.onload = () => {
      const arr = reader.result as ArrayBuffer;
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arr)));
      const id = uid();
      const audioUrl = URL.createObjectURL(blob);
      conn.send({
        t: 'chat', id, text: '🎤 Voice note', ts: Date.now(),
        msgType: 'voice', audioData: base64, audioDuration: duration,
      });
      setMessages(p => [...p, {
        id, text: '🎤 Voice note', sender: 'me', timestamp: Date.now(),
        type: 'voice', audioUrl, audioDuration: duration,
      }]);
    };
    reader.readAsArrayBuffer(blob);
  }, []);

  // ── File transfer ─────────────────────────────────────────
  const waitForBuffer = useCallback(async (conn: DataConnection, maxBuf: number) => {
    const dc = (conn as any).dataChannel ?? (conn as any)._dc;
    if (!dc) return;
    while (dc.bufferedAmount > maxBuf) {
      await new Promise(r => setTimeout(r, 10));
      if (dc.readyState !== 'open') throw new Error('Connection lost during transfer');
    }
  }, []);

  const doSend = useCallback(async (file: File, id: string) => {
    const conn = connRef.current;
    if (!conn?.open) throw new Error('Not connected');

    const net = getNetworkProfile();
    console.log(`[DropIO] Sending "${file.name}" (${(file.size / 1048576).toFixed(1)}MB) — network: ${net.label}, chunk: ${net.chunkSize / 1024}KB`);

    conn.send({ t: 'fs', id, name: file.name, size: file.size, mime: file.type || 'application/octet-stream' });
    await new Promise(r => setTimeout(r, 50));

    const t0 = Date.now();
    let sent = 0;
    const chunkSize = net.chunkSize;
    const maxBuf = net.maxBuffer;

    for (let off = 0; off < file.size; off += chunkSize) {
      if (!conn.open) throw new Error('Connection lost');
      const end = Math.min(off + chunkSize, file.size);
      const chunk = await file.slice(off, end).arrayBuffer();
      conn.send(chunk);
      sent += chunk.byteLength;
      await waitForBuffer(conn, maxBuf);

      const now = Date.now();
      const elapsed = (now - t0) / 1000;
      const speed = elapsed > 0 ? sent / elapsed : 0;
      updateProgress(id, sent / file.size, speed);
    }

    // Wait for buffer to drain completely
    const dc = (conn as any).dataChannel ?? (conn as any)._dc;
    if (dc) {
      while (dc.bufferedAmount > 0) {
        await new Promise(r => setTimeout(r, 20));
        if (dc.readyState !== 'open') break;
      }
    }
    await new Promise(r => setTimeout(r, 150));
    conn.send({ t: 'fe', id });
  }, [updateProgress, waitForBuffer]);

  const processQueue = useCallback(async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    while (queueRef.current.length > 0) {
      const { file, id } = queueRef.current[0];
      try {
        await doSend(file, id);
        setTransfers(p => p.map(t => t.id === id ? { ...t, status: 'complete' as const, progress: 1, speed: 0 } : t));
      } catch (err) {
        console.error('[DropIO] Send error:', err);
        setTransfers(p => p.map(t => t.id === id ? { ...t, status: 'error' as const, speed: 0 } : t));
      }
      progressTsRef.current.delete(id);
      queueRef.current.shift();
    }
    sendingRef.current = false;
  }, [doSend]);

  const sendFile = useCallback((file: File) => {
    if (!connRef.current?.open) return;
    const id = uid();
    setTransfers(p => [...p, {
      id, name: file.name, size: file.size, progress: 0, speed: 0,
      status: 'sending', direction: 'send', fileType: file.type,
    }]);
    queueRef.current.push({ file, id });
    processQueue();
  }, [processQueue]);

  const sendFiles = useCallback((files: File[]) => {
    files.forEach(f => sendFile(f));
  }, [sendFile]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroyedRef.current = true;
      try { connRef.current?.close(); } catch { /* */ }
      try { peerRef.current?.destroy(); } catch { /* */ }
    };
  }, []);

  return (
    <PeerContext.Provider value={{
      myCode, isConnected, isWaiting, isConnecting, error,
      messages, transfers, callStatus, callType, localStream, remoteStream,
      createSession, joinSession, sendMessage, sendVoiceNote, sendFile, sendFiles,
      disconnect, clearError, startCall, acceptCall, endCall,
    }}>
      {children}
    </PeerContext.Provider>
  );
}
