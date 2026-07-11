import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { Meeting, UserProfile, MeetingResponse, QuizQuestion, StudentQuizSubmission } from "../types";
import { db, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, addDoc, deleteDoc } from "../firebase";
import { 
  Video, VideoOff, Mic, MicOff, PhoneOff, Users, MessageSquare, 
  Play, Pause, Award, AlertCircle, CheckCircle, HelpCircle, Sparkles, Send, Bell,
  Minimize2, Maximize2, FileCheck, Clock, LayoutGrid, LayoutTemplate, Monitor, LogOut,
  Hand, Pin, Trash, Settings
} from "lucide-react";

interface MeetingRoomProps {
  meeting: Meeting;
  user: UserProfile;
  onLeave: () => void;
}

interface ChatMessage {
  id: string;
  senderName: string;
  senderRole: string;
  message: string;
  timestamp: string;
}

interface ActiveParticipant {
  id: string;
  name: string;
  role: string;
  videoEnabled: boolean;
  micEnabled: boolean;
  joinedAt: string;
  handRaised?: boolean;
  handRaisedAt?: string | null;
  lastActive?: string;
  cameraStreamId?: string | null;
  screenStreamId?: string | null;
}

const DEFAULT_MEETING_QUIZZES: QuizQuestion[] = [
  {
    question: "How can students earn active attendance credit in real-time?",
    options: [
      "By keeping the tab in background without answering popups",
      "By responding to randomized presence checks and answering milestone checkpoints",
      "By sending a generic chat comment at the very end of class",
      "By logging out immediately after connection is recorded"
    ],
    correctAnswerIndex: 1,
    category: "Participation Rules"
  },
  {
    question: "What happens when a student misses a live synchronized lesson?",
    options: [
      "The student permanently loses course credits by default",
      "The student can study the Lesson Replay and solve unique alternative verification quizzes",
      "An offline test must be manually requested through mail servers",
      "No recovery method is available"
    ],
    correctAnswerIndex: 1,
    category: "Asynchronous Recovery"
  },
  {
    question: "What is correct about real-time interactive responses?",
    options: [
      "Responses are discarded when the meeting ends",
      "Grading and attendance logs synchronize instantly to the teacher's dashboard via persistent cloud database",
      "Student answers are private and not shared with teachers",
      "They can only be checked on mobile applications"
    ],
    correctAnswerIndex: 1,
    category: "Real-time Sync"
  }
];

// Helper sub-component to render live remote participant streams,
// using real WebRTC streams with beautiful virtual digitized fallback animations.
// Memoized so React skips re-render (and avoids video srcObject flicker) unless
// the actual stream reference or participant state changes.
const RemoteVideo = React.memo(({ p, stream }: { p: ActiveParticipant; stream?: MediaStream }) => {
  return (
    <div className="w-full h-full bg-slate-950 flex items-center justify-center relative overflow-hidden">
      {p.videoEnabled && stream ? (
        <video
          ref={(el) => {
            if (el && el.srcObject !== stream) {
              el.srcObject = stream;
            }
          }}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      ) : p.videoEnabled ? (
        /* High-fidelity camera stream active digitized simulation */
        <div className="w-full h-full bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.15)_0%,transparent_100%)] animate-pulse" />
          
          {/* Scanning camera artifacts */}
          <div className="absolute inset-0 bg-scanlines opacity-[0.03] pointer-events-none" />
          
          {/* Spinning camera circles */}
          <div className="absolute w-40 h-40 rounded-full border border-indigo-500/10 flex items-center justify-center animate-spin [animation-duration:15s] pointer-events-none">
            <div className="w-32 h-32 rounded-full border border-dashed border-indigo-500/20" />
          </div>

          {/* User Initial Avatar in Center */}
          <div className="w-16 h-16 rounded-3xl bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center font-bold text-2xl uppercase text-indigo-400 shadow-xl shadow-black/20 relative z-10 scale-[1.05] animate-pulse">
            {p.name.charAt(0)}
          </div>

          {/* Sound bar overlay */}
          {p.micEnabled && (
            <div className="absolute bottom-12 inset-x-0 flex justify-center gap-1.5 opacity-40 z-10">
              <div className="w-1.5 h-6 bg-indigo-400 animate-[bounce_1s_infinite_100ms] rounded-full" />
              <div className="w-1.5 h-10 bg-indigo-400 animate-[bounce_1s_infinite_300ms] rounded-full" />
              <div className="w-1.5 h-7 bg-indigo-400 animate-[bounce_1s_infinite_200ms] rounded-full" />
              <div className="w-1.5 h-4 bg-indigo-400 animate-[bounce_1s_infinite_400ms] rounded-full" />
            </div>
          )}

          {/* "LIVE FEED DIGITIZED" banner */}
          <div className="absolute top-4 right-4 bg-slate-950/80 backdrop-blur-md px-2 py-0.5 rounded border border-white/10 text-[8px] font-bold text-emerald-400 font-mono tracking-widest uppercase flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-emerald-400 animate-ping" />
            <span>Transmitting</span>
          </div>
        </div>
      ) : (
        /* Video Disabled (Standard Avatar mode) */
        <div className="w-full h-full bg-slate-900 border border-white/5 flex items-center justify-center relative">
          <div className="w-20 h-20 rounded-xl bg-slate-800 border border-white/10 flex items-center justify-center text-slate-350 font-bold text-2xl uppercase">
            {p.name.charAt(0)}
          </div>
          {stream && (
            <audio
              ref={(el) => {
                if (el && el.srcObject !== stream) {
                  el.srcObject = stream;
                }
              }}
              autoPlay
              playsInline
            />
          )}
        </div>
      )}
    </div>
  );
}, (prev, next) => {
  // Only re-render if the stream reference or relevant participant display fields change
  return (
    prev.stream === next.stream &&
    prev.p.videoEnabled === next.p.videoEnabled &&
    prev.p.micEnabled === next.p.micEnabled &&
    prev.p.name === next.p.name &&
    prev.p.id === next.p.id
  );
});

export const MeetingRoom: React.FC<MeetingRoomProps> = ({ meeting, user, onLeave }) => {
  const isHost = user.role === "teacher" || user.uid === meeting.hostId;
  const responseId = `${meeting.id}_${user.uid}`;

  // Stream toggles
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null); // ref for stale-closure-safe access

  // WebRTC mesh synchronization states and signaling refs
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Record<string, MediaStream>>({});
  const remoteStreamsMapRef = useRef<Record<string, Set<MediaStream>>>({});
  const activeParticipantsRef = useRef<ActiveParticipant[]>([]);
  const pcsRef = useRef<Record<string, RTCPeerConnection>>({});
  // Stable ref to the screen stream to avoid stale closures in PC callbacks
  const screenStreamRef2 = useRef<MediaStream | null>(null);
  // Tracks which peer IDs have already gone through signaling setup (to detect fresh vs reconnect)
  const initializedPeersRef = useRef<Set<string>>(new Set());
  const pcsSignalingRef = useRef<Record<string, {
    localCandidates: any[];
    signalingDocExists: boolean;
    addedRemoteCandidates: Set<string>;
  }>>({});

  const [rawParticipants, setRawParticipants] = useState<ActiveParticipant[]>([]);
  const [presenceTicker, setPresenceTicker] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setPresenceTicker((p) => p + 1);
    }, 4000);
    return () => clearInterval(t);
  }, []);

  const activeParticipants = useMemo(() => {
    const now = Date.now();
    return rawParticipants.filter((p) => {
      if (!p.lastActive) return true;
      const diff = now - new Date(p.lastActive).getTime();
      // Allow up to 300 seconds (5 minutes) for clock skew and non-graceful disconnects
      return diff <= 300000 && diff >= -300000; 
    });
  }, [rawParticipants, presenceTicker]);

  const setActiveParticipants = setRawParticipants;

  const classifyStreams = () => {
    const newRemoteStreams: Record<string, MediaStream> = {};
    const newScreenStreams: Record<string, MediaStream> = {};

    Object.keys(remoteStreamsMapRef.current).forEach((pId) => {
      const streams = remoteStreamsMapRef.current[pId];
      const p = activeParticipantsRef.current.find(part => part.id === pId);

      streams.forEach((stream) => {
        if (p && p.screenStreamId && stream.id === p.screenStreamId) {
          newScreenStreams[pId] = stream;
        } else {
          newRemoteStreams[pId] = stream;
        }
      });
    });

    // Only update state if stream references actually changed — avoids unnecessary
    // re-renders of RemoteVideo (which would cause the video element to blink).
    setRemoteStreams((prev) => {
      const prevKeys = Object.keys(prev);
      const newKeys = Object.keys(newRemoteStreams);
      if (
        prevKeys.length === newKeys.length &&
        newKeys.every((k) => prev[k] === newRemoteStreams[k])
      ) {
        return prev; // No change — keep same reference, skip re-render
      }
      return newRemoteStreams;
    });

    setRemoteScreenStreams((prev) => {
      const prevKeys = Object.keys(prev);
      const newKeys = Object.keys(newScreenStreams);
      if (
        prevKeys.length === newKeys.length &&
        newKeys.every((k) => prev[k] === newScreenStreams[k])
      ) {
        return prev;
      }
      return newScreenStreams;
    });
  };

  const getOrCreatePC = (pId: string) => {
    if (pcsRef.current[pId]) {
      return pcsRef.current[pId];
    }

    if (!pcsSignalingRef.current[pId]) {
      pcsSignalingRef.current[pId] = {
        localCandidates: [],
        signalingDocExists: false,
        addedRemoteCandidates: new Set()
      };
    }
    const sigState = pcsSignalingRef.current[pId];

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject"
        }
      ]
    });

    const isInitiator = user.uid < pId;
    const isPolite = user.uid > pId;
    const channelId = user.uid < pId ? `${user.uid}_${pId}` : `${pId}_${user.uid}`;
    const docRef = doc(db, `meetings/${meeting.id}/webrtc`, channelId);

    // Use refs (not state) so the track-addition sees the current stream, not the stale closure value
    const currentLocalStream = localStreamRef.current;
    const currentScreenStream = screenStreamRef2.current;

    const hasTracks = (currentLocalStream && currentLocalStream.getTracks().length > 0) || (currentScreenStream && currentScreenStream.getTracks().length > 0);

    if (currentLocalStream) {
      currentLocalStream.getTracks().forEach((track) => {
        try {
          pc.addTrack(track, currentLocalStream);
        } catch (e) {}
      });
    }

    if (currentScreenStream) {
      currentScreenStream.getTracks().forEach((track) => {
        try {
          pc.addTrack(track, currentScreenStream);
        } catch (e) {}
      });
    }

    // Only add recvonly transceivers if we have NO local tracks to send.
    // When addTrack() is called above, it already creates sendrecv transceivers.
    // Adding recvonly ones before/after addTrack() creates duplicate mismatched
    // transceivers that silently break camera/mic transmission for the remote peer.
    if (!hasTracks) {
      pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.addTransceiver('video', { direction: 'recvonly' });
    }

    // Set up track handler immediately
    pc.ontrack = (event) => {
      if (event.streams && event.streams.length > 0) {
        if (!remoteStreamsMapRef.current[pId]) {
          remoteStreamsMapRef.current[pId] = new Set();
        }
        event.streams.forEach(stream => {
          remoteStreamsMapRef.current[pId].add(stream);
        });
        classifyStreams();
      }
    };

    // Gather ICE candidates and push safely to Firestore once document exists
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candJson = event.candidate.toJSON();
        sigState.localCandidates.push(candJson);
        if (sigState.signalingDocExists) {
          updateDoc(docRef, {
            [isInitiator ? "candidates_initiator" : "candidates_receiver"]: sigState.localCandidates
          }).catch((err) => console.warn("[WebRTC] Error updating ICE candidates:", err));
        }
      }
    };

    pc.onnegotiationneeded = async () => {
      // Only the initiator (lexicographically smaller UID) should create the initial offer.
      if (!isInitiator) {
        console.log(`[WebRTC] Responder skipping negotiation offer for peer ${pId}`);
        return;
      }
      try {
        console.log(`[WebRTC] Negotiation needed for peer ${pId}`);
        const offer = await pc.createOffer();
        if (pc.signalingState === 'closed') return;
        await pc.setLocalDescription(offer);
        await setDoc(docRef, {
          offer: { type: "offer", sdp: offer.sdp },
          offerBy: user.uid,
          answer: null,
          answerBy: null,
          candidates_initiator: sigState.localCandidates,
          candidates_receiver: []
        });
        sigState.signalingDocExists = true;
      } catch (err) {
        console.warn("[WebRTC] Error during negotiation offer creation:", err);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.warn(`[WebRTC] Connection state ${pc.connectionState} for ${pId}, attempting ICE restart.`);
        if (isInitiator) {
          pc.createOffer({ iceRestart: true }).then(async (offer) => {
            if (pc.signalingState === 'closed') return;
            await pc.setLocalDescription(offer);
            await setDoc(docRef, {
              offer: { type: "offer", sdp: offer.sdp },
              offerBy: user.uid,
              answer: null,
              answerBy: null,
              candidates_initiator: sigState.localCandidates,
              candidates_receiver: []
            });
            sigState.signalingDocExists = true;
          }).catch((err) => console.warn("[WebRTC] ICE restart failed:", err));
        }
      }
    };

    pcsRef.current[pId] = pc;
    return pc;
  };

  // Classroom stats tracking state
  const [popupShown, setPopupShown] = useState(0);
  const [popupClicked, setPopupClicked] = useState(0);
  const [answers, setAnswers] = useState<StudentQuizSubmission[]>([]);
  const [scorePercentage, setScorePercentage] = useState(100);

  // Real-time dynamic sync stats of the meeting doc from Firestore database
  const [meetingState, setMeetingState] = useState<Meeting>(meeting);
  const [activeQuizzesList, setActiveQuizzesList] = useState<QuizQuestion[]>(meeting.quizzes || []);

  // demoMode state setter
  const [demoMode, setDemoMode] = useState(false);

  // Active speaker detection states
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const audioAnalysersRef = useRef<Record<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode }>>({});
  const audioContextRef = useRef<AudioContext | null>(null);

  const setupAudioAnalysis = (id: string, stream: MediaStream | null) => {
    if (!stream || stream.getAudioTracks().length === 0) {
      cleanupAudioAnalysis(id);
      return;
    }

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      // If already set up for this id, keep it!
      const existing = audioAnalysersRef.current[id];
      if (existing) {
        return;
      }

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      audioAnalysersRef.current[id] = { analyser, source };
    } catch (e) {
      console.warn("Failed to setup audio analysis for", id, e);
    }
  };

  const cleanupAudioAnalysis = (id: string) => {
    const entry = audioAnalysersRef.current[id];
    if (entry) {
      try {
        entry.source.disconnect();
      } catch (e) {}
      delete audioAnalysersRef.current[id];
    }
  };

  // Synchronize audio analysers when localStream or remoteStreams change
  useEffect(() => {
    if (localStream) {
      setupAudioAnalysis(user.uid, localStream);
    } else {
      cleanupAudioAnalysis(user.uid);
    }

    Object.keys(remoteStreams).forEach((pId) => {
      const stream = remoteStreams[pId];
      setupAudioAnalysis(pId, stream);
    });

    // Cleanup stale analysers
    Object.keys(audioAnalysersRef.current).forEach((id) => {
      if (id !== user.uid && !remoteStreams[id]) {
        cleanupAudioAnalysis(id);
      }
    });
  }, [localStream, remoteStreams, user.uid]);

  // Clean up all analysers on unmount
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      Object.keys(audioAnalysersRef.current).forEach((id) => {
        cleanupAudioAnalysis(id);
      });
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Poll analyser volume levels to detect active speaker
  useEffect(() => {
    const interval = setInterval(() => {
      let maxVal = -1;
      let loudestSpeakerId: string | null = null;
      const threshold = 12; // sensitivity threshold for speaking

      Object.keys(audioAnalysersRef.current).forEach((id) => {
        const entry = audioAnalysersRef.current[id];
        if (!entry || !entry.analyser) return;

        let isMuted = false;
        if (id === user.uid) {
          isMuted = !micEnabled;
        } else {
          const p = activeParticipants.find(part => part.id === id);
          if (p) {
            isMuted = !p.micEnabled;
          }
        }

        if (isMuted) return;

        const { analyser } = entry;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;

        if (average > threshold && average > maxVal) {
          maxVal = average;
          loudestSpeakerId = id;
        }
      });

      if (loudestSpeakerId) {
        setActiveSpeakerId(loudestSpeakerId);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [activeParticipants, micEnabled, user.uid]);

  // Next scheduled timestamp logic for presence checks (default to 10 minutes)
  const [nextPopupAtSecond, setNextPopupAtSecond] = useState<number>(600);

  // Running live feedback array for teacher's scoreboard
  const [liveResponses, setLiveResponses] = useState<MeetingResponse[]>([]);

  // Automatic AI live transcript checks triggers
  const [lastLiveQuizGeneratedAt, setLastLiveQuizGeneratedAt] = useState(0);
  const [generatingLiveQuiz, setGeneratingLiveQuiz] = useState(false);

  // Active quiz state
  const [currentQuiz, setCurrentQuiz] = useState<QuizQuestion | null>(null);
  const [currentQuizIndex, setCurrentQuizIndex] = useState<number>(-1);
  const [hasAnsweredCurrent, setHasAnsweredCurrent] = useState(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  // Attention check popup state
  const [showAvailabilityPopup, setShowAvailabilityPopup] = useState(false);
  const [popupTimer, setPopupTimer] = useState(10); // 10 seconds to click!

  // Messaging state
  const [chatOpen, setChatOpen] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const prevChatMessagesLengthRef = useRef(0);

  useEffect(() => {
    if (chatOpen) {
      setUnreadChatCount(0);
    } else {
      const newMsgsCount = chatMessages.length - prevChatMessagesLengthRef.current;
      if (newMsgsCount > 0) {
        setUnreadChatCount((c) => c + newMsgsCount);
      }
    }
    prevChatMessagesLengthRef.current = chatMessages.length;
  }, [chatMessages, chatOpen]);

  // BetterClass Layout Settings
  const [meetLayout, setMeetLayout] = useState<'grid' | 'sidebar' | 'spotlight'>('grid');

  // Screen Sharing State
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null); // ref to avoid stale closure in onended handler
  // Keep screenStreamRef2 in sync with screenStream for getOrCreatePC
  useEffect(() => { screenStreamRef2.current = screenStream; }, [screenStream]);

  // Hand Raise State
  const [handRaised, setHandRaised] = useState(false);
  const [handRaisedAt, setHandRaisedAt] = useState<string | null>(null);

  // Presenter tools floating popup — Picture in Picture API
  const [showMinimizedPopup, setShowMinimizedPopup] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [minPopupPos, setMinPopupPos] = useState({ x: 20, y: 120 });
  const [minPopupDragging, setMinPopupDragging] = useState(false);
  const minPopupDragStart = useRef({ x: 0, y: 0 });

  // Sidebar Tab state
  const [sidebarTab, setSidebarTab] = useState<'chat' | 'people'>('chat');

  // Participants sidebar state (opened via present-count click or hand-raise queue indicator)
  const [showParticipantsSidebar, setShowParticipantsSidebar] = useState(false);


  const renderParticipantHostControls = (p: ActiveParticipant) => {
    if (!isHost || p.id === user.uid) return null;
    return (
      <div className="absolute top-2 right-2 flex items-center gap-1.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleParticipantMic(p.id, p.micEnabled);
          }}
          className={`p-1.5 rounded-lg border transition-all cursor-pointer backdrop-blur-md shadow-sm ${
            p.micEnabled 
              ? "bg-slate-950/70 border-white/10 text-slate-350 hover:bg-slate-900/90 hover:text-white" 
              : "bg-red-500/80 border-red-500/20 text-white hover:bg-red-600/90"
          }`}
          title={p.micEnabled ? "Mute student" : "Unmute student"}
        >
          {p.micEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            turnOffParticipantCam(p.id);
          }}
          disabled={!p.videoEnabled}
          className={`p-1.5 rounded-lg border transition-all cursor-pointer disabled:opacity-35 backdrop-blur-md shadow-sm ${
            p.videoEnabled 
              ? "bg-slate-950/70 border-white/10 text-slate-350 hover:bg-slate-900/90 hover:text-white" 
              : "bg-red-500/80 border-red-500/20 text-white"
          }`}
          title="Turn off student camera"
        >
          {p.videoEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
        </button>
      </div>
    );
  };

  // Leave modals state
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showFinishConfirmModal, setShowFinishConfirmModal] = useState(false);

  // Teacher Control Room Draggable Controls
  const [tcDragOffset, setTcDragOffset] = useState({ x: 20, y: 70 });
  const [tcIsDragging, setTcIsDragging] = useState(false);
  const tcDragStartRef = useRef({ x: 0, y: 0 });
  const tcElementStartRef = useRef({ x: 0, y: 0 });
  const [tcMinimized, setTcMinimized] = useState(false);

  const spotlightParticipant = useMemo(() => {
    if (activeSpeakerId && activeSpeakerId !== user.uid) {
      const p = activeParticipants.find(part => part.id === activeSpeakerId);
      if (p) return p;
    }
    return activeParticipants[0] || null;
  }, [activeSpeakerId, activeParticipants, user.uid]);

  const allHandRaisers = [
    ...(handRaised ? [{ id: user.uid, name: `${user.name} (You)`, role: user.role, handRaisedAt }] : []),
    ...activeParticipants
      .filter((p) => p.handRaised)
      .map((p) => ({ id: p.id, name: p.name, role: p.role, handRaisedAt: p.handRaisedAt })),
  ].sort((a, b) => {
    const timeA = a.handRaisedAt ? new Date(a.handRaisedAt).getTime() : Infinity;
    const timeB = b.handRaisedAt ? new Date(b.handRaisedAt).getTime() : Infinity;
    return timeA - timeB;
  });

  // Simulation timeline & status
  const [callDuration, setCallDuration] = useState(0);
  const [recordingActive, setRecordingActive] = useState(true);

  // Browser-based MediaRecorder state (host only)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const [uploadingRecording, setUploadingRecording] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // Session Settings & Control Room states
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'controls' | 'checkpoints'>(isHost ? 'controls' : 'checkpoints');

  // Floating Checkpoints Draggable Controls
  const [chkDragOffset, setChkDragOffset] = useState({ x: 20, y: 16 });
  const [chkIsDragging, setChkIsDragging] = useState(false);
  const chkDragStartRef = useRef({ x: 0, y: 0 });
  const chkElementStartRef = useRef({ x: 0, y: 0 });
  const [chkMinimized, setChkMinimized] = useState(false);

  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    setChkIsDragging(true);
    chkDragStartRef.current = { x: e.clientX, y: e.clientY };
    chkElementStartRef.current = { x: chkDragOffset.x, y: chkDragOffset.y };
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    setChkIsDragging(true);
    chkDragStartRef.current = { x: touch.clientX, y: touch.clientY };
    chkElementStartRef.current = { x: chkDragOffset.x, y: chkDragOffset.y };
  };

  useEffect(() => {
    if (!chkIsDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - chkDragStartRef.current.x;
      const dy = e.clientY - chkDragStartRef.current.y;
      setChkDragOffset({
        x: chkElementStartRef.current.x - dx,
        y: chkElementStartRef.current.y + dy
      });
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      const touch = e.touches[0];
      const dx = touch.clientX - chkDragStartRef.current.x;
      const dy = touch.clientY - chkDragStartRef.current.y;
      setChkDragOffset({
        x: chkElementStartRef.current.x - dx,
        y: chkElementStartRef.current.y + dy
      });
    };

    const handleMouseUp = () => {
      setChkIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [chkIsDragging]);

  const handleTcDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    setTcIsDragging(true);
    tcDragStartRef.current = { x: e.clientX, y: e.clientY };
    tcElementStartRef.current = { x: tcDragOffset.x, y: tcDragOffset.y };
  };

  const handleTcTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    setTcIsDragging(true);
    tcDragStartRef.current = { x: touch.clientX, y: touch.clientY };
    tcElementStartRef.current = { x: tcDragOffset.x, y: tcDragOffset.y };
  };

  useEffect(() => {
    if (!tcIsDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - tcDragStartRef.current.x;
      const dy = e.clientY - tcDragStartRef.current.y;
      setTcDragOffset({
        x: tcElementStartRef.current.x + dx,
        y: tcElementStartRef.current.y + dy
      });
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      const touch = e.touches[0];
      const dx = touch.clientX - tcDragStartRef.current.x;
      const dy = touch.clientY - tcDragStartRef.current.y;
      setTcDragOffset({
        x: tcElementStartRef.current.x + dx,
        y: tcElementStartRef.current.y + dy
      });
    };

    const handleMouseUp = () => {
      setTcIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [tcIsDragging]);

  const togglePresenterTools = async () => {
    if (showMinimizedPopup) {
      if (pipWindow) {
        pipWindow.close();
        setPipWindow(null);
      }
      setShowMinimizedPopup(false);
    } else {
      setShowMinimizedPopup(true);
      if ('documentPictureInPicture' in window) {
        try {
          // @ts-ignore
          const pip = await window.documentPictureInPicture.requestWindow({
            width: 360,
            height: 480,
          });

          // Copy styles for Tailwind/Styling
          [...document.styleSheets].forEach((styleSheet) => {
            try {
              const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
              const style = document.createElement('style');
              style.textContent = cssRules;
              pip.document.head.appendChild(style);
            } catch (e) {
              const link = document.createElement('link');
              link.rel = 'stylesheet';
              link.type = styleSheet.type;
              link.media = styleSheet.media.mediaText || '';
              link.href = styleSheet.href || '';
              pip.document.head.appendChild(link);
            }
          });

          // Sync fonts if possible
          const fontLink = document.createElement('link');
          fontLink.rel = 'stylesheet';
          fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap';
          pip.document.head.appendChild(fontLink);

          pip.document.body.className = "bg-slate-955 font-sans antialiased text-slate-200 overflow-hidden";

          pip.addEventListener('pagehide', () => {
            setShowMinimizedPopup(false);
            setPipWindow(null);
          });

          setPipWindow(pip);
        } catch (err) {
          console.warn("PiP failed to open", err);
        }
      }
    }
  };

  useEffect(() => {
    return () => {
      if (pipWindow) {
        pipWindow.close();
      }
    };
  }, [pipWindow]);

  // Loading default meeting quizzes if empty
  useEffect(() => {
    if (!meeting.quizzes || meeting.quizzes.length === 0) {
      setActiveQuizzesList(DEFAULT_MEETING_QUIZZES);
    }
  }, [meeting.quizzes]);

  // Screen Sharing functions
  const startScreenShare = async () => {
    // If someone else is sharing, show alert
    if (meetingState?.screenShareBy && meetingState.screenShareBy !== user.uid) {
      alert(`${meetingState.screenShareByName || "Someone"} is already sharing their screen.`);
      return;
    }
    // If WE are already sharing (stale state from window switch), just stop
    if (meetingState?.screenShareBy === user.uid) {
      await stopScreenShare();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert("Screen sharing is not supported by your browser or is restricted. If you are inside the embedded preview iframe, please open the application in a new tab by clicking the icon at the top right of the preview frame to allow display capture!");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "monitor",
        },
        audio: false
      });
      
      setScreenStream(stream);
      screenStreamRef.current = stream;

      // Update Firestore meeting doc — also update presence so others see screenStreamId
      await updateDoc(doc(db, "meetings", meeting.id), {
        screenShareBy: user.uid,
        screenShareByName: user.name
      });

      // Presence update with screenStreamId for WebRTC stream classification
      const userPresenceRef = doc(db, `meetings/${meeting.id}/presence`, user.uid);
      await updateDoc(userPresenceRef, {
        screenStreamId: stream.id,
      }).catch(() => {});

      // Handle when the browser screen share "Stop sharing" button is clicked
      // Use ref to avoid stale closure
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };

    } catch (err) {
      console.warn("Display media was blocked or cancelled:", err);
      alert("Screen sharing requires browser permissions. If you are running inside the AI Studio embedded preview frame, please open the app in a new tab (using the button in the top right corner) to allow screen sharing permissions!");
    }
  };

  const stopScreenShare = async () => {
    const streamToStop = screenStreamRef.current;
    if (streamToStop) {
      streamToStop.getTracks().forEach((track) => track.stop());
    }
    screenStreamRef.current = null;
    setScreenStream(null);
    setShowMinimizedPopup(false);

    // Clear screenStreamId from presence so others know screen share ended
    try {
      const userPresenceRef = doc(db, `meetings/${meeting.id}/presence`, user.uid);
      await updateDoc(userPresenceRef, { screenStreamId: null }).catch(() => {});
    } catch (_) {}

    // Update Firestore to clear screen sharing
    try {
      await updateDoc(doc(db, "meetings", meeting.id), {
        screenShareBy: null,
        screenShareByName: null
      });
    } catch (err) {
      console.warn("Failed to clear screen share state in Firestore:", err);
    }
  };

  const toggleHand = () => {
    if (handRaised) {
      setHandRaised(false);
      setHandRaisedAt(null);
    } else {
      setHandRaised(true);
      setHandRaisedAt(new Date().toISOString());
    }
  };

  // Bulk teacher controls
  const handleMuteAll = async () => {
    try {
      for (const p of activeParticipants) {
        if (p.role !== 'teacher' && p.id !== user.uid) {
          const pRef = doc(db, `meetings/${meeting.id}/presence`, p.id);
          await updateDoc(pRef, { micEnabled: false });
        }
      }
    } catch (err) {
      console.warn("Failed to mute all:", err);
    }
  };

  const handleTurnOffAllCameras = async () => {
    try {
      for (const p of activeParticipants) {
        if (p.role !== 'teacher' && p.id !== user.uid) {
          const pRef = doc(db, `meetings/${meeting.id}/presence`, p.id);
          await updateDoc(pRef, { videoEnabled: false });
        }
      }
    } catch (err) {
      console.warn("Failed to turn off all cameras:", err);
    }
  };

  // Individual teacher controls
  const toggleParticipantMic = async (participantId: string, currentMicEnabled: boolean) => {
    try {
      const pRef = doc(db, `meetings/${meeting.id}/presence`, participantId);
      await updateDoc(pRef, { micEnabled: !currentMicEnabled });
    } catch (err) {
      console.warn("Failed to toggle participant mic:", err);
    }
  };

  const turnOffParticipantCam = async (participantId: string) => {
    try {
      const pRef = doc(db, `meetings/${meeting.id}/presence`, participantId);
      await updateDoc(pRef, { videoEnabled: false });
    } catch (err) {
      console.warn("Failed to turn off participant camera:", err);
    }
  };

  // Automatically detect leaving meeting window (tab switch, minimize, or focus loss) while screen sharing
  // Only show the popup if it's already been manually opened (not auto-open on every blur)
  useEffect(() => {
    const handleVisibilityOrBlur = () => {
      // Only auto-show the popup if screen is being shared AND popup was already shown once
      if (screenStreamRef.current && showMinimizedPopup && (document.visibilityState === 'hidden' || !document.hasFocus())) {
        // Already showing — no action needed
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityOrBlur);
    window.addEventListener("blur", handleVisibilityOrBlur);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityOrBlur);
      window.removeEventListener("blur", handleVisibilityOrBlur);
    };
  }, [showMinimizedPopup]);

  // Clean up screen sharing on unmount
  useEffect(() => {
    return () => {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;
      }
    };
  }, []);

  // Dragging logic for floating Minimized controls popup
  const handleMinPopupMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setMinPopupDragging(true);
    minPopupDragStart.current = {
      x: e.clientX - minPopupPos.x,
      y: e.clientY - minPopupPos.y
    };
  };

  const handleMinPopupTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    setMinPopupDragging(true);
    const touch = e.touches[0];
    minPopupDragStart.current = {
      x: touch.clientX - minPopupPos.x,
      y: touch.clientY - minPopupPos.y
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!minPopupDragging) return;
      setMinPopupPos({
        x: e.clientX - minPopupDragStart.current.x,
        y: e.clientY - minPopupDragStart.current.y
      });
    };
    const handleMouseUp = () => {
      setMinPopupDragging(false);
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (!minPopupDragging) return;
      const touch = e.touches[0];
      setMinPopupPos({
        x: touch.clientX - minPopupDragStart.current.x,
        y: touch.clientY - minPopupDragStart.current.y
      });
    };

    if (minPopupDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("touchmove", handleTouchMove, { passive: false });
      window.addEventListener("touchend", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [minPopupDragging]);

  // Initialize local stream once on mount
  useEffect(() => {
    let active = true;

    const initStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (!active) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
      } catch (err) {
        console.warn("Failed to get both video and audio, trying audio only...", err);
        if (active) {
          setVideoEnabled(false);
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
          if (!active) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }
          localStreamRef.current = stream;
          setLocalStream(stream);
        } catch (err2) {
          console.error("Failed to get audio only. Creating empty MediaStream for signaling...", err2);
          if (active) {
            setMicEnabled(false);
            const empty = new MediaStream();
            localStreamRef.current = empty;
            setLocalStream(empty);
          }
        }
      }
    };

    initStream();

    return () => {
      active = false;
    };
  }, []);

  // Auto-start MediaRecorder for host when localStream is ready
  useEffect(() => {
    if (!isHost || !localStream || localStream.getTracks().length === 0) return;
    if (mediaRecorderRef.current) return; // already recording

    try {
      const combinedStream = new MediaStream([
        ...localStream.getVideoTracks(),
        ...localStream.getAudioTracks(),
      ]);

      const supportedMime =
        MediaRecorder.isTypeSupported("video/mp4;codecs=h264,aac")
          ? "video/mp4;codecs=h264,aac"
          : MediaRecorder.isTypeSupported("video/mp4")
          ? "video/mp4"
          : MediaRecorder.isTypeSupported("video/webm;codecs=h264,opus")
          ? "video/webm;codecs=h264,opus"
          : MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
          ? "video/webm;codecs=vp9,opus"
          : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
          ? "video/webm;codecs=vp8,opus"
          : "video/webm";

      const recorder = new MediaRecorder(combinedStream, { mimeType: supportedMime });
      recordingChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordingChunksRef.current.push(e.data);
        }
      };

      recorder.start(5000); // collect data every 5 seconds
      mediaRecorderRef.current = recorder;
      console.log("[Recording] MediaRecorder started for host, mimeType:", supportedMime);
    } catch (err) {
      console.warn("[Recording] Failed to start MediaRecorder:", err);
    }

    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, [isHost, localStream]);

  // Handle audio track mute/unmute — only mute, never stop the audio track

  useEffect(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = micEnabled;
      });
    }
  }, [localStream, micEnabled]);

  // Handle VIDEO on/off — toggle track enablement rather than stopping/re-acquiring to prevent browser permission blocks
  useEffect(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = videoEnabled;
      });
    }
  }, [videoEnabled, localStream]);

  // Clean up all localStream tracks on unmount
  useEffect(() => {
    return () => {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [localStream]);

  // WebRTC dynamic active peer cleanup when participants leave
  useEffect(() => {
    const activeIds = new Set(activeParticipants.map(p => p.id));
    let changed = false;
    Object.keys(pcsRef.current).forEach((pId) => {
      if (!activeIds.has(pId)) {
        try { pcsRef.current[pId].close(); } catch (e) {}
        delete pcsRef.current[pId];
        delete remoteStreamsMapRef.current[pId];
        // Remove from initialized set so it gets a fresh signaling doc on reconnect
        initializedPeersRef.current.delete(pId);
        // Clean up the Firestore webrtc signaling doc for this channel
        const channelId = user.uid < pId ? `${user.uid}_${pId}` : `${pId}_${user.uid}`;
        deleteDoc(doc(db, `meetings/${meeting.id}/webrtc`, channelId)).catch(() => {});
        changed = true;
      }
    });
    if (changed) classifyStreams();
  }, [activeParticipants]);

  // Keep local/screen tracks in sync for all active peer connections (add/replace/remove as needed)
  useEffect(() => {
    activeParticipants.forEach((p) => {
      const pc = pcsRef.current[p.id];
      if (!pc || pc.signalingState === 'closed') return;

      const currentSenders = pc.getSenders();
      const allActiveTracks: MediaStreamTrack[] = [
        ...(localStreamRef.current ? localStreamRef.current.getTracks() : []),
        ...(screenStreamRef2.current ? screenStreamRef2.current.getTracks() : [])
      ];

      // Add any tracks that are missing from senders
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          const alreadySending = currentSenders.some(s => s.track === track);
          if (!alreadySending) {
            try { pc.addTrack(track, localStreamRef.current!); } catch (e) {}
          }
        });
      }
      if (screenStreamRef2.current) {
        screenStreamRef2.current.getTracks().forEach((track) => {
          const alreadySending = currentSenders.some(s => s.track === track);
          if (!alreadySending) {
            try { pc.addTrack(track, screenStreamRef2.current!); } catch (e) {}
          }
        });
      }

      // Remove senders whose tracks are no longer in any active stream
      currentSenders.forEach((sender) => {
        if (sender.track && !allActiveTracks.includes(sender.track)) {
          try { pc.removeTrack(sender); } catch (e) {}
        }
      });
    });
  }, [activeParticipants, localStream, screenStream]);

  // Extract participant IDs to avoid re-running signaling when other properties (like lastActive/heartbeat) change
  const participantIds = useMemo(() => {
    return activeParticipants.map(p => p.id).sort().join(",");
  }, [activeParticipants]);

  // Real WebRTC peer mesh over Firestore signaling
  // Only runs when the SET of participant IDs changes or localStream becomes available.
  // Initiator (lexicographically smaller UID) creates the offer; responder answers.
  // This eliminates offer-glare (both sides creating offers simultaneously).
  useEffect(() => {
    const unsubscribes: (() => void)[] = [];

    activeParticipants.forEach((p) => {
      if (p.id === user.uid) return; // skip self

      // Consistent channel ID regardless of who joined first
      const channelId = user.uid < p.id ? `${user.uid}_${p.id}` : `${p.id}_${user.uid}`;
      // The peer with the lexicographically smaller UID is always the initiator (creates the offer)
      const isInitiator = user.uid < p.id;
      const isPolite = user.uid > p.id;
      const docRef = doc(db, `meetings/${meeting.id}/webrtc`, channelId);

      const pc = getOrCreatePC(p.id);
      if (!pc || pc.signalingState === 'closed') return;

      const sigState = pcsSignalingRef.current[p.id] || {
        localCandidates: [],
        signalingDocExists: false,
        addedRemoteCandidates: new Set()
      };

      // Detect whether this is the first time we're setting up signaling for this peer.
      const isNewPeer = !initializedPeersRef.current.has(p.id);
      if (isNewPeer && isInitiator) {
        // Wipe the stale doc; the onSnapshot !exists branch will then create a fresh offer
        deleteDoc(docRef).catch(() => {});
        sigState.signalingDocExists = false;
        sigState.localCandidates = [];
      }
      initializedPeersRef.current.add(p.id);

      const unsub = onSnapshot(docRef, async (snapshot) => {
        if (pc.signalingState === 'closed') return;

        if (!snapshot.exists()) {
          sigState.signalingDocExists = false;
          if (!isInitiator) return; // Responder waits for the offer doc
          try {
            if (pc.signalingState !== 'stable') return;
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await setDoc(docRef, {
              offer: { type: "offer", sdp: offer.sdp },
              offerBy: user.uid,
              answer: null,
              answerBy: null,
              candidates_initiator: sigState.localCandidates,
              candidates_receiver: []
            });
            sigState.signalingDocExists = true;
          } catch (err) {
            console.warn("[WebRTC] Error creating initial offer:", err);
          }
          return;
        }

        const data = snapshot.data();
        if (!data) return;

        sigState.signalingDocExists = true;

        // Push any queued local candidates since the document exists now
        if (sigState.localCandidates.length > 0) {
          updateDoc(docRef, {
            [isInitiator ? "candidates_initiator" : "candidates_receiver"]: sigState.localCandidates
          }).catch(() => {});
        }

        // ── Responder receives offer → creates answer ──
        if (data.offer && data.offerBy !== user.uid && !data.answer) {
          if (pc.signalingState === "stable" || pc.signalingState === "have-local-offer") {
            try {
              if (pc.signalingState === "have-local-offer") {
                // Roll back our offer (impolite peer check — only responder rolls back)
                if (isPolite) {
                  console.log(`[WebRTC] Polite rollback for peer ${p.id}`);
                  await pc.setLocalDescription({ type: "rollback" });
                } else {
                  console.log(`[WebRTC] Impolite glare ignore for peer ${p.id}`);
                  return;
                }
              }
              await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await updateDoc(docRef, {
                answer: { type: "answer", sdp: answer.sdp },
                answerBy: user.uid,
                candidates_receiver: sigState.localCandidates
              });
            } catch (err) {
              console.warn("[WebRTC] Error answering offer:", err);
            }
          }
        }

        // ── Peer receives answer for their offer ──
        if (data.answer && data.answerBy !== user.uid && data.offerBy === user.uid) {
          if (pc.signalingState === "have-local-offer") {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            } catch (err) {
              console.warn("[WebRTC] Error setting remote answer:", err);
            }
          }
        }

        // ── ICE Candidates sync (apply remote candidates we haven't seen yet) ──
        const remoteCandidates = isInitiator ? data.candidates_receiver : data.candidates_initiator;
        if (remoteCandidates && remoteCandidates.length > 0 && pc.remoteDescription) {
          remoteCandidates.forEach((cand: any) => {
            const candStr = JSON.stringify(cand);
            if (!sigState.addedRemoteCandidates.has(candStr)) {
              sigState.addedRemoteCandidates.add(candStr);
              pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
          });
        }
      });

      unsubscribes.push(unsub);
    });

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [participantIds, localStream]);

  // General Call clock duration
  useEffect(() => {
    const clock = setInterval(() => {
      const startRef = meetingState?.startedAt || meetingState?.createdAt || new Date().toISOString();
      const diffSecs = Math.floor((Date.now() - new Date(startRef).getTime()) / 1000);
      setCallDuration(Math.max(0, diffSecs));
    }, 1000);
    return () => clearInterval(clock);
  }, [meetingState?.startedAt, meetingState?.createdAt]);

  // ── Presence: stable subscription (runs once, never torn down mid-meeting) ──
  // This effect ONLY sets up the Firestore listener and heartbeat.
  // It does NOT depend on mic/video/screen state to avoid re-subscribing on every toggle.
  useEffect(() => {
    const userPresenceRef = doc(db, `meetings/${meeting.id}/presence`, user.uid);
    const joinedTime = new Date().toISOString();

    // Write initial presence doc so others can see us immediately
    setDoc(userPresenceRef, {
      id: user.uid,
      name: user.name,
      role: user.role,
      videoEnabled: true,
      micEnabled: true,
      cameraStreamId: null,
      screenStreamId: null,
      handRaised: false,
      handRaisedAt: null,
      joinedAt: joinedTime,
      lastActive: new Date().toISOString()
    }).catch((e) => console.warn("Initial presence write failed:", e));

    // Heartbeat: only updates lastActive — never overwrites media fields
    const heartbeatInterval = setInterval(async () => {
      try {
        await updateDoc(userPresenceRef, { lastActive: new Date().toISOString() });
      } catch (err) {
        // Doc may not exist yet (race), retry full write
        setDoc(userPresenceRef, {
          id: user.uid, name: user.name, role: user.role,
          videoEnabled: true, micEnabled: true,
          cameraStreamId: null, screenStreamId: null,
          handRaised: false, handRaisedAt: null,
          joinedAt: joinedTime, lastActive: new Date().toISOString()
        }, { merge: true }).catch(() => {});
      }
    }, 5000);

    const cleanPresenceOnUnload = () => {
      deleteDoc(userPresenceRef).catch(() => {});
    };
    window.addEventListener("beforeunload", cleanPresenceOnUnload);
    window.addEventListener("unload", cleanPresenceOnUnload);

    // Listen to ALL participants' presence docs
    const presenceCollection = collection(db, `meetings/${meeting.id}/presence`);
    const unsubscribe = onSnapshot(presenceCollection, (snapshot) => {
      const list: ActiveParticipant[] = [];
      snapshot.forEach((d: any) => {
        const data = d.data();
        if (data && data.id !== user.uid) {
          list.push({
            id: data.id,
            name: data.name || "Scholar Participant",
            role: data.role || "student",
            videoEnabled: !!data.videoEnabled,
            micEnabled: !!data.micEnabled,
            cameraStreamId: data.cameraStreamId || null,
            screenStreamId: data.screenStreamId || null,
            handRaised: !!data.handRaised,
            handRaisedAt: data.handRaisedAt || null,
            joinedAt: data.joinedAt || new Date().toISOString(),
            lastActive: data.lastActive || data.joinedAt || new Date().toISOString()
          });
        }
      });
      setActiveParticipants(list);
    });

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener("beforeunload", cleanPresenceOnUnload);
      window.removeEventListener("unload", cleanPresenceOnUnload);
      unsubscribe();
      deleteDoc(userPresenceRef).catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.id, user.uid]); // ← Stable deps only! Do NOT add mic/video/screen here.

  // ── Presence: patch media state fields on every toggle ──
  // This runs separately from the subscription so we never tear down the listener.
  useEffect(() => {
    const userPresenceRef = doc(db, `meetings/${meeting.id}/presence`, user.uid);
    updateDoc(userPresenceRef, {
      videoEnabled,
      micEnabled,
      cameraStreamId: localStream?.id || null,
      screenStreamId: screenStream?.id || null,
    }).catch(() => {});
  }, [videoEnabled, micEnabled, localStream, screenStream, meeting.id, user.uid]);

  // ── Presence: patch hand-raise state on every toggle ──
  useEffect(() => {
    const userPresenceRef = doc(db, `meetings/${meeting.id}/presence`, user.uid);
    updateDoc(userPresenceRef, {
      handRaised,
      handRaisedAt,
    }).catch(() => {});
  }, [handRaised, handRaisedAt, meeting.id, user.uid]);

  // Keep active participants ref in sync and reclassify streams when activeParticipants change
  useEffect(() => {
    activeParticipantsRef.current = activeParticipants;
    classifyStreams();
  }, [activeParticipants]);

  // Listen to user's own presence document for remote teacher commands (mute / camera off)
  const micEnabledRef = useRef(micEnabled);
  const videoEnabledRef = useRef(videoEnabled);
  useEffect(() => { micEnabledRef.current = micEnabled; }, [micEnabled]);
  useEffect(() => { videoEnabledRef.current = videoEnabled; }, [videoEnabled]);

  useEffect(() => {
    if (isHost) return; // Only students can be remotely controlled
    const userPresenceRef = doc(db, `meetings/${meeting.id}/presence`, user.uid);
    const unsubscribe = onSnapshot(userPresenceRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data) {
          // If the teacher muted us remotely — use refs to avoid stale closure loops
          if (data.micEnabled === false && micEnabledRef.current) {
            setMicEnabled(false);
          } else if (data.micEnabled === true && !micEnabledRef.current) {
            setMicEnabled(true);
          }
          
          // If the teacher turned off our camera remotely
          if (data.videoEnabled === false && videoEnabledRef.current) {
            setVideoEnabled(false);
          } else if (data.videoEnabled === true && !videoEnabledRef.current) {
            setVideoEnabled(true);
          }
        }
      }
    }, (error) => {
      console.warn("Error listening to user presence:", error);
    });
    return () => unsubscribe();
  }, [meeting.id, user.uid, isHost]); // NO micEnabled/videoEnabled in deps — uses refs to avoid infinite loops

  // Synchronize chat messages in real-time
  useEffect(() => {
    const chatCollection = collection(db, `meetings/${meeting.id}/chat`);
    const unsubscribe = onSnapshot(chatCollection, (snapshot) => {
      const msgs: ChatMessage[] = [];
      snapshot.forEach((d: any) => {
        const data = d.data();
        if (data) {
          msgs.push({
            id: d.id,
            senderName: data.senderName,
            senderRole: data.senderRole,
            message: data.message,
            timestamp: data.timestamp,
            createdAt: data.createdAt || ""
          } as any);
        }
      });
      msgs.sort((a: any, b: any) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      setChatMessages(msgs);
    });

    return () => unsubscribe();
  }, [meeting.id]);

  // Set up Firebase Realtime response log for students to submit live metrics
  useEffect(() => {
    if (isHost) return; // Only students log interactive records

    const initResponseDoc = async () => {
      const respDocRef = doc(db, `meetings/${meeting.id}/responses`, responseId);
      const docSnap = await getDoc(respDocRef);

      if (!docSnap.exists()) {
        const initialResponse: MeetingResponse = {
          id: responseId,
          meetingId: meeting.id,
          userId: user.uid,
          userName: user.name,
          activePopupShown: 0,
          activePopupClicked: 0,
          quizAnswers: [],
          overallPercentage: 100,
          missedLive: false,
          updatedAt: new Date().toISOString()
        };
        await setDoc(respDocRef, initialResponse);
      } else {
        const stored = docSnap.data() as MeetingResponse;
        setPopupShown(stored.activePopupShown || 0);
        setPopupClicked(stored.activePopupClicked || 0);
        setAnswers(stored.quizAnswers || []);
        setScorePercentage(stored.overallPercentage || 100);
      }
    };

    initResponseDoc();
  }, [meeting.id, isHost]);

  // Real-time listener: Sync current meeting specifications (like disabled popups or quizzes list)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "meetings", meeting.id), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as Meeting;
        setMeetingState(data);
        if (data.quizzes) {
          setActiveQuizzesList(data.quizzes);
        }
      }
    });

    return () => unsub();
  }, [meeting.id]);

  // If the meeting has ended, force everyone to exit the room!
  useEffect(() => {
    if (meetingState?.status === "ended") {
      onLeave();
    }
  }, [meetingState?.status, onLeave]);

  // Auto end when duration limit is reached (only for Host / Teacher) - strictly capped at 1 hour max
  useEffect(() => {
    if (isHost && meetingState?.status === "active") {
      const durationLimitMins = meetingState?.duration && meetingState.duration > 0 ? Math.min(meetingState.duration, 60) : 60;
      const durationLimitSeconds = durationLimitMins * 60;
      if (callDuration >= durationLimitSeconds) {
        handleEndMeeting();
      }
    }
  }, [callDuration, isHost, meetingState?.duration, meetingState?.status]);

  // Real-time listener: Sync overall responses (for Teacher console view)
  useEffect(() => {
    if (!isHost) return;

    const unsub = onSnapshot(collection(db, `meetings/${meeting.id}/responses`), (snapshot) => {
      const list: MeetingResponse[] = [];
      snapshot.forEach((snap) => {
        list.push(snap.data() as MeetingResponse);
      });
      setLiveResponses(list);
    });

    return () => unsub();
  }, [meeting.id, isHost]);

  // Sync state stats directly into Firestore whenever they change
  useEffect(() => {
    if (isHost) return;
    if (popupShown === 0 && answers.length === 0) return;

    const syncStats = async () => {
      // Calculate live involvement score
      // Availability Ratio: 50% max, Quiz Ratio: 50% max
      const availabilityRatio = popupShown > 0 ? (popupClicked / popupShown) : 1;
      
      let quizRatio = 1;
      if (activeQuizzesList.length > 0) {
        const correctAnswers = answers.filter(a => a.isCorrect).length;
        // Divide by number of answers student submitted, or by total launched
        quizRatio = answers.length > 0 ? (correctAnswers / answers.length) : 0;
      }

      // Raw overall calculation
      const combinedPercent = Math.round((availabilityRatio * 50) + (quizRatio * 50));
      const finalScore = Math.min(100, Math.max(1, combinedPercent));
      setScorePercentage(finalScore);

      const respDocRef = doc(db, `meetings/${meeting.id}/responses`, responseId);
      await updateDoc(respDocRef, {
        activePopupShown: popupShown,
        activePopupClicked: popupClicked,
        quizAnswers: answers,
        overallPercentage: finalScore,
        updatedAt: new Date().toISOString()
      }).catch(err => console.warn("Failed syncing student stats to Firestore:", err));
    };

    const timeout = setTimeout(syncStats, 1000);
    return () => clearTimeout(timeout);
  }, [popupShown, popupClicked, answers, isHost, activeQuizzesList.length, responseId]);

  // ADJUST ATTENDANCE CHECKS SECONDS TIMELINE WHEN DEMO MODE OPTION TOGGLES
  useEffect(() => {
    if (demoMode) {
      setNextPopupAtSecond(15); // 15 seconds in demo mode
    } else {
      // Use the teacher-configured activeStatusTimer (in minutes). Default 10 min (600s) if not set.
      const configuredMins = meetingState?.activeStatusTimer && meetingState.activeStatusTimer > 0
        ? meetingState.activeStatusTimer
        : 10;
      setNextPopupAtSecond(configuredMins * 60);
    }
  }, [demoMode, meetingState?.activeStatusTimer]);

  // TRIGGER REAL-TIME ATTENDANCE POPUPS (after configured interval, then randomly, or accelerated in Demo Mode)
  useEffect(() => {
    if (isHost) return;
    if (meetingState?.activeVerificationDisabled) {
      setShowAvailabilityPopup(false);
      return;
    }

    if (callDuration >= nextPopupAtSecond) {
      // If a quiz is currently visible, DON'T show the popup — postpone it by the same interval
      if (currentQuiz !== null) {
        // Re-queue for a short time after quiz closes
        const minDelay = demoMode ? 20 : 300;
        const maxDelay = demoMode ? 35 : 420;
        const nextDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        setNextPopupAtSecond(callDuration + nextDelay);
        return;
      }

      // Prompt popup now
      setShowAvailabilityPopup(true);
      setPopupTimer(15);
      setPopupShown((prev) => prev + 1);

      // Determine the delay interval until the subsequent interactive check
      // Demo: randomly every 20-35s. Standard: randomly matches configured timer ± 20%
      const configuredMins = meetingState?.activeStatusTimer && meetingState.activeStatusTimer > 0
        ? meetingState.activeStatusTimer
        : (demoMode ? 0.5 : 10);
      const baseDelay = demoMode ? 20 : configuredMins * 60;
      const variance = demoMode ? 15 : Math.floor(configuredMins * 60 * 0.2);
      const nextDelay = baseDelay + Math.floor(Math.random() * variance);
      setNextPopupAtSecond(callDuration + nextDelay);
    }
  }, [callDuration, isHost, demoMode, nextPopupAtSecond, meetingState?.activeVerificationDisabled, meetingState?.activeStatusTimer, currentQuiz]);

  // COUNT DOWN TIMERS FOR AVAILABILITY POPUPS
  // Also dismiss the popup if a quiz opens mid-countdown (quiz takes priority)
  useEffect(() => {
    if (currentQuiz !== null && showAvailabilityPopup) {
      // Quiz appeared while popup was visible — close popup and let it re-queue
      setShowAvailabilityPopup(false);
      return;
    }
  }, [currentQuiz, showAvailabilityPopup]);

  useEffect(() => {
    if (!showAvailabilityPopup) return;

    const countdown = setInterval(() => {
      setPopupTimer((prev) => {
        if (prev <= 1) {
          // Time expired, student missed the check!
          setShowAvailabilityPopup(false);
          clearInterval(countdown);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdown);
  }, [showAvailabilityPopup]);

  // TRIGGER AI MCQ QUIZZES AT DYNAMIC CLASSROOM STEPS (standard minutes vs demo accelerated steps)
  useEffect(() => {
    if (isHost) return;
    if (meetingState?.liveQuizDisabled) {
      setCurrentQuiz(null);
      return;
    }
    if (activeQuizzesList.length === 0) return;

    const intervalVal = meetingState?.quizTriggerInterval || 5;
    const intervalSeconds = intervalVal * 60;

    const checkQuizTriggers = () => {
      // Offset by 1 so the first quiz triggers after 1 full interval, not instantly at 0
      const targetIndex = Math.floor(callDuration / intervalSeconds) - 1;
      if (targetIndex >= 0 && targetIndex < activeQuizzesList.length && targetIndex !== currentQuizIndex) {
        // Launch dynamic quiz!
        setCurrentQuiz(activeQuizzesList[targetIndex]);
        setCurrentQuizIndex(targetIndex);
        setHasAnsweredCurrent(false);
        setSelectedOption(null);
      }
    };

    checkQuizTriggers();
  }, [callDuration, activeQuizzesList, isHost, meetingState?.quizTriggerInterval, meetingState?.liveQuizDisabled, currentQuizIndex]);

  // AUTO GENERATE DYNAMIC QUIZZES FROM LIVE DISCUSSIONS TRANSCRIPT & OUTLINES (Every 10-15 minutes or 50s in Demo mode)
  useEffect(() => {
    if (!isHost) return;
    if (meetingState?.liveQuizDisabled) return;
    if (!meetingState?.liveQuizGenerationEnabled) return;

    // Trigger every 50 seconds in Demo mode vs every 10 minutes (600s) in standard
    const liveIntervalVal = demoMode ? 50 : 600;

    if (callDuration > 0 && callDuration % liveIntervalVal === 0 && callDuration !== lastLiveQuizGeneratedAt) {
      setLastLiveQuizGeneratedAt(callDuration);
      triggerLiveDiscussionQuizGeneration();
    }
  }, [callDuration, isHost, meetingState?.liveQuizGenerationEnabled, meetingState?.liveQuizDisabled, lastLiveQuizGeneratedAt, meetingState?.liveQuizGenerationInterval]);

  const triggerLiveDiscussionQuizGeneration = async () => {
    if (generatingLiveQuiz) return;
    setGeneratingLiveQuiz(true);
    try {
      const response = await fetch("/api/generate-live-discussion-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: meetingState.title,
          chatMessages: chatMessages.slice(-15),
          existingDiscussion: meetingState.discussionMaterial || ""
        }),
      });

      const data = await response.json();
      // Accept quiz from API response (server already provides fallback quiz on error)
      const quizToAdd = data.quiz || DEFAULT_MEETING_QUIZZES[Math.floor(Math.random() * DEFAULT_MEETING_QUIZZES.length)];

      if (quizToAdd) {
        const updatedQuizzes = [...(meetingState.quizzes || []), quizToAdd];
        await updateDoc(doc(db, "meetings", meeting.id), {
          quizzes: updatedQuizzes
        });

        await addDoc(collection(db, `meetings/${meeting.id}/chat`), {
          senderName: "AI Companion",
          senderRole: "assistant",
          message: `📢 [Live Recall Checkpoint Generated] A brand-new discussion question has been distributed! Checkpoint #${updatedQuizzes.length}: "${quizToAdd.question}" is now live.`,
          timestamp: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
          createdAt: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error("Live discussion quiz generation failed, using dummy fallback:", error);
      // Fallback: use a default quiz directly without crashing
      try {
        const fallbackQuiz = DEFAULT_MEETING_QUIZZES[Math.floor(Math.random() * DEFAULT_MEETING_QUIZZES.length)];
        const updatedQuizzes = [...(meetingState.quizzes || []), fallbackQuiz];
        await updateDoc(doc(db, "meetings", meeting.id), {
          quizzes: updatedQuizzes
        });
        await addDoc(collection(db, `meetings/${meeting.id}/chat`), {
          senderName: "AI Companion",
          senderRole: "assistant",
          message: `📢 [Checkpoint Generated] Checkpoint #${updatedQuizzes.length}: "${fallbackQuiz.question}" is now live.`,
          timestamp: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
          createdAt: new Date().toISOString()
        });
      } catch (fallbackErr) {
        console.error("Fallback quiz push also failed:", fallbackErr);
      }
    } finally {
      setGeneratingLiveQuiz(false);
    }
  };

  const handleAvailabilityClick = () => {
    setPopupClicked((prev) => prev + 1);
    setShowAvailabilityPopup(false);
  };

  const submitQuizAnswer = () => {
    if (selectedOption === null || currentQuizIndex === -1) return;

    const question = activeQuizzesList[currentQuizIndex];
    const isCorrect = selectedOption === question.correctAnswerIndex;

    const submission: StudentQuizSubmission = {
      quizIndex: currentQuizIndex,
      selectedIndex: selectedOption,
      isCorrect
    };

    setAnswers((prev) => [...prev, submission]);
    setHasAnsweredCurrent(true);

    // Auto close overlay after 3 seconds showing feedback
    setTimeout(() => {
      setCurrentQuiz(null);
    }, 3500); // 3.5 seconds to close popup
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim()) return;

    const newMessage = {
      senderName: user.name,
      senderRole: user.role,
      message: messageText.trim(),
      timestamp: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      createdAt: new Date().toISOString()
    };

    const chatCollection = collection(db, `meetings/${meeting.id}/chat`);
    await addDoc(chatCollection, newMessage).catch((err) => console.error("Chat send failed:", err));
    
    setMessageText("");
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // End active meeting trigger for Host
  const handleEndMeeting = async () => {
    if (!isHost) {
      onLeave();
      return;
    }

    // Stop the MediaRecorder and collect any remaining data
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      setUploadingRecording(true);
      setUploadProgress("Finalizing class recording...");

      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }

    try {
      let finalVideoUrl = meeting.recordedVideoUrl || "";

      // Upload captured recording blob if we have data
      if (recordingChunksRef.current.length > 0) {
        setUploadProgress("Uploading class recording to server...");

        const mimeType = mediaRecorderRef.current?.mimeType || "video/webm";
        const blob = new Blob(recordingChunksRef.current, { type: mimeType });

        try {
          const uploadRes = await fetch(`/api/upload-recording?meetingId=${meeting.id}`, {
            method: "POST",
            headers: { "Content-Type": mimeType },
            body: blob,
          });

          const uploadData = await uploadRes.json();
          if (uploadData.success && uploadData.url) {
            finalVideoUrl = uploadData.url;
            console.log("[Recording] Upload successful:", finalVideoUrl);
          }
        } catch (uploadErr) {
          console.warn("[Recording] Upload failed, using fallback sample video:", uploadErr);
        }
      }

      // Fallback: if no recording was captured, use a topic-appropriate sample video
      if (!finalVideoUrl) {
        const combined = `${meeting.title || ""} ${meeting.description || ""}`.toLowerCase();
        if (combined.includes("cell") || combined.includes("biology") || combined.includes("science") || combined.includes("mitochondria") || combined.includes("photosynthesis")) {
          finalVideoUrl = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
        } else if (combined.includes("code") || combined.includes("program") || combined.includes("javascript") || combined.includes("python") || combined.includes("software")) {
          finalVideoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4";
        } else if (combined.includes("math") || combined.includes("calcul") || combined.includes("algebra") || combined.includes("equation")) {
          finalVideoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
        } else if (combined.includes("history") || combined.includes("century") || combined.includes("empire") || combined.includes("revolution")) {
          finalVideoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4";
        } else {
          finalVideoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4";
        }
      }

      setUploadProgress("Saving session data...");

      // Update meeting status in Firestore
      const meetDocRef = doc(db, "meetings", meeting.id);
      await updateDoc(meetDocRef, {
        status: "ended",
        endedAt: new Date().toISOString(),
        recordedVideoUrl: finalVideoUrl,
      });

      setUploadingRecording(false);
      setUploadProgress(null);

      // Navigate to dashboard
      onLeave();
    } catch (err) {
      console.error("Failed closing session:", err);
      setUploadingRecording(false);
      setUploadProgress(null);
      onLeave();
    }
  };


  const getGridLayoutClass = (totalCount: number) => {
    if (totalCount === 1) {
      return "w-full max-w-4xl mx-auto h-full max-h-[75vh] flex items-center justify-center";
    }
    if (totalCount === 2) {
      return "grid grid-cols-1 md:grid-cols-2 gap-4 max-w-5xl mx-auto items-center justify-center";
    }
    if (totalCount <= 4) {
      return "grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-5xl mx-auto items-center justify-center";
    }
    if (totalCount <= 9) {
      return "grid grid-cols-2 lg:grid-cols-3 gap-3.5 items-center justify-center";
    }
    if (totalCount <= 12) {
      return "grid grid-cols-3 lg:grid-cols-4 gap-3 items-center justify-center";
    }
    return "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 items-center justify-center text-[10px]";
  };

  return (
    <div className="fixed inset-0 bg-slate-950 text-slate-200 flex flex-col z-50 select-none">

      {/* Upload progress overlay — shown while recording is being saved */}
      {uploadingRecording && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600/15 border border-indigo-500/30 flex items-center justify-center">
            <span className="w-7 h-7 border-[3px] border-indigo-400 border-t-transparent rounded-full animate-spin" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-bold text-white uppercase tracking-widest font-sans">Saving Class Recording</p>
            <p className="text-xs text-slate-400 font-mono">{uploadProgress || "Processing..."}</p>
          </div>
          <p className="text-[10px] text-slate-500 font-mono max-w-xs text-center leading-relaxed">
            Please wait while your class session recording is being saved. Students will be able to replay it once this completes.
          </p>
        </div>
      )}

      {/* Main workspace layout: webcam/avatar grid on left, sliders or messages on right */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* Teacher Control Console Drawer Panel (Moved to Settings Modal) */}
        {false && isHost && (
          <div 
            style={{
              position: 'fixed',
              left: `${tcDragOffset.x}px`,
              top: `${tcDragOffset.y}px`,
              zIndex: 44
            }}
            className={`bg-slate-900/95 backdrop-blur-md border border-white/10 rounded-2xl w-80 shadow-2xl overflow-hidden transition-all duration-150 ${
              tcIsDragging ? "opacity-90 scale-[0.98]" : "opacity-100"
            }`}
          >
            <div 
              onMouseDown={handleTcDragStart}
              onTouchStart={handleTcTouchStart}
              className="bg-indigo-950/95 p-3 flex items-center justify-between border-b border-white/10 text-xs text-white cursor-grab active:cursor-grabbing select-none"
            >
              <span className="font-extrabold uppercase tracking-widest flex items-center gap-1.5 font-sans pointer-events-none">
                <FileCheck className="w-4 h-4 text-indigo-400" />
                <span>Teacher Control Room</span>
              </span>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setTcMinimized(!tcMinimized);
                }}
                className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-all cursor-pointer"
                title={tcMinimized ? "Expand Controls" : "Minimize Controls"}
              >
                {tcMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
              </button>
            </div>
            {!tcMinimized && (
              <div className="p-3.5 space-y-3.5 max-h-[380px] overflow-y-auto">
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono block">Attendance Controls</span>
                <button
                  onClick={async () => {
                    const updatedState = !meetingState?.activeVerificationDisabled;
                    await updateDoc(doc(db, "meetings", meeting.id), {
                      activeVerificationDisabled: updatedState
                    });
                  }}
                  className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between border cursor-pointer ${
                    meetingState?.activeVerificationDisabled
                      ? "bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20"
                      : "bg-indigo-600/15 border-indigo-500/30 text-indigo-305 hover:bg-indigo-600/25"
                  }`}
                >
                  <span>{meetingState?.activeVerificationDisabled ? "● Popups Stopped" : "● Popups Running"}</span>
                  <span className="text-[9.5px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-white/5">
                    {meetingState?.activeVerificationDisabled ? "Disabled" : "Active"}
                  </span>
                </button>
                <p className="text-[9px] text-slate-500 leading-snug">
                  {meetingState?.activeVerificationDisabled 
                    ? "Attendance check-ins will not be prompted to cohort students."
                    : "Students are periodically challenged with attention verify popups."}
                </p>
              </div>

              <div className="space-y-2 border-t border-white/5 pt-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono block">Class Live Quizzes</span>
                <button
                  onClick={async () => {
                    const updatedState = !meetingState?.liveQuizDisabled;
                    await updateDoc(doc(db, "meetings", meeting.id), {
                      liveQuizDisabled: updatedState
                    });
                  }}
                  className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between border cursor-pointer ${
                    meetingState?.liveQuizDisabled
                      ? "bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20"
                      : "bg-indigo-600/15 border-indigo-500/30 text-indigo-305 hover:bg-indigo-600/25"
                  }`}
                >
                  <span>{meetingState?.liveQuizDisabled ? "● Quizzes Stopped" : "● Quizzes Active"}</span>
                  <span className="text-[9.5px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-white/5">
                    {meetingState?.liveQuizDisabled ? "Disabled" : "Active"}
                  </span>
                </button>
                <p className="text-[9px] text-slate-500 leading-snug">
                  {meetingState?.liveQuizDisabled 
                    ? "Interactive and scheduled evaluation quizzes are temporarily paused."
                    : "Quizzes will automatically pop up according to schedule intervals."}
                </p>
              </div>

              <div className="space-y-2 border-t border-white/5 pt-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono block">Dynamic AI Questioning</span>
                <button
                  onClick={triggerLiveDiscussionQuizGeneration}
                  disabled={generatingLiveQuiz}
                  className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-550 disabled:opacity-40 text-white font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(79,70,229,0.2)]"
                >
                  {generatingLiveQuiz ? (
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent animate-spin rounded-full" />
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
                      <span>Generate & Send Live Quiz</span>
                    </>
                  )}
                </button>
                <p className="text-[9.5px] text-indigo-300 leading-snug">
                  {meetingState.liveQuizGenerationEnabled 
                    ? "• Auto live mode is ACTIVE. AI triggers a checkmark every 10-15 minutes or click to trigger manually right now."
                    : "• Click above to instantly generate quiz based on current live class discussions."}
                </p>
              </div>

              {/* Live Student Responses */}
              <div className="space-y-2 border-t border-white/5 pt-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono block">Cohort Interactive Grade List ({liveResponses.length})</span>
                {liveResponses.length === 0 ? (
                  <p className="text-[9.5px] text-slate-550 font-mono italic">No student responses connected.</p>
                ) : (
                  <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                    {liveResponses.map((r) => (
                      <div key={r.id} className="p-2 bg-slate-950/50 rounded-lg border border-white/5 flex items-center justify-between text-[11px]">
                        <span className="text-slate-300 font-semibold truncate max-w-[120px]">{r.userName}</span>
                        <span className={`font-mono font-bold text-[10px] px-1.5 py-0.5 rounded ${
                          r.overallPercentage >= 80 ? "bg-emerald-500/10 text-emerald-400" :
                          r.overallPercentage >= 50 ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"
                        }`}>{r.overallPercentage}% Score</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bulk Moderation Controls */}
              <div className="space-y-2 border-t border-white/5 pt-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono block">Classroom Moderation</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleMuteAll}
                    className="py-2 px-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    title="Mute all students immediately"
                  >
                    <MicOff className="w-3.5 h-3.5" />
                    <span>Mute All</span>
                  </button>
                  <button
                    onClick={handleTurnOffAllCameras}
                    className="py-2 px-2.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    title="Turn off all students' video transmissions"
                  >
                    <VideoOff className="w-3.5 h-3.5" />
                    <span>Cam Off All</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
        
        {/* Core Video Layout Section */}
        <div className="flex-1 p-6 flex flex-col items-center justify-center bg-slate-900/10 overflow-y-auto relative min-h-0">
          
          {/* Floating timing and recording status in top-right corner */}
          <div className="absolute top-4 right-4 z-40 bg-slate-950/80 backdrop-blur-md py-1.5 px-3 rounded-xl border border-white/10 flex items-center gap-3 shadow-lg">
            {recordingActive && (
              <div className="px-1.5 py-0.5 bg-red-500/15 text-red-400 rounded flex items-center gap-1 border border-red-500/20 text-[9px] font-bold uppercase tracking-widest font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span>REC</span>
              </div>
            )}
            <div className="text-xs text-amber-400 font-mono flex items-center gap-1.5 font-medium" title="Time remaining">
              <Clock className="w-3.5 h-3.5 animate-pulse" />
              <span>
                {formatDuration(Math.max(0, (meetingState?.duration && meetingState.duration > 0 ? Math.min(meetingState.duration, 60) : 60) * 60 - callDuration))} left
              </span>
            </div>
          </div>
          
          {meetingState?.screenShareBy ? (
            <div className="flex flex-col xl:flex-row gap-5 w-full h-full max-h-[78vh] overflow-hidden items-stretch justify-stretch">
              {/* Pinned Screenshare Frame */}
              <div className="flex-1 bg-slate-950 border border-indigo-500/30 rounded-3xl relative overflow-hidden flex flex-col items-center justify-center shadow-2xl min-h-[350px]">
                {meetingState.screenShareBy === user.uid ? (
                  <video
                    ref={(el) => {
                      if (el && screenStream && el.srcObject !== screenStream) {
                        el.srcObject = screenStream;
                      }
                    }}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <video
                    ref={(el) => {
                      const rStream = remoteScreenStreams[meetingState.screenShareBy!];
                      if (el && rStream && el.srcObject !== rStream) {
                        el.srcObject = rStream;
                      }
                    }}
                    autoPlay
                    playsInline
                    className="w-full h-full object-contain"
                  />
                )}

                {/* Screenshare overlay info */}
                <div className="absolute top-4 left-4 bg-indigo-600 text-white text-[10px] font-mono font-bold uppercase tracking-wider px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 z-10 animate-pulse">
                  <Monitor className="w-3.5 h-3.5" />
                  <span>{meetingState.screenShareBy === user.uid ? "You are presenting" : `${meetingState.screenShareByName || 'Someone'} is presenting`}</span>
                </div>

                <div className="absolute bottom-4 right-4 bg-slate-950/80 backdrop-blur-md py-1.5 px-3 rounded-xl text-xs font-semibold border border-indigo-500/20 text-indigo-300 z-10">
                  📌 Pinned Screen Share
                </div>
              </div>

              {/* Side Strip of Participants */}
              <div className="w-full xl:w-80 flex xl:flex-col gap-3 overflow-x-auto xl:overflow-y-auto pb-2 pr-1 h-32 xl:h-full justify-start items-center flex-shrink-0">
                {/* Self card first */}
                <div className="flex-shrink-0 w-44 xl:w-full aspect-video bg-slate-900 border border-white/5 rounded-2xl relative overflow-hidden flex flex-col items-center justify-center shadow-md">
                  {videoEnabled ? (
                    <video 
                      ref={(el) => {
                        if (el && localStream && el.srcObject !== localStream) {
                          el.srcObject = localStream;
                        }
                      }}
                      autoPlay 
                      playsInline 
                      muted 
                      className="w-full h-full object-cover scale-x-[-1]"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-sm uppercase">
                      {user.name.charAt(0)}
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 bg-slate-950/80 backdrop-blur-md py-1 px-2 rounded-lg text-[9.5px] border border-white/5">
                    You
                  </div>
                </div>

                {/* Rest of students */}
                {activeParticipants.map((p) => (
                  <div key={p.id} className={`flex-shrink-0 w-44 xl:w-full aspect-video bg-slate-900 border rounded-2xl relative overflow-hidden flex flex-col items-center justify-center shadow-md shadow-slate-950/20 group ${
                    activeSpeakerId === p.id
                      ? "border-indigo-500 ring-1 ring-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.2)]"
                      : "border-white/5"
                  }`}>
                    <RemoteVideo p={p} stream={remoteStreams[p.id]} />
                    <div className="absolute bottom-2 left-2 bg-slate-950/85 backdrop-blur-md py-1 px-2 rounded-lg text-[9.5px] border border-white/5 z-10 flex items-center gap-1">
                      <span>{p.name}</span>
                      {activeSpeakerId === p.id && p.micEnabled && (
                        <span className="flex items-center gap-0.5 ml-1">
                          <span className="w-0.5 h-1.5 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_100ms]" />
                          <span className="w-0.5 h-2.5 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_300ms]" />
                          <span className="w-0.5 h-1 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_200ms]" />
                        </span>
                      )}
                    </div>
                    {renderParticipantHostControls(p)}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {meetLayout === 'grid' && (
                <div className={`${getGridLayoutClass(activeParticipants.length + 1)} w-full h-full`}>
                  
                  {/* User's block */}
                  <div className={`bg-slate-900 border rounded-3xl relative overflow-hidden flex flex-col items-center justify-center group shadow-2xl transition-all duration-300 ${
                    activeSpeakerId === user.uid
                      ? "border-indigo-500 ring-2 ring-indigo-500/20 shadow-[0_0_25px_rgba(99,102,241,0.25)]"
                      : "border-white/10"
                  } ${
                    activeParticipants.length === 0 
                      ? "w-full max-w-4xl aspect-video mx-auto" 
                      : "w-full aspect-video"
                  }`}>
                    {videoEnabled ? (
                      <video 
                        ref={(el) => {
                          if (el && localStream && el.srcObject !== localStream) {
                            el.srcObject = localStream;
                          }
                        }}
                        autoPlay 
                        playsInline 
                        muted 
                        className="w-full h-full object-cover scale-x-[-1]"
                      />
                    ) : (
                      <div className="w-24 h-24 rounded-2xl bg-indigo-600/15 border border-indigo-500/20 shadow-lg flex items-center justify-center text-indigo-400 font-extrabold text-3xl uppercase animate-pulse">
                        {user.name.charAt(0)}
                      </div>
                    )}
                    
                    {/* User metadata tag */}
                    <div className="absolute bottom-4 left-4 bg-slate-950/80 backdrop-blur-md py-1.5 px-3 rounded-xl text-[11px] font-medium border border-white/10 flex items-center gap-2">
                      <span className="text-emerald-400 animate-pulse">●</span>
                      <span>{user.name} (You)</span>
                      {activeSpeakerId === user.uid && micEnabled && (
                        <span className="flex items-center gap-0.5 ml-1.5">
                          <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_100ms]" />
                          <span className="w-0.5 h-3 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_300ms]" />
                          <span className="w-0.5 h-1.5 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_200ms]" />
                        </span>
                      )}
                    </div>
                  </div>

                  {/* REAL CLASSROOM PARTICIPANTS */}
                  {activeParticipants.map((p) => (
                    <div key={p.id} className={`bg-slate-900 border rounded-3xl relative overflow-hidden aspect-video flex flex-col items-center justify-center shadow-2xl transition-all duration-300 w-full group ${
                      activeSpeakerId === p.id
                        ? "border-indigo-500 ring-2 ring-indigo-500/20 shadow-[0_0_25px_rgba(99,102,241,0.25)]"
                        : "border-white/5"
                    }`}>
                      <RemoteVideo p={p} stream={remoteStreams[p.id]} />
                      
                      <div className="absolute bottom-4 left-4 bg-slate-950/80 backdrop-blur-md py-1.5 px-3 rounded-xl text-[11px] font-medium border border-white/10 flex items-center gap-2">
                        <span className={p.videoEnabled ? "text-emerald-400 animate-pulse shadow-[0_0_5px_#22c55e]" : "text-slate-500"}>●</span>
                        <span>{p.name}</span>
                        {activeSpeakerId === p.id && p.micEnabled && (
                          <span className="flex items-center gap-0.5 ml-1.5">
                            <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_100ms]" />
                            <span className="w-0.5 h-3 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_300ms]" />
                            <span className="w-0.5 h-1.5 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_200ms]" />
                          </span>
                        )}
                        {!p.micEnabled && <span className="text-[10px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded border border-red-500/20 font-bold font-mono uppercase">Muted</span>}
                      </div>
                      {renderParticipantHostControls(p)}
                    </div>
                  ))}
                </div>
              )}
              {meetLayout === 'sidebar' && (
                <div className="flex flex-col lg:flex-row gap-5 w-full h-full max-h-[75vh] overflow-hidden items-center justify-center">
                  {/* Main spotlight card */}
                  {(() => {
                    const focusUser = spotlightParticipant;
                    return (
                      <div className={`flex-1 bg-slate-900 border rounded-3xl relative overflow-hidden flex flex-col items-center justify-center shadow-2xl w-full h-full min-h-[300px] aspect-video group ${
                        focusUser && activeSpeakerId === focusUser.id
                          ? "border-indigo-500 ring-2 ring-indigo-500/20 shadow-[0_0_25px_rgba(99,102,241,0.25)]"
                          : "border-white/10"
                      }`}>
                        {focusUser ? (
                          <>
                            <RemoteVideo p={focusUser} stream={remoteStreams[focusUser.id]} />
                            <div className="absolute top-4 right-4 bg-indigo-600 text-white text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shadow-lg z-10">
                              Active Speaker
                            </div>
                            <div className="absolute bottom-4 left-4 bg-slate-950/80 backdrop-blur-md py-1.5 px-3 rounded-xl text-xs font-semibold border border-white/10 flex items-center gap-2 z-10">
                              <span className="text-emerald-400 animate-pulse">●</span>
                              <span>{focusUser.name}</span>
                              {activeSpeakerId === focusUser.id && focusUser.micEnabled && (
                                <span className="flex items-center gap-0.5 ml-1.5">
                                  <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_100ms]" />
                                  <span className="w-0.5 h-3 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_300ms]" />
                                  <span className="w-0.5 h-1.5 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_200ms]" />
                                </span>
                              )}
                            </div>
                            {renderParticipantHostControls(focusUser)}
                          </>
                        ) : (
                          <>
                            {videoEnabled ? (
                              <video 
                                ref={(el) => {
                                  if (el && localStream && el.srcObject !== localStream) {
                                    el.srcObject = localStream;
                                  }
                                }}
                                autoPlay 
                                playsInline 
                                muted 
                                className="w-full h-full object-cover scale-x-[-1]"
                              />
                            ) : (
                              <div className="w-24 h-24 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-4xl uppercase">
                                {user.name.charAt(0)}
                              </div>
                            )}
                            <div className="absolute bottom-4 left-4 bg-slate-950/80 backdrop-blur-md py-1.5 px-3 rounded-xl text-xs font-semibold border border-white/10 flex items-center gap-2">
                              <span className="text-emerald-400">●</span> {user.name} (You)
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {/* Sidebar column */}
                  {activeParticipants.length > 0 && (
                    <div className="w-full lg:w-72 flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto pb-2 pr-1 h-32 lg:h-full lg:max-h-[75vh]">
                      {/* Self card first inside sidebar stack */}
                      <div className="flex-shrink-0 w-44 lg:w-full aspect-video bg-slate-900 border border-white/5 rounded-2xl relative overflow-hidden flex flex-col items-center justify-center shadow-md">
                        {videoEnabled ? (
                          <video 
                            ref={(el) => {
                              if (el && localStream && el.srcObject !== localStream) {
                                el.srcObject = localStream;
                              }
                            }}
                            autoPlay 
                            playsInline 
                            muted 
                            className="w-full h-full object-cover scale-x-[-1]"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-indigo-650/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-sm uppercase">
                            {user.name.charAt(0)}
                          </div>
                        )}
                        <div className="absolute bottom-2 left-2 bg-slate-950/80 backdrop-blur-md py-1 px-2 rounded-lg text-[9.5px] border border-white/5">
                          You
                        </div>
                      </div>

                      {/* Rest of students (excluding spotlight user) */}
                      {(() => {
                        const focusUser = spotlightParticipant;
                        return activeParticipants.filter((p) => !focusUser || p.id !== focusUser.id).map((p) => (
                          <div key={p.id} className={`flex-shrink-0 w-44 lg:w-full aspect-video bg-slate-900 border rounded-2xl relative overflow-hidden flex flex-col items-center justify-center shadow-md shadow-slate-950/20 group ${
                            activeSpeakerId === p.id
                              ? "border-indigo-500 ring-1 ring-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.2)]"
                              : "border-white/5"
                          }`}>
                            <RemoteVideo p={p} stream={remoteStreams[p.id]} />
                            <div className="absolute bottom-2 left-2 bg-slate-950/85 backdrop-blur-md py-1 px-2 rounded-lg text-[9.5px] border border-white/5 z-10 flex items-center gap-1">
                              <span>{p.name}</span>
                              {activeSpeakerId === p.id && p.micEnabled && (
                                <span className="flex items-center gap-0.5 ml-1">
                                  <span className="w-0.5 h-1.5 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_100ms]" />
                                  <span className="w-0.5 h-2.5 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_300ms]" />
                                  <span className="w-0.5 h-1 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_200ms]" />
                                </span>
                              )}
                            </div>
                            {renderParticipantHostControls(p)}
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              )}

              {/* Spotlight Layout */}
              {meetLayout === 'spotlight' && (
                <div className="w-full h-full max-h-[75vh] flex items-center justify-center">
                  {(() => {
                    const focusUser = spotlightParticipant;
                    return (
                      <div className={`w-full max-w-4xl aspect-video bg-slate-900 border rounded-3xl relative overflow-hidden flex flex-col items-center justify-center shadow-2xl group ${
                        focusUser && activeSpeakerId === focusUser.id
                          ? "border-indigo-500 ring-2 ring-indigo-500/20 shadow-[0_0_25px_rgba(99,102,241,0.25)]"
                          : "border-white/10"
                      }`}>
                        {focusUser ? (
                          <>
                            <RemoteVideo p={focusUser} stream={remoteStreams[focusUser.id]} />
                            <div className="absolute top-4 left-4 bg-indigo-600 text-white text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-full flex items-center gap-1 shadow-lg z-10">
                              <Sparkles className="w-3.5 h-3.5" /> Presenter Spotlight
                            </div>
                            <div className="absolute bottom-4 left-4 bg-slate-950/85 backdrop-blur-md py-2 px-3.5 rounded-xl text-xs font-semibold border border-white/10 flex items-center gap-2 z-10">
                              <span className="text-emerald-400 animate-pulse">●</span>
                              <span>{focusUser.name}</span>
                              {activeSpeakerId === focusUser.id && focusUser.micEnabled && (
                                <span className="flex items-center gap-0.5 ml-1.5">
                                  <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_100ms]" />
                                  <span className="w-0.5 h-3 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_300ms]" />
                                  <span className="w-0.5 h-1.5 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_200ms]" />
                                </span>
                              )}
                            </div>
                            {renderParticipantHostControls(focusUser)}
                          </>
                        ) : (
                          <>
                            {videoEnabled ? (
                              <video 
                                ref={(el) => {
                                  if (el && localStream && el.srcObject !== localStream) {
                                    el.srcObject = localStream;
                                  }
                                }}
                                autoPlay 
                                playsInline 
                                muted 
                                className="w-full h-full object-cover scale-x-[-1]"
                              />
                            ) : (
                              <div className="w-28 h-28 rounded-3xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-5xl uppercase">
                                {user.name.charAt(0)}
                              </div>
                            )}
                            <div className="absolute bottom-4 left-4 bg-slate-950/85 backdrop-blur-md py-2 px-3.5 rounded-xl text-xs font-semibold border border-white/10 flex items-center gap-2">
                              <span className="text-emerald-400">●</span> {user.name} (You)
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </>
          )}
        </div>

        {/* Floating Draggable & Minimizable Checkpoints Progress Tracker (Moved to Settings Modal) */}
        {false && isHost && (
          <div 
            style={{
            position: 'fixed',
            right: `${chkDragOffset.x}px`,
            top: `${chkDragOffset.y}px`,
            zIndex: 43
          }}
          className={`bg-slate-900/95 backdrop-blur-md border border-white/10 rounded-2xl w-72 shadow-2xl overflow-hidden transition-all duration-150 ${
            chkIsDragging ? "opacity-90 scale-[0.98]" : "opacity-100"
          }`}
        >
          {/* Header Drag Handle */}
          <div 
            onMouseDown={handleDragStart}
            onTouchStart={handleTouchStart}
            className="bg-indigo-950/95 p-3 flex items-center justify-between border-b border-white/10 cursor-grab active:cursor-grabbing text-xs text-white"
          >
            <div className="flex items-center gap-2 font-bold uppercase tracking-wider select-none pointer-events-none">
              <FileCheck className="w-4 h-4 text-indigo-400" />
              <span>Progress Checkpoints</span>
            </div>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setChkMinimized(!chkMinimized);
              }}
              className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-all cursor-pointer"
              title={chkMinimized ? "Expand checklists" : "Minimize checklists"}
            >
              {chkMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Checklist Body (only if not minimized) */}
          {!chkMinimized && (
            <div className="p-3.5 space-y-2.5 max-h-72 overflow-y-auto">
              {activeQuizzesList.length === 0 ? (
                <div className="text-center py-4 text-[10.5px] text-slate-500 font-mono">
                  No active checkpoints logged
                </div>
              ) : (
                activeQuizzesList.map((q, idx) => {
                  const answer = answers.find(a => a.quizIndex === idx);
                  const isCorrect = answer?.isCorrect;
                  // In live meetings, a checkpoint are unlocked/active if currentQuizIndex >= idx
                  const isUnlocked = currentQuizIndex >= idx;

                  return (
                    <div 
                      key={idx}
                      onClick={() => {
                        // Click to view/solve the checkpoint if student hasn't solved it yet
                        if (isUnlocked && !answer && !isHost) {
                          setCurrentQuiz(q);
                          setCurrentQuizIndex(idx);
                          setHasAnsweredCurrent(false);
                          setSelectedOption(null);
                        }
                      }}
                      className={`p-2.5 rounded-xl border text-[11px] transition-all flex items-center justify-between ${
                        isUnlocked && !answer && !isHost ? "cursor-pointer hover:border-indigo-500 hover:bg-slate-800" : ""
                      } ${
                        currentQuizIndex === idx && currentQuiz
                          ? "border-indigo-500 bg-indigo-950/40 text-indigo-300 font-bold animate-pulse"
                          : "border-white/5 bg-slate-950/40 text-slate-300"
                      }`}
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <span className="font-bold block text-[9px] uppercase font-mono tracking-widest text-slate-500">
                          Checkpoint {idx + 1}
                        </span>
                        <span className="font-medium truncate block" title={q.question}>{q.question}</span>
                      </div>
                      <div>
                        {!isUnlocked ? (
                          <span className="text-[8.5px] px-1.5 py-0.5 rounded bg-slate-900 border border-white/5 text-slate-600 font-mono font-bold">LOCKED</span>
                        ) : answer ? (
                          isCorrect ? (
                            <span className="text-[8.5px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold font-mono font-bold">CORRECT</span>
                          ) : (
                            <span className="text-[8.5px] px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-red-500 font-bold font-mono font-bold">FAILED</span>
                          )
                        ) : (
                          <span className="text-[8.5px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 font-extrabold font-mono animate-pulse uppercase">PENDING</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              {!isHost && (
                <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>Involvement grade:</span>
                  <span className="text-white font-bold">{scorePercentage}%</span>
                </div>
              )}

              {/* Simulation Accelerator for reviews */}
              <div className="pt-2.5 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-indigo-400 animate-pulse" /> Demo Accelerated Clocks
                </span>
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={demoMode}
                    onChange={(e) => setDemoMode(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-indigo-600 bg-slate-950 border-white/10 cursor-pointer"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Floating Sidebar overlay for Quizzes and Chat details */}
        {chatOpen && (
          <div className="w-80 md:w-96 border-l border-white/10 bg-slate-900/90 backdrop-blur-xl flex flex-col justify-between z-30">
            {/* Header Tabs */}
            <div className="p-3 border-b border-white/10 flex items-center justify-between">
              <div className="flex gap-1.5">
                <button
                  onClick={() => setSidebarTab('chat')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    sidebarTab === 'chat'
                      ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => setSidebarTab('people')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    sidebarTab === 'people'
                      ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  People
                  {allHandRaisers.length > 0 && (
                    <span className="bg-amber-500/20 text-amber-400 text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-500/20 animate-pulse">
                      ✋ {allHandRaisers.length}
                    </span>
                  )}
                </button>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-xs text-slate-400 hover:text-white cursor-pointer hover:underline">Close</button>
            </div>

            {/* TAB CONTENT: Chat */}
            {sidebarTab === 'chat' ? (
              <>
                {/* Chat list */}
                <div className="flex-1 p-4 overflow-y-auto space-y-4">
                  <div className="bg-indigo-500/5 p-3.5 rounded-xl border border-indigo-500/10 text-[11px] text-slate-400 leading-relaxed">
                    <span className="font-bold text-indigo-400 uppercase tracking-widest block text-[9.5px] mb-1">EduClass Automated Bot</span>
                    Interactive live classroom initiated. All students can join directly. Auto-recording active. AI Quizzes will distribute sequentially.
                  </div>

                  {chatMessages.map((m) => (
                    <div key={m.id} className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-200">{m.senderName}</span>
                        <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 border border-white/5">{m.senderRole}</span>
                        <span className="text-[9px] text-slate-500 ml-auto font-mono">{m.timestamp}</span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/40 p-2.5 rounded-lg border border-white/5">{m.message}</p>
                    </div>
                  ))}
                </div>

                {/* Chat Send */}
                <form onSubmit={handleSendMessage} className="p-4 border-t border-white/10 flex gap-2">
                  <input
                    type="text"
                    placeholder="Send a classroom comment..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs bg-slate-950 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button type="submit" className="p-2 bg-indigo-600 hover:bg-indigo-555 text-white rounded-xl transition-all cursor-pointer shadow-[0_0_10px_rgba(79,70,229,0.3)]">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </>
            ) : (
              /* TAB CONTENT: People & Hand Raisers */
              <div className="flex-1 p-4 overflow-y-auto space-y-5">
                {/* Hand Raisers Queue */}
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400 font-mono flex items-center gap-1">
                    <Hand className="w-3.5 h-3.5" />
                    <span>Hand Raisers Queue ({allHandRaisers.length})</span>
                  </span>
                  {allHandRaisers.length === 0 ? (
                    <p className="text-[11px] text-slate-500 font-mono italic p-3 bg-slate-950/40 rounded-xl border border-white/5">
                      No hands currently raised.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {allHandRaisers.map((p, idx) => (
                        <div
                          key={p.id}
                          className="p-3 bg-amber-500/5 rounded-xl border border-amber-500/10 flex items-center justify-between transition-all"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-amber-400 font-mono font-bold text-xs">#{idx + 1}</span>
                            <div>
                              <span className="text-xs font-bold text-slate-200 block leading-tight">{p.name}</span>
                              <span className="text-[9px] uppercase tracking-wider font-mono text-slate-500 font-bold">{p.role}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Hand className="w-3.5 h-3.5 text-amber-400 animate-bounce" />
                            {isHost && p.id !== user.uid && (
                              <button
                                onClick={async () => {
                                  // Lower student's hand remotely
                                  const pRef = doc(db, `meetings/${meeting.id}/presence`, p.id);
                                  await updateDoc(pRef, { handRaised: false, handRaisedAt: null });
                                }}
                                className="text-[10px] px-2 py-1 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg font-bold transition-all cursor-pointer"
                                title="Lower student hand"
                              >
                                Lower
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* All Present Participants */}
                <div className="space-y-2 border-t border-white/5 pt-4">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono block">
                    All Participants ({activeParticipants.length + 1})
                  </span>
                  <div className="space-y-2">
                    {/* Self item */}
                    <div className="p-2.5 bg-slate-950/50 rounded-xl border border-white/5 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-indigo-400">{user.name} (You)</span>
                        <span className="text-[9px] uppercase font-mono block text-slate-500">{user.role}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-400">
                        {videoEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5 text-red-400" />}
                        {micEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5 text-red-400" />}
                      </div>
                    </div>

                    {/* Remote Participants */}
                    {activeParticipants.map((p) => (
                      <div key={p.id} className="p-2.5 bg-slate-950/20 rounded-xl border border-white/5 flex items-center justify-between text-xs">
                        <div className="min-w-0 flex-1 pr-2">
                          <span className="font-bold text-slate-200 block truncate">{p.name}</span>
                          <span className="text-[9px] uppercase font-mono block text-slate-500">{p.role}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {isHost && p.id !== user.uid ? (
                            <div className="flex gap-1.5">
                              {/* Remote Mic Control button */}
                              <button
                                onClick={() => toggleParticipantMic(p.id, p.micEnabled)}
                                className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                                  p.micEnabled
                                    ? "bg-slate-800 border-white/10 text-slate-300 hover:bg-slate-750"
                                    : "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20"
                                }`}
                                title={p.micEnabled ? "Mute student microphone remotely" : "Unmute student microphone remotely"}
                              >
                                {p.micEnabled ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                              </button>

                              {/* Remote Camera Control button */}
                              <button
                                onClick={() => turnOffParticipantCam(p.id)}
                                disabled={!p.videoEnabled}
                                className={`p-1.5 rounded-lg border transition-all cursor-pointer disabled:opacity-30 ${
                                  p.videoEnabled
                                    ? "bg-slate-800 border-white/10 text-slate-300 hover:bg-slate-750"
                                    : "bg-red-500/10 border-red-500/20 text-red-400"
                                }`}
                                title="Turn off student camera transmission remotely"
                              >
                                {p.videoEnabled ? <Video className="w-3 h-3" /> : <VideoOff className="w-3 h-3" />}
                              </button>
                              {p.handRaised && (
                                <button
                                  onClick={async () => {
                                    const pRef = doc(db, `meetings/${meeting.id}/presence`, p.id);
                                    await updateDoc(pRef, { handRaised: false, handRaisedAt: null });
                                  }}
                                  className="p-1.5 rounded-lg border bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-all cursor-pointer"
                                  title="Lower hand"
                                >
                                  <Hand className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="flex gap-1.5 text-slate-400">
                              {p.videoEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5 text-red-400" />}
                              {p.micEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5 text-red-400" />}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ATTENTION POPUP "Are you available?" overlay */}
        {showAvailabilityPopup && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-white/10 p-10 rounded-[32px] max-w-sm text-center shadow-[0_0_50px_rgba(0,0,0,0.5)] scale-in-animation">
              <div className="w-16 h-16 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mx-auto mb-6 relative">
                <div className="absolute inset-0 bg-indigo-600 rounded-full animate-ping opacity-25"></div>
                <Bell className="w-8 h-8 text-indigo-400" />
              </div>
              <h3 className="text-xl font-bold tracking-tight text-white mb-2">Are you available?</h3>
              <p className="text-slate-400 text-xs leading-relaxed mb-6">
                AI Attendance Check: Please confirm your presence to maintain your activity score.
              </p>
              
              <div className="bg-slate-950 p-2 rounded-xl mb-6 text-xs text-slate-500 font-mono">
                Prompt expiration: <span className="font-bold text-indigo-400">{popupTimer}s</span>
              </div>

              <button
                onClick={handleAvailabilityClick}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-550 text-white font-bold text-xs rounded-xl shadow-[0_10px_20px_rgba(79,70,229,0.3)] transition-all cursor-pointer uppercase tracking-widest"
              >
                Yes, I am here
              </button>
            </div>
          </div>
        )}

        {/* ACTIVE MCQ QUIZ POPUP OVERLAY */}
        {currentQuiz && !isHost && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-40 p-4">
            <div className="bg-slate-900 border border-white/10 p-8 rounded-3xl max-w-lg w-full shadow-2xl">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
                <span className="text-[10px] font-mono tracking-widest text-slate-400 uppercase font-semibold">
                  AI Quiz {currentQuizIndex + 1} of {activeQuizzesList.length} • {currentQuiz.category || "Evaluation"}
                </span>
              </div>

              <h3 className="text-md font-semibold text-slate-100 leading-snug mb-6">
                {currentQuiz.question}
              </h3>

              <div className="space-y-2 mb-6">
                {currentQuiz.options.map((opt, oIdx) => {
                  const wasChosen = selectedOption === oIdx;
                  return (
                    <button
                      key={oIdx}
                      disabled={hasAnsweredCurrent}
                      onClick={() => setSelectedOption(oIdx)}
                      className={`w-full text-left p-3.5 rounded-xl text-xs transition-all flex items-center justify-between border cursor-pointer ${
                        wasChosen
                          ? "bg-indigo-600/20 border-indigo-500 text-indigo-300 font-semibold"
                          : "bg-slate-950 border-white/5 hover:bg-slate-805 text-slate-300"
                      }`}
                    >
                      <span>{opt}</span>
                      {hasAnsweredCurrent && oIdx === currentQuiz.correctAnswerIndex && (
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                      )}
                    </button>
                  );
                })}
              </div>

              {hasAnsweredCurrent ? (
                <div className="p-3.5 bg-slate-950 border border-white/5 rounded-xl mb-4 flex items-center gap-3">
                  {selectedOption === currentQuiz.correctAnswerIndex ? (
                    <span className="text-emerald-400 font-semibold text-xs flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4" /> Correct answer! Grade updated live.
                    </span>
                  ) : (
                    <span className="text-rose-400 text-xs flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4" /> Incorrect. Correct is: {currentQuiz.options[currentQuiz.correctAnswerIndex]}
                    </span>
                  )}
                </div>
              ) : null}

              <div className="flex gap-2">
                {!hasAnsweredCurrent ? (
                  <button
                    onClick={submitQuizAnswer}
                    disabled={selectedOption === null}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold text-xs rounded-xl shadow-lg transition-all cursor-pointer"
                  >
                    Submit Quiz Choice
                  </button>
                ) : (
                  <button
                    onClick={() => setCurrentQuiz(null)}
                    className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-350 font-bold text-xs rounded-xl transition-all cursor-pointer"
                  >
                    Return to Classroom Stream
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Meet Bottom Action Control Bar */}
      <div className="px-3 py-3 sm:p-5 border-t border-white/10 bg-slate-900/90 backdrop-blur-md flex items-center justify-between z-20 gap-2 sm:gap-0 overflow-x-auto">
        
        {/* Dynamic call metadata — clickable to open participants sidebar */}
        <div className="flex items-center gap-2 sm:gap-3 bg-slate-950/40 px-2 sm:px-3 py-1.5 rounded-2xl border border-white/5 flex-shrink-0">
          {/* Overlapping profile bubbles */}
          <div className="flex -space-x-2 mr-1">
            {/* Self bubble */}
            <div 
              className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-550 to-purple-600 border border-slate-900 flex items-center justify-center text-[10px] font-bold text-white uppercase shadow-md cursor-pointer hover:scale-105 transition-transform"
              onClick={() => {
                setShowParticipantsSidebar(true);
                setChatOpen(false);
              }}
              title={`${user.name} (You)`}
            >
              {user.name.charAt(0)}
            </div>

            {/* Remote participants bubbles */}
            {activeParticipants.slice(0, 3).map((p, idx) => {
              const colors = [
                "from-emerald-500 to-teal-600",
                "from-sky-500 to-blue-600",
                "from-amber-500 to-orange-600",
                "from-pink-500 to-rose-600"
              ];
              const colorClass = colors[idx % colors.length];

              return (
                <div
                  key={p.id}
                  className={`w-6 h-6 rounded-full bg-gradient-to-br ${colorClass} border border-slate-900 flex items-center justify-center text-[10px] font-bold text-white uppercase shadow-md cursor-pointer hover:scale-105 transition-transform`}
                  onClick={() => {
                    setShowParticipantsSidebar(true);
                    setChatOpen(false);
                  }}
                  title={p.name}
                >
                  {p.name.charAt(0)}
                </div>
              );
            })}

            {/* Overflow indicator bubble */}
            {activeParticipants.length > 3 && (
              <div 
                className="w-6 h-6 rounded-full bg-slate-800 border border-slate-900 flex items-center justify-center text-[8.5px] font-extrabold text-slate-350 shadow-md cursor-pointer hover:scale-105 transition-transform"
                onClick={() => {
                  setShowParticipantsSidebar(true);
                  setChatOpen(false);
                }}
                title="View all participants"
              >
                +{activeParticipants.length - 3}
              </div>
            )}
          </div>

          <button
            onClick={() => {
              setShowParticipantsSidebar(true);
              setChatOpen(false);
            }}
            className="text-xs text-slate-300 font-semibold font-mono flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
            title="View participants list"
          >
            <span>{activeParticipants.length + 1}</span>
          </button>


          {/* Hand-raise queue indicator — only shown when there are hand raisers */}
          {allHandRaisers.length > 0 && (
            <>
              <div className="w-px h-4 bg-white/10" />
              <button
                onClick={() => {
                  setShowParticipantsSidebar(true);
                  setChatOpen(false);
                }}
                className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-500/15 border border-amber-500/30 text-amber-400 rounded-lg text-[10px] font-bold cursor-pointer hover:bg-amber-500/25 transition-all animate-pulse"
                title="View hand-raise queue"
              >
                <Hand className="w-3 h-3" />
                <span>{allHandRaisers.length} raised</span>
              </button>
            </>
          )}
        </div>

        {/* Main calling interactors */}
        <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
          {/* BetterClass inspired View Switcher buttons — hidden on very small screens */}
          <div className="hidden sm:flex items-center bg-slate-950/60 rounded-full p-1 border border-white/5 gap-1 mr-1">
            <button
              onClick={() => setMeetLayout('grid')}
              className={`p-2.5 rounded-full cursor-pointer transition-all ${
                meetLayout === 'grid' 
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="BetterClass Grid View"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setMeetLayout('sidebar')}
              className={`p-2.5 rounded-full cursor-pointer transition-all ${
                meetLayout === 'sidebar' 
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Sidebar Sidebar View"
            >
              <LayoutTemplate className="w-4 h-4" />
            </button>
            <button
              onClick={() => setMeetLayout('spotlight')}
              className={`p-2.5 rounded-full cursor-pointer transition-all ${
                meetLayout === 'spotlight' 
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Spotlight Presenter View"
            >
              <Monitor className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setMicEnabled(!micEnabled)}
            className={`p-2.5 sm:p-3.5 rounded-full border transition-all cursor-pointer ${
              micEnabled
                ? "bg-slate-800 border-white/10 text-white hover:bg-slate-700"
                : "bg-red-500/10 border-red-505/20 text-red-400 hover:bg-red-500/20"
            }`}
            title={micEnabled ? "Mute Microphone" : "Unmute Microphone"}
          >
            {micEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setVideoEnabled(!videoEnabled)}
            className={`p-2.5 sm:p-3.5 rounded-full border transition-all cursor-pointer ${
              videoEnabled
                ? "bg-slate-800 border-white/10 text-white hover:bg-slate-700"
                : "bg-red-500/10 border-red-505/20 text-red-400 hover:bg-red-500/20"
            }`}
            title={videoEnabled ? "Stop Camera Transmission" : "Start Camera Transmission"}
          >
            {videoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
          </button>

          {!isHost && (
            <button
              onClick={toggleHand}
              className={`p-2.5 sm:p-3.5 rounded-full border transition-all cursor-pointer hover:bg-slate-700 ${
                handRaised ? "bg-amber-500/20 border-amber-500/50 text-amber-400" : "bg-slate-800 border-white/10 text-slate-300"
              }`}
              title={handRaised ? "Lower Hand" : "Raise Hand"}
            >
              <Hand className={`w-4 h-4 ${handRaised ? "fill-amber-400 text-amber-400" : ""}`} />
            </button>
          )}

          <button
            onClick={() => {
              // If either our local stream ref OR Firestore shows us as the sharer, stop
              if (screenStreamRef.current || meetingState?.screenShareBy === user.uid) {
                stopScreenShare();
              } else {
                startScreenShare();
              }
            }}
            className={`p-2.5 sm:p-3.5 rounded-full border transition-all cursor-pointer hover:bg-slate-700 ${
              screenStream || meetingState?.screenShareBy === user.uid ? "bg-emerald-600/30 border-emerald-500/50 text-emerald-400 animate-pulse" : "bg-slate-800 border-white/10 text-slate-300"
            }`}
            title={screenStream || meetingState?.screenShareBy === user.uid ? "Stop Sharing Screen" : "Share Screen"}
          >
            <Monitor className="w-4 h-4" />
          </button>

          {/* Presenter Tools popup toggle — only while screen sharing is active */}
          {screenStream && (
            <button
              onClick={togglePresenterTools}
              className={`hidden sm:block p-2.5 sm:p-3.5 rounded-full border transition-all cursor-pointer hover:bg-slate-700 ${
                showMinimizedPopup
                  ? "bg-indigo-600/30 border-indigo-500/50 text-indigo-400"
                  : "bg-slate-800 border-white/10 text-slate-300"
              }`}
              title={showMinimizedPopup ? "Hide Presenter Tools" : "Show Presenter Tools"}
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          )}

          {isHost && (
            <button
              onClick={() => {
                // Ensure active settings tab is appropriate for user role
                setActiveSettingsTab('controls');
                setShowSettingsModal(true);
              }}
              className="p-2.5 sm:p-3.5 rounded-full border transition-all cursor-pointer hover:bg-slate-700 bg-slate-800 border-white/10 text-slate-300"
              title="Session Settings & Control Room"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => setShowLeaveModal(true)}
            className="p-2.5 sm:p-3.5 bg-red-600 hover:bg-red-500 text-white rounded-full shadow-lg flex items-center justify-center cursor-pointer transition-all border border-red-500/40"
            title="Leave / Finish Session"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>

        {/* Profile score / chat status */}
        <div className="flex items-center gap-3">
          {!isHost && (
            <div className="px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-lg flex items-center gap-1.5 text-[11px] font-bold text-indigo-400">
              <Award className="w-3.5 h-3.5" />
              <span>Score: <span className="text-white font-mono">{scorePercentage}%</span></span>
            </div>
          )}
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={`p-2.5 rounded-full border transition-all cursor-pointer relative ${
              chatOpen
                ? "bg-indigo-600/30 border-indigo-500/50 text-indigo-400"
                : "bg-slate-800 border-white/10 text-slate-300 hover:bg-slate-700"
            }`}
            title="Classroom Chat"
          >
            <MessageSquare className="w-4 h-4" />
            {unreadChatCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-indigo-600 text-white text-[9px] font-bold w-4.5 h-4.5 rounded-full flex items-center justify-center border border-slate-900 animate-pulse">
                {unreadChatCount}
              </span>
            )}
          </button>
        </div>

      </div>

      {/* Leave Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
          <div className="bg-slate-900 border border-white/10 p-6 rounded-[24px] max-w-sm w-full text-center shadow-[0_0_50px_rgba(0,0,0,0.5)] scale-in-animation">
            <h3 className="text-lg font-bold text-white mb-2">Leave Session</h3>
            <p className="text-slate-400 text-xs leading-relaxed mb-6">
              Do you want to leave the class, or finish the meeting for everyone?
            </p>
            <div className="space-y-3">
              <button
                onClick={async () => {
                  setShowLeaveModal(false);
                  // Stop screen sharing before leaving to clean up state
                  if (screenStreamRef.current) {
                    await stopScreenShare();
                  }
                  onLeave();
                }}
                className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer border border-white/10"
              >
                Leave Class
              </button>
              {isHost && (
                <button
                  onClick={() => {
                    setShowLeaveModal(false);
                    setShowFinishConfirmModal(true);
                  }}
                  className="w-full py-3 bg-red-600/10 hover:bg-red-600/20 text-red-500 font-bold text-xs rounded-xl transition-all cursor-pointer border border-red-500/20"
                >
                  Finish Meeting
                </button>
              )}
              <button
                onClick={() => setShowLeaveModal(false)}
                className="w-full py-2 text-slate-400 hover:text-white text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Finish Confirmation Modal */}
      {showFinishConfirmModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
          <div className="bg-slate-900 border border-red-500/30 p-6 rounded-[24px] max-w-sm w-full text-center shadow-[0_0_50px_rgba(239,68,68,0.2)] scale-in-animation">
            <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center mx-auto mb-4 text-red-500">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Finish Meeting?</h3>
            <p className="text-slate-400 text-xs leading-relaxed mb-6">
              This will permanently end the session for all participants and generate the final recording.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowFinishConfirmModal(false)}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer border border-white/10"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowFinishConfirmModal(false);
                  handleEndMeeting();
                }}
                className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-lg border border-red-500/40"
              >
                Yes, Finish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Participants Sidebar — opens when clicking present count or hand-raise indicator */}
      {showParticipantsSidebar && (
        <div className="fixed inset-y-0 right-0 w-80 bg-slate-900/97 backdrop-blur-xl border-l border-white/10 flex flex-col z-50 shadow-2xl">
          {/* Header */}
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-slate-950/60">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-400" />
              <span className="font-bold text-sm text-white">Participants</span>
              <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">{activeParticipants.length + 1}</span>
            </div>
            <button
              onClick={() => setShowParticipantsSidebar(false)}
              className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-all cursor-pointer"
            >✕</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Hand Raisers Queue (sorted by raise time) */}
            {allHandRaisers.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400 font-mono flex items-center gap-1.5">
                  <Hand className="w-3.5 h-3.5" />
                  Hand Queue ({allHandRaisers.length})
                </span>
                <div className="space-y-1.5">
                  {allHandRaisers.map((p, idx) => (
                    <div key={p.id} className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-amber-400 font-mono font-bold text-xs w-5">#{idx + 1}</span>
                        <div className="w-8 h-8 rounded-full bg-amber-500/15 border border-amber-500/20 flex items-center justify-center text-amber-300 font-bold text-sm uppercase flex-shrink-0">
                          {p.name.charAt(0)}
                        </div>
                        <div>
                          <span className="text-xs font-bold text-slate-200 block leading-tight">{p.name}</span>
                          <span className="text-[9px] uppercase tracking-wider font-mono text-slate-500">{p.role}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Hand className="w-3.5 h-3.5 text-amber-400 animate-bounce" />
                        {isHost && p.id !== user.uid && (
                          <button
                            onClick={async () => {
                              const pRef = doc(db, `meetings/${meeting.id}/presence`, p.id);
                              await updateDoc(pRef, { handRaised: false, handRaisedAt: null });
                            }}
                            className="text-[10px] px-2 py-1 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg font-bold transition-all cursor-pointer"
                          >
                            Lower
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All Participants */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono block">
                All Participants ({activeParticipants.length + 1})
              </span>

              {/* Self */}
              <div className="p-3 bg-slate-950/50 rounded-xl border border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-sm uppercase flex-shrink-0">
                    {user.name.charAt(0)}
                  </div>
                  <div>
                    <span className="text-xs font-bold text-indigo-300 block">{user.name} (You)</span>
                    <span className="text-[9px] uppercase font-mono text-slate-500">{user.role}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-slate-400">
                  {videoEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5 text-red-400" />}
                  {micEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5 text-red-400" />}
                  {handRaised && <Hand className="w-3.5 h-3.5 text-amber-400" />}
                </div>
              </div>

              {/* Remote participants — sorted: hand raisers first */}
              {[...activeParticipants]
                .sort((a, b) => {
                  if (a.handRaised && !b.handRaised) return -1;
                  if (!a.handRaised && b.handRaised) return 1;
                  const tA = a.handRaisedAt ? new Date(a.handRaisedAt).getTime() : Infinity;
                  const tB = b.handRaisedAt ? new Date(b.handRaisedAt).getTime() : Infinity;
                  return tA - tB;
                })
                .map((p) => (
                  <div key={p.id} className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                    p.handRaised ? "bg-amber-500/5 border-amber-500/15" : "bg-slate-950/30 border-white/5"
                  }`}>
                    <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                      <div className="w-9 h-9 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-slate-300 font-bold text-sm uppercase flex-shrink-0 relative">
                        {p.name.charAt(0)}
                        {p.handRaised && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center text-[8px]">✋</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-slate-200 block truncate">{p.name}</span>
                        <span className="text-[9px] uppercase font-mono text-slate-500">{p.role}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isHost && p.id !== user.uid ? (
                        <>
                          <button
                            onClick={() => toggleParticipantMic(p.id, p.micEnabled)}
                            className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                              p.micEnabled ? "bg-slate-800 border-white/10 text-slate-300 hover:bg-slate-700" : "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20"
                            }`}
                            title={p.micEnabled ? "Mute" : "Unmute"}
                          >
                            {p.micEnabled ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                          </button>
                          <button
                            onClick={() => turnOffParticipantCam(p.id)}
                            disabled={!p.videoEnabled}
                            className={`p-1.5 rounded-lg border transition-all cursor-pointer disabled:opacity-30 ${
                              p.videoEnabled ? "bg-slate-800 border-white/10 text-slate-300 hover:bg-slate-700" : "bg-red-500/10 border-red-500/20 text-red-400"
                            }`}
                            title="Turn off camera"
                          >
                            {p.videoEnabled ? <Video className="w-3 h-3" /> : <VideoOff className="w-3 h-3" />}
                          </button>
                          {p.handRaised && (
                            <button
                              onClick={async () => {
                                const pRef = doc(db, `meetings/${meeting.id}/presence`, p.id);
                                await updateDoc(pRef, { handRaised: false, handRaisedAt: null });
                              }}
                              className="p-1.5 rounded-lg border bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-all cursor-pointer"
                              title="Lower hand"
                            >
                              <Hand className="w-3 h-3" />
                            </button>
                          )}
                        </>
                      ) : (
                        <div className="flex gap-1.5 text-slate-400">
                          {p.videoEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5 text-red-400" />}
                          {p.micEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5 text-red-400" />}
                          {p.handRaised && <Hand className="w-3.5 h-3.5 text-amber-400 animate-bounce" />}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}

      {/* Presenter Tools Popup — PiP or Fallback */}
      {showMinimizedPopup && (() => {
        const popupContent = (
          <div className="flex flex-col h-full w-full bg-slate-950 text-slate-200">
            {/* Header / Drag Handle (only drag if not in native PiP) */}
            <div
              onMouseDown={!pipWindow ? handleMinPopupMouseDown : undefined}
              onTouchStart={!pipWindow ? handleMinPopupTouchStart : undefined}
              className="bg-indigo-950/80 px-3 py-2 flex items-center justify-between border-b border-white/10 select-none text-[10px] font-bold uppercase tracking-wider text-indigo-300"
              style={{ cursor: pipWindow ? 'default' : 'grab' }}
            >
              <span className="flex items-center gap-1.5">
                <Monitor className="w-3 h-3 text-indigo-400 animate-pulse" />
                <span>Presenter Tools</span>
              </span>
              {!pipWindow && (
                <button
                  onClick={() => setShowMinimizedPopup(false)}
                  className="text-slate-400 hover:text-white font-bold cursor-pointer"
                  title="Dismiss popup"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Action controls */}
            <div className="p-3 bg-slate-900/50 flex flex-wrap items-center justify-around gap-2 border-b border-white/5">
              {/* Mic toggle */}
              <button
                onClick={() => setMicEnabled(!micEnabled)}
                className={`p-2 rounded-xl border transition-all cursor-pointer ${
                  micEnabled
                    ? "bg-slate-800 border-white/10 text-white hover:bg-slate-700"
                    : "bg-red-500/20 border-red-500/30 text-red-400"
                }`}
                title={micEnabled ? "Mute Microphone" : "Unmute Microphone"}
              >
                {micEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </button>

              {/* Cam toggle */}
              <button
                onClick={() => setVideoEnabled(!videoEnabled)}
                className={`p-2 rounded-xl border transition-all cursor-pointer ${
                  videoEnabled
                    ? "bg-slate-800 border-white/10 text-white hover:bg-slate-700"
                    : "bg-red-500/20 border-red-500/30 text-red-400"
                }`}
                title={videoEnabled ? "Stop Camera" : "Start Camera"}
              >
                {videoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
              </button>

              {/* Host Specific Controls */}
              {isHost && (
                <>
                  <button
                    onClick={handleMuteAll}
                    className="p-2 bg-slate-800 border-white/10 text-white hover:bg-slate-700 rounded-xl transition-all cursor-pointer border"
                    title="Mute All Participants"
                  >
                    <MicOff className="w-4 h-4 text-red-400" />
                  </button>
                  <button
                    onClick={handleTurnOffAllCameras}
                    className="p-2 bg-slate-800 border-white/10 text-white hover:bg-slate-700 rounded-xl transition-all cursor-pointer border"
                    title="Turn Off All Cameras"
                  >
                    <VideoOff className="w-4 h-4 text-red-400" />
                  </button>
                  <button
                    onClick={() => {
                      window.focus(); // Focus main window
                      setActiveSettingsTab('controls');
                      setShowSettingsModal(true);
                    }}
                    className="p-2 bg-slate-800 border-white/10 text-white hover:bg-slate-700 rounded-xl transition-all cursor-pointer border"
                    title="Open Settings in Main Window"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                </>
              )}

              {/* Student Raise/Lower hand */}
              {!isHost && (
                <button
                  onClick={toggleHand}
                  className={`p-2 rounded-xl border transition-all cursor-pointer ${
                    handRaised
                      ? "bg-amber-500/20 border-amber-500/30 text-amber-400 font-bold"
                      : "bg-slate-800 border-white/10 text-slate-300"
                  }`}
                  title={handRaised ? "Lower Hand" : "Raise Hand"}
                >
                  <Hand className={`w-4 h-4 ${handRaised ? "fill-amber-400 text-amber-400" : ""}`} />
                </button>
              )}

              {/* Leave Meeting */}
              <button
                onClick={() => {
                  window.focus(); // Focus main window
                  setShowLeaveModal(true);
                }}
                className="p-2 bg-red-600 hover:bg-red-500 border border-red-500/30 text-white rounded-xl transition-all cursor-pointer shadow-md"
                title="Leave Meeting"
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>

            {/* Hand Raisers List Queue inside Popup */}
            <div className="p-3 space-y-2 flex-1 overflow-y-auto">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono block">Queue ({allHandRaisers.length})</span>
              {allHandRaisers.length === 0 ? (
                <p className="text-[10px] text-slate-500 italic font-mono">No hands raised.</p>
              ) : (
                <div className="space-y-1.5">
                  {allHandRaisers.map((p, idx) => (
                    <div key={p.id} className="p-2 bg-amber-500/5 border border-amber-500/10 rounded-lg flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-300 truncate max-w-[200px]">#{idx + 1} {p.name}</span>
                      <div className="flex items-center gap-2">
                        <Hand className="w-3.5 h-3.5 text-amber-400 animate-pulse flex-shrink-0" />
                        {isHost && p.id !== user.uid && (
                          <button
                            onClick={async () => {
                              const pRef = doc(db, `meetings/${meeting.id}/presence`, p.id);
                              await updateDoc(pRef, { handRaised: false, handRaisedAt: null });
                            }}
                            className="text-[9px] px-2 py-1 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded font-bold cursor-pointer transition-all"
                          >
                            Lower
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

        if (pipWindow) {
          // Render inside the native Document Picture-in-Picture window using top-level createPortal import
          return createPortal(popupContent, pipWindow.document.body);
        }

        // Fallback for browsers that don't support Document PiP (e.g. Firefox)
        return (
          <div
            style={{
              position: 'fixed',
              left: `${minPopupPos.x}px`,
              top: `${minPopupPos.y}px`,
              zIndex: 9999,
            }}
            className={`w-72 bg-slate-950/95 backdrop-blur-md border border-indigo-500/40 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden text-white transition-all duration-150 ${
              minPopupDragging ? "opacity-90 scale-[0.98]" : "opacity-100"
            }`}
          >
            {popupContent}
          </div>
        );
      })()}

      {/* Session Settings & Control Room Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            
            {/* Modal Header */}
            <div className="bg-indigo-950/80 px-6 py-4 flex items-center justify-between border-b border-white/10">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" />
                <span className="font-extrabold uppercase tracking-widest text-sm text-white">
                  {isHost ? "Session Settings & Control Room" : "Progress Checkpoints & Milestones"}
                </span>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-400 hover:text-white font-bold text-lg p-1 hover:bg-white/10 rounded-lg transition-all cursor-pointer"
                title="Close settings"
              >
                ✕
              </button>
            </div>

            {/* Role-based Tab Headers (Only shown if user is Teacher/Host) */}
            {isHost && (
              <div className="flex border-b border-white/10 bg-slate-950/40 p-1 gap-1">
                <button
                  onClick={() => setActiveSettingsTab('controls')}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 ${
                    activeSettingsTab === 'controls'
                      ? "bg-indigo-600 text-white shadow-lg"
                      : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                  }`}
                >
                  <FileCheck className="w-4 h-4" />
                  Teacher Control Room
                </button>
                <button
                  onClick={() => setActiveSettingsTab('checkpoints')}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 ${
                    activeSettingsTab === 'checkpoints'
                      ? "bg-indigo-600 text-white shadow-lg"
                      : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                  }`}
                >
                  <Clock className="w-4 h-4" />
                  Progress Checkpoints ({activeQuizzesList.length})
                </button>
              </div>
            )}

            {/* Modal Scrollable Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-slate-900/50">
              
              {/* Tab Content: Teacher Controls */}
              {isHost && activeSettingsTab === 'controls' && (
                <div className="space-y-6">

                  {/* AI Questioning Row */}
                  <div className="bg-slate-950/40 p-4 border border-white/5 rounded-2xl space-y-3">
                    <div className="flex items-center gap-1.5 text-slate-300 font-bold text-xs uppercase tracking-wider">
                      <Sparkles className="w-4 h-4 text-indigo-400" />
                      Dynamic AI Questioning
                    </div>
                    <button
                      onClick={triggerLiveDiscussionQuizGeneration}
                      disabled={generatingLiveQuiz}
                      className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-550 disabled:opacity-40 text-white font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(79,70,229,0.2)]"
                    >
                      {generatingLiveQuiz ? (
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent animate-spin rounded-full" />
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
                          <span>Generate & Send Live Quiz</span>
                        </>
                      )}
                    </button>
                    <p className="text-[11px] text-indigo-200 leading-snug">
                      {meetingState?.liveQuizGenerationEnabled 
                        ? "• Auto live mode is ACTIVE. AI triggers a checkmark every 10-15 minutes or click to trigger manually right now."
                        : "• Click above to instantly generate a custom quiz based on the current live class discussions."}
                    </p>
                  </div>

                  {/* Moderation section */}
                  <div className="bg-slate-950/40 p-4 border border-white/5 rounded-2xl space-y-3">
                    <div className="text-slate-300 font-bold text-xs uppercase tracking-wider">Classroom Moderation</div>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={handleMuteAll}
                        className="py-2.5 px-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <MicOff className="w-4 h-4" />
                        <span>Mute All</span>
                      </button>
                      <button
                        onClick={handleTurnOffAllCameras}
                        className="py-2.5 px-3 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <VideoOff className="w-4 h-4" />
                        <span>Cam Off All</span>
                      </button>
                    </div>
                  </div>

                  {/* Live Cohort Responses list */}
                  <div className="bg-slate-950/40 p-4 border border-white/5 rounded-2xl space-y-3">
                    <div className="text-slate-300 font-bold text-xs uppercase tracking-wider">
                      Cohort Interactive Grade List ({liveResponses.length})
                    </div>
                    {liveResponses.length === 0 ? (
                      <p className="text-xs text-slate-500 italic font-mono">No student responses connected.</p>
                    ) : (
                      <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                        {liveResponses.map((r) => (
                          <div key={r.id} className="p-3 bg-slate-900/60 rounded-xl border border-white/5 flex items-center justify-between text-xs">
                            <span className="text-slate-300 font-bold truncate max-w-[180px]">{r.userName}</span>
                            <span className={`font-mono font-bold text-xs px-2.5 py-1 rounded-lg ${
                              r.overallPercentage >= 80 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                              r.overallPercentage >= 50 ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"
                            }`}>{r.overallPercentage}% Score</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tab Content: Progress Checkpoints */}
              {(!isHost || activeSettingsTab === 'checkpoints') && (
                <div className="space-y-6">
                  {/* Quizzes checklist list */}
                  <div className="space-y-3">
                    <div className="text-slate-300 font-bold text-xs uppercase tracking-wider flex items-center justify-between">
                      <span>Live Session Checkpoints</span>
                      <span className="text-[10px] text-indigo-400 font-mono font-normal">
                        ({activeQuizzesList.filter((_, idx) => currentQuizIndex >= idx).length} Unlocked)
                      </span>
                    </div>

                    {activeQuizzesList.length === 0 ? (
                      <div className="text-center py-8 text-slate-500 font-mono text-xs border border-dashed border-white/10 rounded-2xl">
                        No active checkpoints logged for this session yet
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {activeQuizzesList.map((q, idx) => {
                          const answer = answers.find(a => a.quizIndex === idx);
                          const isCorrect = answer?.isCorrect;
                          const isUnlocked = currentQuizIndex >= idx;

                          return (
                            <div
                              key={idx}
                              onClick={() => {
                                // If student, they can click pending quizzes to answer them
                                if (isUnlocked && !answer && !isHost) {
                                  setCurrentQuiz(q);
                                  setCurrentQuizIndex(idx);
                                  setHasAnsweredCurrent(false);
                                  setSelectedOption(null);
                                  setShowSettingsModal(false); // dismiss settings modal to focus on the quiz prompt
                                }
                              }}
                              className={`p-4 rounded-xl border transition-all ${
                                isUnlocked && !answer && !isHost 
                                  ? "cursor-pointer hover:border-indigo-500 hover:bg-slate-800 bg-slate-950/60" 
                                  : "bg-slate-950/30"
                              } ${
                                currentQuizIndex === idx && currentQuiz
                                  ? "border-indigo-500 bg-indigo-950/20"
                                  : "border-white/5"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1 flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-extrabold text-[9px] uppercase tracking-wider font-mono text-indigo-400 bg-indigo-450/10 px-1.5 py-0.5 rounded">
                                      Checkpoint #{idx + 1}
                                    </span>
                                    {q.category && (
                                      <span className="text-[9px] font-medium text-slate-500 font-mono">
                                        {q.category}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-xs font-semibold text-slate-200 block truncate" title={q.question}>
                                    {q.question}
                                  </span>
                                </div>
                                <div className="flex-shrink-0">
                                  {!isUnlocked ? (
                                    <span className="text-[10px] px-2 py-0.5 rounded-lg bg-slate-900 border border-white/5 text-slate-600 font-mono font-bold">LOCKED</span>
                                  ) : answer ? (
                                    isCorrect ? (
                                      <span className="text-[10px] px-2 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 font-mono font-bold">CORRECT</span>
                                    ) : (
                                      <span className="text-[10px] px-2 py-0.5 rounded-lg bg-rose-500/15 border border-rose-500/25 text-red-400 font-mono font-bold">FAILED</span>
                                    )
                                  ) : (
                                    <span className="text-[10px] px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/25 text-amber-400 font-extrabold font-mono animate-pulse uppercase">PENDING</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Student Grade Suffix */}
                  {!isHost && (
                    <div className="p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-2xl flex items-center justify-between text-xs">
                      <div className="space-y-0.5">
                        <span className="text-slate-400 font-medium block">Current Attendance Grade</span>
                        <span className="text-[10.5px] text-slate-500 leading-snug block">
                          Based on answered live checkpoints and interactive checks.
                        </span>
                      </div>
                      <span className="text-lg font-mono font-black text-indigo-300">{scorePercentage}%</span>
                    </div>
                  )}


                  {/* 3 Toggle Buttons: Attendance / Discussion Quiz / Pre-generated Quiz */}
                  <div className="mt-2 space-y-2 border-t border-white/5 pt-4">
                    <span className="text-slate-300 font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                      Feature Toggles
                    </span>

                    {/* Toggle 1: Attendance */}
                    <div className="flex items-center justify-between p-3.5 bg-slate-950/40 border border-white/5 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                          <Bell className="w-4 h-4 text-indigo-400" />
                        </div>
                        <div>
                          <span className="text-xs font-bold text-slate-200 block">Attendance Check-ins</span>
                          <span className="text-[10px] text-slate-500">Random presence verification popups</span>
                        </div>
                      </div>
                      <button
                        onClick={isHost ? async () => {
                          await updateDoc(doc(db, "meetings", meeting.id), {
                            activeVerificationDisabled: !meetingState?.activeVerificationDisabled
                          });
                        } : undefined}
                        className={`relative w-11 h-6 rounded-full border transition-all flex items-center ${isHost ? "cursor-pointer" : "cursor-not-allowed opacity-60"} ${
                          !meetingState?.activeVerificationDisabled ? "bg-indigo-600 border-indigo-500/50 justify-end pr-1" : "bg-slate-800 border-white/10 justify-start pl-1"
                        }`}
                      >
                        <span className="w-4 h-4 rounded-full bg-white shadow-sm block" />
                      </button>
                    </div>

                    {/* Toggle 2: Discussion Quiz AI Live */}
                    <div className="flex items-center justify-between p-3.5 bg-slate-950/40 border border-white/5 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                          <Sparkles className="w-4 h-4 text-indigo-400" />
                        </div>
                        <div>
                          <span className="text-xs font-bold text-slate-200 block">Discussion Quiz (AI Live)</span>
                          <span className="text-[10px] text-slate-500">Auto-generated from live chat & discussion</span>
                        </div>
                      </div>
                      <button
                        onClick={isHost ? async () => {
                          await updateDoc(doc(db, "meetings", meeting.id), {
                            liveQuizGenerationEnabled: !meetingState?.liveQuizGenerationEnabled
                          });
                        } : undefined}
                        className={`relative w-11 h-6 rounded-full border transition-all flex items-center ${isHost ? "cursor-pointer" : "cursor-not-allowed opacity-60"} ${
                          meetingState?.liveQuizGenerationEnabled ? "bg-indigo-600 border-indigo-500/50 justify-end pr-1" : "bg-slate-800 border-white/10 justify-start pl-1"
                        }`}
                      >
                        <span className="w-4 h-4 rounded-full bg-white shadow-sm block" />
                      </button>
                    </div>

                    {/* Toggle 3: Pre-generated Quiz */}
                    <div className="flex items-center justify-between p-3.5 bg-slate-950/40 border border-white/5 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                          <HelpCircle className="w-4 h-4 text-indigo-400" />
                        </div>
                        <div>
                          <span className="text-xs font-bold text-slate-200 block">Pre-generated Quiz</span>
                          <span className="text-[10px] text-slate-500">Scheduled milestone evaluation quizzes</span>
                        </div>
                      </div>
                      <button
                        onClick={isHost ? async () => {
                          await updateDoc(doc(db, "meetings", meeting.id), {
                            liveQuizDisabled: !meetingState?.liveQuizDisabled
                          });
                        } : undefined}
                        className={`relative w-11 h-6 rounded-full border transition-all flex items-center ${isHost ? "cursor-pointer" : "cursor-not-allowed opacity-60"} ${
                          !meetingState?.liveQuizDisabled ? "bg-indigo-600 border-indigo-500/50 justify-end pr-1" : "bg-slate-800 border-white/10 justify-start pl-1"
                        }`}
                      >
                        <span className="w-4 h-4 rounded-full bg-white shadow-sm block" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

            </div>


          </div>
        </div>
      )}

    </div>
  );
};
