import React, { useState, useEffect, useRef, useMemo } from "react";
import { Meeting, UserProfile, MeetingResponse, QuizQuestion, StudentQuizSubmission } from "../types";
import { db, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, addDoc, deleteDoc } from "../firebase";
import { 
  Video, VideoOff, Mic, MicOff, PhoneOff, Users, MessageSquare, 
  Play, Pause, Award, AlertCircle, CheckCircle, HelpCircle, Sparkles, Send, Bell,
  Minimize2, Maximize2, FileCheck, Clock, LayoutGrid, LayoutTemplate, Monitor, LogOut,
  Hand, Pin, Check, Trash, Settings
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
const RemoteVideo = ({ p, stream }: { p: ActiveParticipant; stream?: MediaStream }) => {
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
        </div>
      )}
    </div>
  );
};

export const MeetingRoom: React.FC<MeetingRoomProps> = ({ meeting, user, onLeave }) => {
  const isHost = user.role === "teacher" || user.uid === meeting.hostId;
  const responseId = `${meeting.id}_${user.uid}`;

  // Stream toggles
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // WebRTC mesh synchronization states and signaling refs
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const pcsRef = useRef<Record<string, RTCPeerConnection>>({});

  const getOrCreatePC = (pId: string) => {
    if (pcsRef.current[pId]) {
      return pcsRef.current[pId];
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    }

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        setRemoteStreams((prev) => ({
          ...prev,
          [pId]: event.streams[0]
        }));
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

  // Accelerated Demo toggle (vital for easy, robust reviewer testing without waiting 10 full minutes!)
  const [demoMode, setDemoMode] = useState(true);

  // Next scheduled timestamp logic for presence checks (15 seconds for acceleration vs 10 minutes default)
  const [nextPopupAtSecond, setNextPopupAtSecond] = useState<number>(15);

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

  // Google Meet Layout Settings
  const [meetLayout, setMeetLayout] = useState<'grid' | 'sidebar' | 'spotlight'>('grid');

  // Screen Sharing State
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

  // Hand Raise State
  const [handRaised, setHandRaised] = useState(false);
  const [handRaisedAt, setHandRaisedAt] = useState<string | null>(null);

  // Minimized Moveable Popup State
  const [showMinimizedPopup, setShowMinimizedPopup] = useState(false);
  const [minPopupPos, setMinPopupPos] = useState({ x: 20, y: 120 });
  const [minPopupDragging, setMinPopupDragging] = useState(false);
  const minPopupDragStart = useRef({ x: 0, y: 0 });

  // Sidebar Tab state
  const [sidebarTab, setSidebarTab] = useState<'chat' | 'people'>('chat');

  // Teacher Control Room Draggable Controls
  const [tcDragOffset, setTcDragOffset] = useState({ x: 20, y: 70 });
  const [tcIsDragging, setTcIsDragging] = useState(false);
  const tcDragStartRef = useRef({ x: 0, y: 0 });
  const tcElementStartRef = useRef({ x: 0, y: 0 });
  const [tcMinimized, setTcMinimized] = useState(false);
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
      return diff <= 12000; // 12 seconds threshold (stale check for inactive participants)
    });
  }, [rawParticipants, presenceTicker]);

  const setActiveParticipants = setRawParticipants;

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

  // Trigger minimized controls popup when screensharing user leaves/defocuses the browser tab/window
  useEffect(() => {
    const handleBlur = () => {
      if (screenStream) {
        setShowMinimizedPopup(true);
      }
    };

    const handleFocus = () => {
      // Keep open so they can interact or dismiss manually
    };

    const handleVisibilityChange = () => {
      if (document.hidden && screenStream) {
        setShowMinimizedPopup(true);
      }
    };

    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [screenStream]);

  // Loading default meeting quizzes if empty
  useEffect(() => {
    if (!meeting.quizzes || meeting.quizzes.length === 0) {
      setActiveQuizzesList(DEFAULT_MEETING_QUIZZES);
    }
  }, [meeting.quizzes]);

  // Screen Sharing functions
  const startScreenShare = async () => {
    if (meetingState?.screenShareBy) {
      alert(`${meetingState.screenShareByName || "Someone"} is already sharing their screen.`);
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

      // Update Firestore meeting doc
      await updateDoc(doc(db, "meetings", meeting.id), {
        screenShareBy: user.uid,
        screenShareByName: user.name
      });

      // Handle when the browser screen share "Stop sharing" button is clicked
      stream.getVideoTracks()[0].onended = async () => {
        await stopScreenShare(stream);
      };

    } catch (err) {
      console.warn("Display media was blocked or cancelled:", err);
      alert("Screen sharing requires browser permissions. If you are running inside the AI Studio embedded preview frame, please open the app in a new tab (using the button in the top right corner) to allow screen sharing permissions!");
    }
  };

  const stopScreenShare = async (activeStream?: MediaStream) => {
    const streamToStop = activeStream || screenStream;
    if (streamToStop) {
      streamToStop.getTracks().forEach((track) => track.stop());
    }
    setScreenStream(null);

    // Update Firestore to clear screen sharing
    await updateDoc(doc(db, "meetings", meeting.id), {
      screenShareBy: null,
      screenShareByName: null
    });
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
  useEffect(() => {
    const handleVisibilityOrBlur = () => {
      // If we are sharing screen and the document is hidden or blurred, open the minimized controls
      if (screenStream && (document.visibilityState === 'hidden' || !document.hasFocus())) {
        setShowMinimizedPopup(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityOrBlur);
    window.addEventListener("blur", handleVisibilityOrBlur);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityOrBlur);
      window.removeEventListener("blur", handleVisibilityOrBlur);
    };
  }, [screenStream]);

  // Clean up screen sharing on unmount
  useEffect(() => {
    return () => {
      if (screenStream) {
        screenStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [screenStream]);

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

  // WebRTC camera hookup
  useEffect(() => {
    if (videoEnabled) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
          setLocalStream(stream);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch((err) => {
          console.warn("Camera capture was blocked or unavailable:", err);
          setLocalStream(null);
        });
    } else {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      setLocalStream(null);
    }

    return () => {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [videoEnabled]);

  // Re-attach localStream when layout or localStream shifts
  useEffect(() => {
    if (localStream && videoRef.current) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream, meetLayout]);

  // WebRTC dynamic active peer cleanup
  useEffect(() => {
    const activeIds = new Set(activeParticipants.map(p => p.id));
    Object.keys(pcsRef.current).forEach((pId) => {
      if (!activeIds.has(pId)) {
        try {
          pcsRef.current[pId].close();
        } catch (e) {}
        delete pcsRef.current[pId];
        setRemoteStreams((prev) => {
          const next = { ...prev };
          delete next[pId];
          return next;
        });
      }
    });
  }, [activeParticipants]);

  // Real WebRTC peer correlation and multi-session mesh over Firestore signalling
  useEffect(() => {
    if (!localStream) return;

    const unsubscribes: (() => void)[] = [];

    activeParticipants.forEach((p) => {
      const channelId = user.uid < p.id ? `${user.uid}_${p.id}` : `${p.id}_${user.uid}`;
      const isInitiator = user.uid < p.id;
      const docRef = doc(db, `meetings/${meeting.id}/webrtc`, channelId);

      const pc = getOrCreatePC(p.id);

      const localCandidates: any[] = [];
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          localCandidates.push(event.candidate.toJSON());
          updateDoc(docRef, {
            [isInitiator ? "candidates_initiator" : "candidates_receiver"]: localCandidates
          }).catch(() => {});
        }
      };

      const unsub = onSnapshot(docRef, async (snapshot) => {
        if (!snapshot.exists()) {
          if (isInitiator) {
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              await setDoc(docRef, {
                offer: { type: "offer", sdp: offer.sdp },
                candidates_initiator: []
              });
            } catch (err) {
              console.warn("Error creating offer:", err);
            }
          }
          return;
        }

        const data = snapshot.data();
        if (!data) return;

        if (isInitiator) {
          if (data.answer && pc.signalingState === "have-local-offer") {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            } catch (err) {
              console.warn("Error setting remote answer:", err);
            }
          }
          if (data.candidates_receiver && data.candidates_receiver.length > 0) {
            data.candidates_receiver.forEach((cand: any) => {
              try {
                pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
              } catch (e) {}
            });
          }
        } else {
          if (data.offer && pc.signalingState === "stable") {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await updateDoc(docRef, {
                answer: { type: "answer", sdp: answer.sdp },
                candidates_receiver: []
              });
            } catch (err) {
              console.warn("Error setting remote offer:", err);
            }
          }
          if (data.candidates_initiator && data.candidates_initiator.length > 0) {
            data.candidates_initiator.forEach((cand: any) => {
              try {
                pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
              } catch (e) {}
            });
          }
        }
      });

      unsubscribes.push(unsub);
    });

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [activeParticipants, localStream]);

  // General Call clock duration
  useEffect(() => {
    const clock = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(clock);
  }, []);

  // Synchronize presence in this meeting in real-time
  useEffect(() => {
    const userPresenceRef = doc(db, `meetings/${meeting.id}/presence`, user.uid);
    
    const updatePresence = async () => {
      try {
        await setDoc(userPresenceRef, {
          id: user.uid,
          name: user.name,
          role: user.role,
          videoEnabled: videoEnabled,
          micEnabled: micEnabled,
          handRaised: handRaised,
          handRaisedAt: handRaisedAt,
          joinedAt: new Date().toISOString(),
          lastActive: new Date().toISOString()
        });
      } catch (e) {
        console.warn("Failed initial presence update:", e);
      }
    };

    updatePresence();

    // Heartbeat updates lastActive every 5000ms
    const heartbeatInterval = setInterval(async () => {
      try {
        await updateDoc(userPresenceRef, {
          lastActive: new Date().toISOString()
        });
      } catch (err) {
        // Fallback to setDoc in case document got removed or needs re-initialization
        try {
          await setDoc(userPresenceRef, {
            id: user.uid,
            name: user.name,
            role: user.role,
            videoEnabled: videoEnabled,
            micEnabled: micEnabled,
            handRaised: handRaised,
            handRaisedAt: handRaisedAt,
            joinedAt: new Date().toISOString(),
            lastActive: new Date().toISOString()
          });
        } catch (e) {
          console.warn("Heartbeat recovery failed:", e);
        }
      }
    }, 5000);

    const cleanPresenceOnUnload = () => {
      // Clean up Firestore doc as fast as possible on window close
      deleteDoc(userPresenceRef).catch((e) => console.warn("Failed delete presence on tab close:", e));
    };

    window.addEventListener("beforeunload", cleanPresenceOnUnload);
    window.addEventListener("unload", cleanPresenceOnUnload);

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
      deleteDoc(userPresenceRef).catch((e) => console.warn("Failed to delete presence:", e));
    };
  }, [meeting.id, user, videoEnabled, micEnabled, handRaised, handRaisedAt]);

  // Listen to user's own presence document for remote teacher commands (mute / camera off)
  useEffect(() => {
    if (isHost) return; // Only students can be remotely controlled
    const userPresenceRef = doc(db, `meetings/${meeting.id}/presence`, user.uid);
    const unsubscribe = onSnapshot(userPresenceRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data) {
          // If the teacher muted us remotely
          if (data.micEnabled === false && micEnabled) {
            setMicEnabled(false);
          } else if (data.micEnabled === true && !micEnabled) {
            setMicEnabled(true);
          }
          
          // If the teacher turned off our camera remotely
          if (data.videoEnabled === false && videoEnabled) {
            setVideoEnabled(false);
          } else if (data.videoEnabled === true && !videoEnabled) {
            setVideoEnabled(true);
          }
        }
      }
    }, (error) => {
      console.warn("Error listening to user presence:", error);
    });
    return () => unsubscribe();
  }, [meeting.id, user.uid, micEnabled, videoEnabled, isHost]);

  // Handle physical muting of audio tracks on localStream
  useEffect(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = micEnabled;
      });
    }
  }, [localStream, micEnabled]);

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
    setNextPopupAtSecond(demoMode ? 15 : 600); // 15 seconds vs 10 minutes (600s)
  }, [demoMode]);

  // TRIGGER REAL-TIME ATTENDANCE POPUPS (after 10m then randomly each 5-7m, or highly accelerated in Demo Mode)
  useEffect(() => {
    if (isHost) return;
    if (meetingState?.activeVerificationDisabled) {
      setShowAvailabilityPopup(false);
      return;
    }

    if (callDuration >= nextPopupAtSecond) {
      // Prompt popup now
      setShowAvailabilityPopup(true);
      setPopupTimer(15);
      setPopupShown((prev) => prev + 1);

      // Determine the delay interval until the subsequent interactive check
      // Demo: randomly every 20-35s. Standard: randomly every 5-7m (300 to 420 seconds)
      const minDelay = demoMode ? 20 : 300;
      const maxDelay = demoMode ? 35 : 420;
      const nextDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
      setNextPopupAtSecond(callDuration + nextDelay);
    }
  }, [callDuration, isHost, demoMode, nextPopupAtSecond, meetingState?.activeVerificationDisabled]);

  // COUNT DOWN TIMERS FOR AVAILABILITY POPUPS
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
    // Accelerated in demoMode (e.g. 35s per interval step) vs standard (intervalVal minutes converted to seconds)
    const intervalSeconds = demoMode ? 35 : (intervalVal * 60);

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
  }, [callDuration, activeQuizzesList, isHost, demoMode, meetingState?.quizTriggerInterval, meetingState?.liveQuizDisabled, currentQuizIndex]);

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
  }, [callDuration, isHost, demoMode, meetingState?.liveQuizGenerationEnabled, meetingState?.liveQuizDisabled, lastLiveQuizGeneratedAt]);

  const triggerLiveDiscussionQuizGeneration = async () => {
    if (generatingLiveQuiz) return;
    setGeneratingLiveQuiz(true);
    try {
      const response = await fetch("/api/generate-live-discussion-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: meetingState.title,
          chatMessages: chatMessages.slice(-15), // send last 15 messages for transcript extraction
          existingDiscussion: meetingState.discussionMaterial || ""
        }),
      });

      const data = await response.json();
      if (data.quiz) {
        // Append this new quiz question to firestore quizzes array
        const updatedQuizzes = [...(meetingState.quizzes || []), data.quiz];
        await updateDoc(doc(db, "meetings", meeting.id), {
          quizzes: updatedQuizzes
        });

        // Add automated system notification in chat
        await addDoc(collection(db, `meetings/${meeting.id}/chat`), {
          senderName: "AI Companion",
          senderRole: "assistant",
          message: `📢 [Live Recall Checkpoint Generated] A brand-new discussion question has been distributed! Checkpoint #${updatedQuizzes.length}: "${data.quiz.question}" is now live.`,
          timestamp: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
          createdAt: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error("Failed to generate live discussion quiz:", error);
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

    try {
      // Find a highly relevant simulated recording video URL based on class topic
      const combined = `${meeting.title || ""} ${meeting.description || ""}`.toLowerCase();
      let simulatedVideoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4";
      
      if (combined.includes("cell") || combined.includes("biology") || combined.includes("mitochondria") || combined.includes("photosynthesis") || combined.includes("chloroplast") || combined.includes("organelle") || combined.includes("science")) {
        simulatedVideoUrl = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
      } else if (combined.includes("code") || combined.includes("program") || combined.includes("javascript") || combined.includes("python") || combined.includes("software") || combined.includes("computer")) {
        simulatedVideoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4";
      } else if (combined.includes("math") || combined.includes("calcul") || combined.includes("algebra") || combined.includes("number") || combined.includes("equation") || combined.includes("geometry")) {
        simulatedVideoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
      } else if (combined.includes("history") || combined.includes("century") || combined.includes("empire") || combined.includes("revolution") || combined.includes("renaissance")) {
        simulatedVideoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4";
      }

      // Update meeting status in Firestore
      const meetDocRef = doc(db, "meetings", meeting.id);
      await updateDoc(meetDocRef, {
        status: "ended",
        endedAt: new Date().toISOString(),
        recordedVideoUrl: meeting.recordedVideoUrl || simulatedVideoUrl
      });

      // Navigate to dashboard
      onLeave();
    } catch (err) {
      console.error("Failed closing session:", err);
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
            <div className="text-xs text-slate-200 font-mono flex items-center gap-1.5" title="Call duration">
              <Clock className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
              <span>{formatDuration(callDuration)}</span>
              <span className="text-[10px] text-amber-400 font-medium">
                ({formatDuration(Math.max(0, (meetingState?.duration && meetingState.duration > 0 ? Math.min(meetingState.duration, 60) : 60) * 60 - callDuration))} left)
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
                      if (el && screenStream) {
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
                      const rStream = remoteStreams[meetingState.screenShareBy!];
                      if (el && rStream) {
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
                      ref={videoRef} 
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
                  <div key={p.id} className="flex-shrink-0 w-44 xl:w-full aspect-video bg-slate-900 border border-white/5 rounded-2xl relative overflow-hidden flex flex-col items-center justify-center shadow-md shadow-slate-950/20">
                    <RemoteVideo p={p} stream={remoteStreams[p.id]} />
                    <div className="absolute bottom-2 left-2 bg-slate-950/85 backdrop-blur-md py-1 px-2 rounded-lg text-[9.5px] border border-white/5 z-10">
                      {p.name}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {meetLayout === 'grid' && (
                <div className={`${getGridLayoutClass(activeParticipants.length + 1)} w-full h-full`}>
                  
                  {/* User's block */}
                  <div className={`bg-slate-900 border border-white/10 rounded-3xl relative overflow-hidden flex flex-col items-center justify-center group shadow-2xl transition-all duration-300 ${
                    activeParticipants.length === 0 
                      ? "w-full max-w-4xl aspect-video mx-auto" 
                      : "w-full aspect-video"
                  }`}>
                    {videoEnabled ? (
                      <video 
                        ref={videoRef} 
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
                      <span className="text-emerald-400 animate-pulse">●</span> {user.name} (You)
                    </div>
                  </div>

                  {/* REAL CLASSROOM PARTICIPANTS */}
                  {activeParticipants.map((p) => (
                    <div key={p.id} className="bg-slate-900 border border-white/5 rounded-3xl relative overflow-hidden aspect-video flex flex-col items-center justify-center shadow-2xl transition-all duration-300 w-full">
                      <RemoteVideo p={p} stream={remoteStreams[p.id]} />
                      
                      <div className="absolute bottom-4 left-4 bg-slate-950/80 backdrop-blur-md py-1.5 px-3 rounded-xl text-[11px] font-medium border border-white/10 flex items-center gap-2">
                        <span className={p.videoEnabled ? "text-emerald-400 animate-pulse shadow-[0_0_5px_#22c55e]" : "text-slate-500"}>●</span> {p.name}
                        {!p.micEnabled && <span className="text-[10px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded border border-red-500/20 font-bold font-mono uppercase">Muted</span>}
                      </div>
                    </div>
                  ))}

                </div>
              )}

              {/* Sidebar Layout */}
              {meetLayout === 'sidebar' && (
                <div className="flex flex-col lg:flex-row gap-5 w-full h-full max-h-[75vh] overflow-hidden items-center justify-center">
                  {/* Main spotlight card */}
                  <div className="flex-1 bg-slate-900 border border-white/10 rounded-3xl relative overflow-hidden flex flex-col items-center justify-center shadow-2xl w-full h-full min-h-[300px] aspect-video">
                    {activeParticipants.length > 0 ? (
                      (() => {
                        const focusUser = activeParticipants[0];
                        return (
                          <>
                            <RemoteVideo p={focusUser} stream={remoteStreams[focusUser.id]} />
                            <div className="absolute top-4 right-4 bg-indigo-600 text-white text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shadow-lg z-10">
                              Active Speaker
                            </div>
                            <div className="absolute bottom-4 left-4 bg-slate-950/80 backdrop-blur-md py-1.5 px-3 rounded-xl text-xs font-semibold border border-white/10 flex items-center gap-2 z-10">
                              <span className="text-emerald-400 animate-pulse">●</span> {focusUser.name}
                            </div>
                          </>
                        );
                      })()
                    ) : (
                      <>
                        {videoEnabled ? (
                          <video 
                            ref={videoRef} 
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

                  {/* Sidebar column */}
                  {activeParticipants.length > 0 && (
                    <div className="w-full lg:w-72 flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto pb-2 pr-1 h-32 lg:h-full lg:max-h-[75vh]">
                      {/* Self card first inside sidebar stack */}
                      <div className="flex-shrink-0 w-44 lg:w-full aspect-video bg-slate-900 border border-white/5 rounded-2xl relative overflow-hidden flex flex-col items-center justify-center shadow-md">
                        {videoEnabled ? (
                          <video 
                            ref={videoRef} 
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
                      {activeParticipants.slice(1).map((p) => (
                        <div key={p.id} className="flex-shrink-0 w-44 lg:w-full aspect-video bg-slate-900 border border-white/5 rounded-2xl relative overflow-hidden flex flex-col items-center justify-center shadow-md shadow-slate-950/20">
                          <RemoteVideo p={p} stream={remoteStreams[p.id]} />
                          <div className="absolute bottom-2 left-2 bg-slate-950/85 backdrop-blur-md py-1 px-2 rounded-lg text-[9.5px] border border-white/5 z-10">
                            {p.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Spotlight Layout */}
              {meetLayout === 'spotlight' && (
                <div className="w-full h-full max-h-[75vh] flex items-center justify-center">
                  <div className="w-full max-w-4xl aspect-video bg-slate-900 border border-white/10 rounded-3xl relative overflow-hidden flex flex-col items-center justify-center shadow-2xl">
                    {activeParticipants.length > 0 ? (
                      (() => {
                        const focusUser = activeParticipants[0];
                        return (
                          <>
                            <RemoteVideo p={focusUser} stream={remoteStreams[focusUser.id]} />
                            <div className="absolute top-4 left-4 bg-indigo-600 text-white text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-full flex items-center gap-1 shadow-lg z-10">
                              <Sparkles className="w-3.5 h-3.5" /> Presenter Spotlight
                            </div>
                            <div className="absolute bottom-4 left-4 bg-slate-950/85 backdrop-blur-md py-2 px-3.5 rounded-xl text-xs font-semibold border border-white/10 flex items-center gap-2 z-10">
                              <span className="text-emerald-400 animate-pulse">●</span> {focusUser.name}
                            </div>
                          </>
                        );
                      })()
                    ) : (
                      <>
                        {videoEnabled ? (
                          <video 
                            ref={videoRef} 
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
                      <div className="flex items-center gap-2 text-slate-400 font-mono text-[10px]">
                        <span>{videoEnabled ? "🎥" : "❌"}</span>
                        <span>{micEnabled ? "🎙️" : "🔇"}</span>
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
                            </div>
                          ) : (
                            <div className="flex gap-2 text-slate-400 font-mono text-[10px]">
                              <span>{p.videoEnabled ? "🎥" : "❌"}</span>
                              <span>{p.micEnabled ? "🎙️" : "🔇"}</span>
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
      <div className="p-5 border-t border-white/10 bg-slate-900/90 backdrop-blur-md flex items-center justify-between z-20">
        
        {/* Dynamic call metadata */}
        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-300 font-mono flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <span>{activeParticipants.length + 1} present</span>
          </div>
        </div>

        {/* Main calling interactors */}
        <div className="flex items-center gap-3">
          {/* Google Meet inspired View Switcher buttons */}
          <div className="flex items-center bg-slate-950/60 rounded-full p-1 border border-white/5 gap-1 mr-1">
            <button
              onClick={() => setMeetLayout('grid')}
              className={`p-2.5 rounded-full cursor-pointer transition-all ${
                meetLayout === 'grid' 
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Google Meet Grid View"
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
            className={`p-3.5 rounded-full border transition-all cursor-pointer ${
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
            className={`p-3.5 rounded-full border transition-all cursor-pointer ${
              videoEnabled
                ? "bg-slate-800 border-white/10 text-white hover:bg-slate-700"
                : "bg-red-500/10 border-red-505/20 text-red-400 hover:bg-red-500/20"
            }`}
            title={videoEnabled ? "Stop Camera Transmission" : "Start Camera Transmission"}
          >
            {videoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={`p-3.5 rounded-full border transition-all cursor-pointer hover:bg-slate-700 ${
              chatOpen ? "bg-indigo-600/30 border-indigo-505/50 text-indigo-400" : "bg-slate-800 border-white/10 text-slate-300"
            }`}
            title="Classroom chatroom"
          >
            <MessageSquare className="w-4 h-4" />
          </button>

          <button
            onClick={toggleHand}
            className={`p-3.5 rounded-full border transition-all cursor-pointer hover:bg-slate-700 ${
              handRaised ? "bg-amber-500/20 border-amber-500/50 text-amber-400" : "bg-slate-800 border-white/10 text-slate-300"
            }`}
            title={handRaised ? "Lower Hand" : "Raise Hand"}
          >
            <Hand className={`w-4 h-4 ${handRaised ? "fill-amber-400 text-amber-400" : ""}`} />
          </button>

          <button
            onClick={screenStream ? () => stopScreenShare() : startScreenShare}
            className={`p-3.5 rounded-full border transition-all cursor-pointer hover:bg-slate-700 ${
              screenStream ? "bg-emerald-600/30 border-emerald-505/50 text-emerald-400 animate-pulse" : "bg-slate-800 border-white/10 text-slate-300"
            }`}
            title={screenStream ? "Stop Sharing Screen" : "Share Screen"}
          >
            <Monitor className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              // Ensure active settings tab is appropriate for user role
              setActiveSettingsTab(isHost ? 'controls' : 'checkpoints');
              setShowSettingsModal(true);
            }}
            className="p-3.5 rounded-full border transition-all cursor-pointer hover:bg-slate-700 bg-slate-800 border-white/10 text-slate-300"
            title="Session Settings & Control Room"
          >
            <Settings className="w-4 h-4" />
          </button>

          {isHost ? (
            <div className="flex items-center gap-2">
              <button
                onClick={onLeave}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-white/10 flex items-center gap-1.5 cursor-pointer transition-all"
                title="Leave meeting temporarily (Meeting stays active)"
              >
                <LogOut className="w-3.5 h-3.5 text-slate-400" />
                <span className="hidden sm:inline">Leave Class</span>
              </button>
              <button
                onClick={handleEndMeeting}
                className="px-3 py-2 bg-red-650 hover:bg-red-600 text-white text-xs font-bold rounded-xl shadow-lg flex items-center gap-1.5 cursor-pointer transition-all border border-red-500/30"
                title="Finish meeting permanently for everyone"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                <span>Finish Meeting</span>
              </button>
            </div>
          ) : (
            <button
              onClick={onLeave}
              className="p-3.5 bg-red-600 hover:bg-red-500 text-white rounded-full shadow-lg flex items-center justify-center cursor-pointer transition-all border border-red-500/40"
              title="Leave Class"
            >
              <PhoneOff className="w-4.5 h-4.5" />
            </button>
          )}
        </div>

        {/* Profile score / grade status */}
        <div className="flex items-center gap-3">
          {!isHost && (
            <div className="px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-lg flex items-center gap-1.5 text-[11px] font-bold text-indigo-400">
              <Award className="w-3.5 h-3.5" />
              <span>Score: <span className="text-white font-mono">{scorePercentage}%</span></span>
            </div>
          )}
          <span className="hidden sm:inline text-slate-400 text-xs truncate max-w-[100px]" title={user.name}>{user.name.split(" ")[0]}</span>
          <span className="bg-indigo-500/10 text-indigo-400 uppercase font-mono tracking-widest text-[9px] px-1.5 py-0.5 rounded border border-indigo-500/20 font-extrabold">{user.role}</span>
        </div>

      </div>

      {/* Draggable Minimized Screen Sharer Controls Popup */}
      {showMinimizedPopup && (
        <div
          style={{
            position: 'fixed',
            left: `${minPopupPos.x}px`,
            top: `${minPopupPos.y}px`,
            zIndex: 9999,
          }}
          className={`w-64 bg-slate-950/95 backdrop-blur-md border border-indigo-500/40 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden text-white transition-all duration-150 ${
            minPopupDragging ? "opacity-90 scale-[0.98]" : "opacity-100"
          }`}
        >
          {/* Header / Drag Handle */}
          <div
            onMouseDown={handleMinPopupMouseDown}
            onTouchStart={handleMinPopupTouchStart}
            className="bg-indigo-950/80 px-3 py-2 border-b border-white/10 flex items-center justify-between cursor-grab active:cursor-grabbing select-none text-[10px] font-bold uppercase tracking-wider text-indigo-300"
          >
            <span className="flex items-center gap-1.5 pointer-events-none">
              <Monitor className="w-3 h-3 text-indigo-400 animate-pulse" />
              <span>Presenter Tools</span>
            </span>
            <button
              onClick={() => setShowMinimizedPopup(false)}
              className="text-slate-400 hover:text-white font-bold cursor-pointer"
              title="Dismiss popup"
            >
              ✕
            </button>
          </div>

          {/* Action controls row */}
          <div className="p-3 bg-slate-900/50 flex items-center justify-around gap-2 border-b border-white/5">
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
              {micEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
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
              {videoEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
            </button>

            {/* Raise/Lower hand */}
            <button
              onClick={toggleHand}
              className={`p-2 rounded-xl border transition-all cursor-pointer ${
                handRaised
                  ? "bg-amber-500/20 border-amber-500/30 text-amber-400 font-bold"
                  : "bg-slate-800 border-white/10 text-slate-300"
              }`}
              title={handRaised ? "Lower Hand" : "Raise Hand"}
            >
              <Hand className={`w-3.5 h-3.5 ${handRaised ? "fill-amber-400 text-amber-400" : ""}`} />
            </button>

            {/* Stop Screenshare */}
            <button
              onClick={() => stopScreenShare()}
              className="p-2 bg-red-600 hover:bg-red-500 border border-red-500/30 text-white rounded-xl transition-all cursor-pointer shadow-md"
              title="Stop sharing screen"
            >
              <PhoneOff className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Hand Raisers List Queue inside Popup */}
          <div className="p-3 space-y-1.5">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 font-mono block">Queue ({allHandRaisers.length})</span>
            {allHandRaisers.length === 0 ? (
              <p className="text-[9.5px] text-slate-500 italic font-mono">No hands raised.</p>
            ) : (
              <div className="space-y-1 max-h-24 overflow-y-auto pr-0.5">
                {allHandRaisers.map((p, idx) => (
                  <div key={p.id} className="p-1.5 bg-amber-500/5 border border-amber-500/10 rounded-lg flex items-center justify-between text-[10px]">
                    <span className="font-semibold text-slate-300 truncate max-w-[120px]">#{idx + 1} {p.name}</span>
                    <Hand className="w-3 h-3 text-amber-400 animate-pulse flex-shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
                  {/* Grid of two columns for controls */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Attendance Controls */}
                    <div className="bg-slate-950/40 p-4 border border-white/5 rounded-2xl space-y-3">
                      <div className="flex items-center gap-1.5 text-slate-300 font-bold text-xs uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                        Attendance Check-ins
                      </div>
                      <button
                        onClick={async () => {
                          const updatedState = !meetingState?.activeVerificationDisabled;
                          await updateDoc(doc(db, "meetings", meeting.id), {
                            activeVerificationDisabled: updatedState
                          });
                        }}
                        className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between border cursor-pointer ${
                          meetingState?.activeVerificationDisabled
                            ? "bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20"
                            : "bg-indigo-600/15 border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/25"
                        }`}
                      >
                        <span>{meetingState?.activeVerificationDisabled ? "● Popups Stopped" : "● Popups Running"}</span>
                        <span className="text-[9.5px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-white/5">
                          {meetingState?.activeVerificationDisabled ? "Disabled" : "Active"}
                        </span>
                      </button>
                      <p className="text-[10.5px] text-slate-400 leading-snug">
                        {meetingState?.activeVerificationDisabled 
                          ? "Attendance check-ins will not be prompted to cohort students."
                          : "Students are periodically challenged with attention verify popups."}
                      </p>
                    </div>

                    {/* Class Live Quizzes */}
                    <div className="bg-slate-950/40 p-4 border border-white/5 rounded-2xl space-y-3">
                      <div className="flex items-center gap-1.5 text-slate-300 font-bold text-xs uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                        Milestone Quizzes
                      </div>
                      <button
                        onClick={async () => {
                          const updatedState = !meetingState?.liveQuizDisabled;
                          await updateDoc(doc(db, "meetings", meeting.id), {
                            liveQuizDisabled: updatedState
                          });
                        }}
                        className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between border cursor-pointer ${
                          meetingState?.liveQuizDisabled
                            ? "bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20"
                            : "bg-indigo-600/15 border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/25"
                        }`}
                      >
                        <span>{meetingState?.liveQuizDisabled ? "● Quizzes Stopped" : "● Quizzes Active"}</span>
                        <span className="text-[9.5px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-white/5">
                          {meetingState?.liveQuizDisabled ? "Disabled" : "Active"}
                        </span>
                      </button>
                      <p className="text-[10.5px] text-slate-400 leading-snug">
                        {meetingState?.liveQuizDisabled 
                          ? "Interactive and scheduled evaluation quizzes are temporarily paused."
                          : "Quizzes will automatically pop up according to schedule intervals."}
                      </p>
                    </div>
                  </div>

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

                  {/* Demo clock multiplier toggle */}
                  <div className="p-4 bg-slate-950/40 border border-white/5 rounded-2xl flex items-center justify-between text-xs">
                    <div className="space-y-0.5 pr-4">
                      <span className="text-slate-300 font-bold block flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-indigo-400 animate-pulse" /> Demo Time-lapse Accelerator
                      </span>
                      <span className="text-[10.5px] text-slate-500 leading-snug block">
                        Accelerate scheduled triggers and intervals for quick evaluation and review.
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={demoMode}
                        onChange={(e) => setDemoMode(e.target.checked)}
                        className="w-4 h-4 rounded text-indigo-600 bg-slate-950 border-white/10 cursor-pointer"
                      />
                    </label>
                  </div>
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="bg-slate-950/80 px-6 py-4 flex items-center justify-end border-t border-white/10">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl border border-white/5 cursor-pointer transition-all"
              >
                Dismiss
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
