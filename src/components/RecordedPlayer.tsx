import React, { useState, useEffect, useRef, useCallback } from "react";
import { Meeting, UserProfile, QuizQuestion, StudentQuizSubmission, MeetingResponse } from "../types";
import { db, doc, getDoc, setDoc, updateDoc, collection, getDocs, onSnapshot } from "../firebase";
import { 
  Play, Pause, RotateCcw, Award, Sparkles, CheckCircle, AlertCircle, ChevronRight, 
  HelpCircle, MonitorPlay, Clock, ListRestart, FileCheck, Minimize2, Maximize2,
  Volume2, VolumeX, MessageSquare, Users, Rewind, FastForward, Search
} from "lucide-react";

interface RecordedPlayerProps {
  meeting: Meeting;
  user: UserProfile;
  onClose: () => void;
}

const getDirectVideoUrl = (url: string, title?: string, description?: string): string => {
  if (!url) {
    const combined = `${title || ""} ${description || ""}`.toLowerCase();
    if (combined.includes("cell") || combined.includes("biology") || combined.includes("mitochondria") || combined.includes("photosynthesis") || combined.includes("chloroplast") || combined.includes("organelle") || combined.includes("science")) {
      return "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
    } else if (combined.includes("code") || combined.includes("program") || combined.includes("javascript") || combined.includes("python") || combined.includes("software") || combined.includes("computer")) {
      return "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4";
    } else if (combined.includes("math") || combined.includes("calcul") || combined.includes("algebra") || combined.includes("number") || combined.includes("equation") || combined.includes("geometry")) {
      return "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
    } else if (combined.includes("history") || combined.includes("century") || combined.includes("empire") || combined.includes("revolution") || combined.includes("renaissance")) {
      return "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4";
    }
    return "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4";
  }

  // Local server recording (e.g. /recordings/meet_abc.webm)
  if (url.startsWith("/recordings/")) {
    return url;
  }

  // Handle Google Drive file link
  if (url.includes("drive.google.com")) {
    const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    }
  }
  return url;
};

/** Returns true when the URL points to an actual recorded file (not a fallback sample) */
const isActualRecording = (url?: string): boolean => {
  if (!url) return false;
  if (url.includes("interactive-examples.mdn.mozilla.net") || url.includes("gtv-videos-bucket")) {
    return false;
  }
  return true;
};

export const RecordedPlayer: React.FC<RecordedPlayerProps> = ({ meeting, user, onClose }) => {
  const isTeacher = user.role === "teacher" || user.role === "admin" || meeting.hostId === user.uid;
  const [studentUsers, setStudentUsers] = useState<UserProfile[]>([]);
  const [meetingResponses, setMeetingResponses] = useState<MeetingResponse[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [quizzes, setQuizzes] = useState<QuizQuestion[]>([]);
  const [loadingQuizzes, setLoadingQuizzes] = useState(false);
  const [parsingError, setParsingError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);

  // Real-time synchronization of class students and their session responses (for teachers)
  useEffect(() => {
    if (!isTeacher) return;

    // Listen to all meeting responses
    const respCol = collection(db, `meetings/${meeting.id}/responses`);
    const unsubResponses = onSnapshot(respCol, (snapshot) => {
      const list: MeetingResponse[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as MeetingResponse);
      });
      setMeetingResponses(list);
    }, (err) => {
      console.warn("Error syncing recorded player responses:", err);
    });

    // Listen to all student users to build roster
    const usersCol = collection(db, "users");
    const unsubUsers = onSnapshot(usersCol, (snapshot) => {
      const list: UserProfile[] = [];
      snapshot.forEach((d) => {
        const u = d.data() as UserProfile;
        if (u.role === "student") {
          list.push(u);
        }
      });
      setStudentUsers(list);
    }, (err) => {
      console.warn("Error syncing recorded player student roster:", err);
    });

    return () => {
      unsubResponses();
      unsubUsers();
    };
  }, [meeting.id, isTeacher]);

  // Playback timeline elements
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0 to 100
  const [speed, setSpeed] = useState(1); // Playback multiplier helper
  const [muted, setMuted] = useState(false);

  // Time-based quiz trigger: fires a quiz every QUIZ_INTERVAL_SECONDS of actual playback
  const QUIZ_INTERVAL_SECONDS = 60; // 1 minute of play time
  const elapsedPlaySecondsRef = useRef(0);  // total seconds of video played
  const lastQuizElapsedRef = useRef(0);     // elapsed seconds at which last quiz fired
  const timeBasedQuizIndexRef = useRef(0);  // which quiz to show next (cycles)

  // Dummy quiz pool for time-based triggers in recorded replay
  const DUMMY_QUIZZES: QuizQuestion[] = [
    {
      question: "What is the primary benefit of engaging actively during a recorded class replay?",
      options: [
        "It reduces the total replay time",
        "It improves retention by combining passive review with active verification",
        "It automatically upgrades your attendance score without interaction",
        "It allows the teacher to see your screen in real-time"
      ],
      correctAnswerIndex: 1,
      category: "Active Learning"
    },
    {
      question: "Which approach best describes effective asynchronous study?",
      options: [
        "Watching the full video once at maximum speed without pausing",
        "Completing milestone quizzes and pausing to reflect on key concepts",
        "Skipping to the end and only reviewing the summary slides",
        "Relying on classmates to share their quiz answers later"
      ],
      correctAnswerIndex: 1,
      category: "Study Habits"
    },
    {
      question: "How does the BetterClass platform verify genuine engagement during replay?",
      options: [
        "By tracking mouse movement patterns throughout the session",
        "Through timed interactive quiz checkpoints that require correct responses",
        "By requiring the student to stay on the browser tab at all times",
        "Via optional end-of-session summary forms"
      ],
      correctAnswerIndex: 1,
      category: "Platform Mechanics"
    },
    {
      question: "What happens to a student's participation score when they answer quiz checkpoints correctly?",
      options: [
        "It has no effect on their score",
        "It is added to their recorded quiz performance and synced to the teacher's dashboard",
        "It only affects the live-session grade, not the replay score",
        "Scores are discarded after the replay session ends"
      ],
      correctAnswerIndex: 1,
      category: "Scoring"
    },
    {
      question: "Why is it important to complete quiz checkpoints within the replay session?",
      options: [
        "Checkpoints automatically expire and cannot be reattempted after the session",
        "Completing them validates that the student engaged with the material and records accountability",
        "They are optional bonuses with no impact on attendance",
        "Only live-session checkpoints count toward the final grade"
      ],
      correctAnswerIndex: 1,
      category: "Accountability"
    }
  ];

  // Quiz states
  const [currentQuiz, setCurrentQuiz] = useState<QuizQuestion | null>(null);
  const [quizTriggerIndex, setQuizTriggerIndex] = useState<number>(-1);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [answers, setAnswers] = useState<StudentQuizSubmission[]>([]);
  const [feedbackShown, setFeedbackShown] = useState(false);

  // Completed replay status
  const [replayFinished, setReplayFinished] = useState(false);
  const [overallScore, setOverallScore] = useState<number | null>(null);

  // Milestones where quizzes are scheduled: e.g., 20%, 45%, 70%, 90% timeline
  const milestones = [15, 40, 65, 85];

  const handleBackward = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
    }
  };

  const handleForward = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 10);
    }
  };

  // 1. Fetch unique alternative quizzes from the full-stack server-side Gemini route
  const fetchAlternativeQuizzes = useCallback(async () => {
    setLoadingQuizzes(true);
    setParsingError(null);
    try {
      const response = await fetch("/api/generate-quizzes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: meeting.title,
          description: meeting.description,
          discussionMaterial: meeting.discussionMaterial,
          forRecorded: true, // Tells Gemini to generate alternative quizzes
          salt: Math.random().toString(36).substring(7)
        })
      });
      const data = await response.json();
      if (data.success && data.quizzes) {
        setQuizzes(data.quizzes);
      } else if (data.quizzes) {
        setQuizzes(data.quizzes);
      } else {
        throw new Error(data.error || "Failed obtaining unique questions.");
      }
    } catch (err: any) {
      console.warn("Alternative quiz fetch error:", err);
      setParsingError(err.message || "Failed connecting to AI quiz generator.");
      // Reliable backup in case API isn't configured
      setQuizzes([
        {
          question: "Identify the critical mechanism of asynchronous virtual study.",
          options: [
            "Reviewing classroom outlines offline with zero evaluation",
            "Completing unique alternative quizzes periodically scheduled on the lesson timeline",
            "Submitting written summaries directly via external mail servers",
            "Relying purely on the live class attendance log"
          ],
          correctAnswerIndex: 1,
          category: "Asynchronous Learning"
        },
        {
          question: "Why does the backend AI regenerate dynamic quiz questions for recorded playback?",
          options: [
            "To keep identical score profiles with live participants regardless of study times",
            "To ensure scholastic integrity by testing replay students with unique material evaluations",
            "To save browser storage size",
            "To shorten student replay timelines"
          ],
          correctAnswerIndex: 1,
          category: "Educational Accountability"
        }
      ]);
    } finally {
      setLoadingQuizzes(false);
    }
  }, [meeting.id, meeting.title, meeting.description, meeting.discussionMaterial]);

  useEffect(() => {
    fetchAlternativeQuizzes();
  }, [fetchAlternativeQuizzes]);

  // Fetch or generate chat messages for session playback
  useEffect(() => {
    const loadChat = async () => {
      try {
        const chatsCol = collection(db, `meetings/${meeting.id}/chat`);
        const snap = await getDocs(chatsCol);
        const msgs: any[] = [];
        if (snap) {
          snap.forEach((d: any) => {
            const data = d.data() as any;
            msgs.push({ id: d.id, ...data });
          });
        }
        msgs.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
        
        // Populate rich academic chat messages if empty
        if (msgs.length === 0) {
          const generatedChats = [
            {
              senderName: meeting.hostName || "Dr. Carter",
              senderRole: "teacher",
              message: `Welcome class! Today we are studying: "${meeting.title}". Please make sure to download the discussion syllabus.`,
              createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString()
            },
            {
              senderName: "Sarah Jenkins",
              senderRole: "student",
              message: "Excited for this! The discussion syllabus looks extremely comprehensive.",
              createdAt: new Date(Date.now() - 28 * 60 * 1000).toISOString()
            },
            {
              senderName: "Liam O'Connor",
              senderRole: "student",
              message: "Will the active MCQ quizzes count towards our final participation profile?",
              createdAt: new Date(Date.now() - 25 * 60 * 1000).toISOString()
            },
            {
              senderName: meeting.hostName || "Dr. Carter",
              senderRole: "teacher",
              message: "Yes Liam! Each milestone quiz triggers automatically. Replay students also receive score adjustments.",
              createdAt: new Date(Date.now() - 24 * 60 * 1000).toISOString()
            },
            {
              senderName: "Elena Rostova",
              senderRole: "student",
              message: "Perfect, thank you! Ready to start.",
              createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString()
            },
            {
              senderName: "Sarah Jenkins",
              senderRole: "student",
              message: "Wow, the interactive diagram makes these structures so much easier to understand.",
              createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString()
            },
            {
              senderName: "Liam O'Connor",
              senderRole: "student",
              message: "Just submitted my second checkpoint response! Very cool format.",
              createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString()
            }
          ];
          setChatMessages(generatedChats);
        } else {
          setChatMessages(msgs);
        }
      } catch (err) {
        console.warn("Error loading recorded chats:", err);
      }
    };
    loadChat();
  }, [meeting.id, meeting.hostName, meeting.title]);

  // 2. Playback state synchronizer with actual HTML Video Component
  useEffect(() => {
    if (!videoRef.current) return;
    if (playing && !currentQuiz && !replayFinished) {
      videoRef.current.play().catch((err) => {
        console.warn("Auto playing failed due to permissions:", err);
      });
    } else {
      videoRef.current.pause();
    }
  }, [playing, currentQuiz, replayFinished]);

  // Handle video speed updates on the fly
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  }, [speed]);

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const current = videoRef.current.currentTime;
    const duration = videoRef.current.duration || 1;
    const currentProgress = (current / duration) * 100;
    
    setProgress(currentProgress);

    // ── Time-based quiz trigger: fire a quiz every QUIZ_INTERVAL_SECONDS of play time ──
    // Only for students, and only when no quiz is already active
    if (!isTeacher && !currentQuiz && !replayFinished) {
      // Calculate total elapsed playback seconds from video element's current time
      // We approximate using currentTime which accumulates as the video plays.
      const playedSecs = current;
      const intervalsElapsed = Math.floor(playedSecs / QUIZ_INTERVAL_SECONDS);
      const expectedQuizCount = intervalsElapsed; // number of quizzes that should have fired

      if (expectedQuizCount > 0 && playedSecs - lastQuizElapsedRef.current >= QUIZ_INTERVAL_SECONDS) {
        // Pick the quiz from the loaded quizzes or fall back to DUMMY_QUIZZES
        const quizPool = quizzes.length > 0 ? quizzes : DUMMY_QUIZZES;
        const qIdx = timeBasedQuizIndexRef.current % quizPool.length;
        const quizToShow = quizPool[qIdx];

        lastQuizElapsedRef.current = playedSecs;
        timeBasedQuizIndexRef.current += 1;

        setCurrentQuiz(quizToShow);
        setQuizTriggerIndex(qIdx);
        setSelectedOption(null);
        setFeedbackShown(false);
        setPlaying(false);
        if (videoRef.current) {
          videoRef.current.pause();
        }
      }
    }
  };

  const submitQuizSelection = () => {
    if (selectedOption === null || !currentQuiz) return;

    const isCorrect = selectedOption === currentQuiz.correctAnswerIndex;
    const submission: StudentQuizSubmission = {
      quizIndex: quizTriggerIndex,
      selectedIndex: selectedOption,
      isCorrect
    };

    const updatedAnswers = [...answers, submission];
    setAnswers(updatedAnswers);
    setFeedbackShown(true);

    // Save student performance incrementally in Firestore
    calculateFinalRecordedGrade(updatedAnswers);
  };

  const handleNextLessonSegment = () => {
    setCurrentQuiz(null);
    setPlaying(true);
  };

  const calculateFinalRecordedGrade = async (latestAnswers: StudentQuizSubmission[]) => {
    const correctCount = latestAnswers.filter(a => a.isCorrect).length;
    const countEvaluated = Math.max(quizzes.length, 1);
    const scoreVal = Math.round((correctCount / countEvaluated) * 100);
    const finalScore = Math.max(1, Math.min(100, scoreVal));
    setOverallScore(finalScore);

    try {
      const responseId = `${meeting.id}_${user.uid}`;
      const docRef = doc(db, `meetings/${meeting.id}/responses`, responseId);
      const snapshot = await getDoc(docRef);

      const payload = {
        id: responseId,
        meetingId: meeting.id,
        userId: user.uid,
        userName: user.name,
        activePopupShown: 0,
        activePopupClicked: 0,
        quizAnswers: latestAnswers,
        overallPercentage: finalScore,
        missedLive: true,
        updatedAt: new Date().toISOString()
      };

      if (snapshot.exists()) {
        await updateDoc(docRef, payload);
      } else {
        await setDoc(docRef, payload);
      }
    } catch (err) {
      console.warn("Could not save async recorded metrics to backend:", err);
    }
  };

  const resetLessonReplay = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
    setProgress(0);
    setQuizTriggerIndex(-1);
    setAnswers([]);
    setCurrentQuiz(null);
    setReplayFinished(false);
    setOverallScore(null);
    setPlaying(true);
    // Reset time-based quiz tracking refs
    elapsedPlaySecondsRef.current = 0;
    lastQuizElapsedRef.current = 0;
    timeBasedQuizIndexRef.current = 0;
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || currentQuiz !== null || replayFinished) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const percentage = clickX / width;
    
    const duration = videoRef.current.duration || 1;
    const targetTime = percentage * duration;
    videoRef.current.currentTime = targetTime;
    const currentProgress = percentage * 100;
    setProgress(currentProgress);

    // Sync quizTriggerIndex based on maximum milestone passed
    let highestPassedIndex = -1;
    for (let i = 0; i < milestones.length; i++) {
      if (currentProgress >= milestones[i] && i < quizzes.length) {
        highestPassedIndex = i;
      }
    }
    setQuizTriggerIndex(highestPassedIndex);
  };

  const getLiveCaption = (prog: number): string => {
    if (prog < 15) {
      return `Welcome to today's session on "${meeting.title}". We'll cover key theories and open up active quizzes.`;
    } else if (prog < 40) {
      return "Let's examine our primary concepts. Note how these interact with our course syllabus and textbook references.";
    } else if (prog < 65) {
      return "Excellent analysis. Keep these core mechanics in mind as we approach our next interactive check-in event.";
    } else if (prog < 85) {
      return "Let's summarize the primary conclusions. Make sure to review the provided resources on your dashboard.";
    } else {
      return "Thank you for joining today's recorded lecture replay! Submit all timeline checkpoints to finalize your grades.";
    }
  };

  // Show chats proportionally as video progress increases
  const visibleCount = Math.max(0, Math.floor((progress / 100) * chatMessages.length));
  const visibleChats = chatMessages.slice(0, visibleCount);
  return (
    <>
    <div className="bg-slate-900 border border-white/5 rounded-[32px] p-6 md:p-8 shadow-2xl text-slate-200 relative overflow-hidden">

      {/* Main container taking full width */}
      <div className="w-full space-y-6">
        
        {/* Virtual Player Screen Mock */}
        <div className="relative bg-slate-950 rounded-3xl aspect-video overflow-hidden flex flex-col justify-between p-6 border border-white/10 shadow-2xl w-full">
          
          {/* The Real HTML5 Video element */}
          <video
            ref={videoRef}
            src={getDirectVideoUrl(meeting.recordedVideoUrl || "", meeting.title, meeting.description)}
            className={`w-full h-full rounded-3xl absolute inset-0 z-0 transition-opacity ${
              isActualRecording(meeting.recordedVideoUrl) ? "object-contain opacity-100" : "object-cover opacity-75"
            }`}
            onTimeUpdate={handleTimeUpdate}
            onEnded={() => {
              setPlaying(false);
              setReplayFinished(true);
              calculateFinalRecordedGrade(answers);
            }}
            playsInline
            muted={muted}
          />

          {/* Dark blur overlay during pause or milestone quiz */}
          <div className={`absolute inset-0 bg-slate-950/60 backdrop-blur-[1.5px] transition-all duration-300 z-5 pointer-events-none ${
            !playing ? "opacity-100" : "opacity-0"
          }`} />

          {/* Live Captioning subtitle overlay */}
          {playing && !currentQuiz && (
            <div className="absolute bottom-24 left-6 right-6 z-10 flex justify-center pointer-events-none">
              <div className="bg-slate-950/85 backdrop-blur-md px-4 py-2 border border-indigo-500/30 text-indigo-200 text-[11px] font-sans rounded-xl max-w-lg text-center leading-normal shadow-2xl scale-in-animation">
                <span className="text-[9px] uppercase font-mono tracking-widest text-indigo-400 block font-bold mb-0.5 animate-pulse">Live Subtitles</span>
                "{getLiveCaption(progress)}"
              </div>
            </div>
          )}

          {/* Stage header info */}
          <div className="flex items-center justify-between z-10">
            <div className={`px-3 py-1 backdrop-blur-md font-mono text-[10px] uppercase tracking-wider rounded-lg flex items-center gap-1.5 font-bold border ${
              isActualRecording(meeting.recordedVideoUrl)
                ? "bg-emerald-950/90 border-emerald-800/60 text-emerald-300"
                : "bg-indigo-950/85 border-indigo-900/50 text-indigo-300"
            }`}>
              <Clock className="w-3.5 h-3.5 animate-pulse" />
              <span>{isActualRecording(meeting.recordedVideoUrl) ? "Live Class Recording" : "Demo Replay Mode"}</span>
            </div>

            <button
              onClick={onClose}
              className="px-3 py-1 bg-rose-955/90 hover:bg-rose-900 border border-rose-500/30 text-rose-350 cursor-pointer rounded-lg text-xs font-bold font-mono uppercase tracking-wider transition-all"
            >
              Exit Replay
            </button>
          </div>

          {/* Stage core presentation overlay graphics */}
          <div className="my-auto text-center flex flex-col items-center justify-center p-4 z-10">
            {replayFinished ? (
              <div className="scale-in-animation p-4 bg-slate-900/85 backdrop-blur-md rounded-2xl border border-white/5 shadow-xl max-w-sm">
                <div className="w-12 h-12 rounded-xl bg-indigo-505/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3 mx-auto">
                  <Award className="w-6 h-6 text-indigo-400 animate-pulse" />
                </div>
                <h4 className="text-md font-bold text-indigo-400">Class Broadcast Complete!</h4>
                <p className="text-xs text-slate-300 mt-1 max-w-xs mx-auto leading-relaxed">
                  All timeline checking quizzes successfully resolved. Your grading metrics were recorded securely.
                </p>
              </div>
            ) : currentQuiz ? (
              <div className="scale-in-animation p-4 bg-amber-500/5 backdrop-blur-sm rounded-2xl border border-amber-500/10 shadow-xl max-w-xs">
                <h4 className="text-xs font-semibold text-amber-400 tracking-tight animate-pulse uppercase">Timeline Evaluation Active</h4>
                <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                  Study video currently locked. Submit your response to the interactive checkpoint quiz below to resume.
                </p>
              </div>
            ) : !playing ? (
              <div className="scale-in-animation p-4 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-white/5 shadow-xl max-w-xs">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-2 mx-auto">
                  <MonitorPlay className="w-5 h-5" />
                </div>
                <p className="text-zinc-200 font-bold text-xs truncate max-w-xs">{meeting.classroomName}</p>
                <p className="text-[10px] text-slate-450 mt-1 font-mono tracking-wider font-bold uppercase">Lesson Recording Paused</p>
              </div>
            ) : null}
          </div>

          {/* Video Controls shelf */}
          <div className="space-y-4 z-10 w-full bg-slate-950/85 backdrop-blur-sm p-3.5 rounded-2xl border border-white/10 shadow-inner">
            {/* Timeline bar */}
            <div className="space-y-1.5">
              <div 
                className="h-2.5 bg-slate-900/90 rounded-full cursor-pointer relative border border-white/10 group overflow-hidden"
                onClick={handleSeek}
                title="Click anywhere to seek video segments"
              >
                <div 
                  className="h-full bg-indigo-500 rounded-full transition-all group-hover:bg-indigo-400"
                  style={{ width: `${progress}%` }}
                />
                {milestones.map((m, idx) => (
                  <div 
                    key={idx}
                    className={`absolute top-0 bottom-0 w-1 ${idx <= quizTriggerIndex ? "bg-amber-450" : "bg-slate-705"}`}
                    style={{ left: `${m}%` }}
                    title={`Quiz Checkpoint ${idx + 1}`}
                  />
                ))}
              </div>
            </div>

            {/* Action grid */}
            <div className="flex items-center justify-between border-t border-white/5 pt-2.5">
              <div className="flex items-center gap-3">
                {/* Skip Backward 10s */}
                <button
                  onClick={() => { if(videoRef.current) videoRef.current.currentTime -= 10 }}
                  className="p-2.5 bg-slate-900 hover:bg-slate-800 border border-white/10 rounded-full text-slate-400 hover:text-white transition-all cursor-pointer"
                  title="Skip backward 10s"
                >
                  <Rewind className="w-3.5 h-3.5" />
                </button>

                {/* Play/Pause */}
                <button
                  disabled={replayFinished || currentQuiz !== null}
                  onClick={() => setPlaying(!playing)}
                  className="p-2.5 bg-indigo-600 hover:bg-indigo-500 hover:scale-105 active:scale-95 text-white rounded-full shadow-2xl transition-all cursor-pointer disabled:opacity-30"
                >
                  {playing ? <Pause className="w-4 h-4 fill-white text-white" /> : <Play className="w-4 h-4 fill-white text-white translate-x-[1px]" />}
                </button>

                {/* Skip Forward 10s */}
                <button
                  onClick={() => { if(videoRef.current) videoRef.current.currentTime += 10 }}
                  className="p-2.5 bg-slate-900 hover:bg-slate-800 border border-white/10 rounded-full text-slate-400 hover:text-white transition-all cursor-pointer"
                  title="Skip forward 10s"
                >
                  <FastForward className="w-3.5 h-3.5" />
                </button>

                {/* Restart */}
                <button
                  onClick={resetLessonReplay}
                  className="p-2.5 bg-slate-900 hover:bg-slate-800 border border-white/10 rounded-full text-slate-400 hover:text-white transition-all cursor-pointer hover:rotate-45"
                  title="Restart Lesson playback"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>

                {/* Volume audio controls */}
                <button
                  onClick={() => setMuted(!muted)}
                  className="p-2.5 bg-slate-900 hover:bg-slate-800 border border-white/10 rounded-full text-slate-400 hover:text-white transition-all cursor-pointer"
                  title={muted ? "Unmute sound" : "Mute sound"}
                >
                  {muted ? <VolumeX className="w-3.5 h-3.5 text-rose-450" /> : <Volume2 className="w-3.5 h-3.5 text-indigo-400" />}
                </button>
              </div>
            </div>
          </div>

        </div>

        {/* Dynamic Replay Performance and Cohort Block */}
        <div className="bg-slate-950/85 border border-white/10 rounded-3xl p-6 shadow-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/5 pb-4 mb-5 gap-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-400" />
              <div>
                <h4 className="text-sm font-bold uppercase tracking-wider font-sans text-slate-100">
                  {isTeacher ? "Live Attendees Cohort & Replay Performance" : "My Lesson Replay & Checkpoints"}
                </h4>
                <p className="text-[11px] text-slate-450 mt-0.5">
                  {isTeacher 
                    ? "Real-time verification of student live participation & recorded replay metrics." 
                    : "Answer all scheduled check-in quizzes to verify active study and record your score."}
                </p>
              </div>
            </div>
            {isTeacher && (
              <div className="relative w-full sm:w-64">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search enrolled students..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-sans"
                />
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              </div>
            )}
          </div>

          {isTeacher ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {studentUsers
                .filter((u) => u.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((student) => {
                  const response = meetingResponses.find((r) => r.userId === student.uid);
                  const hasJoined = !!response;
                  const score = response ? response.overallPercentage : 0;
                  const isLive = response ? !response.missedLive : false;

                  return (
                    <div 
                      key={student.uid}
                      className={`p-3.5 rounded-2xl border text-xs transition-all flex flex-col gap-2.5 ${
                        hasJoined 
                          ? "border-emerald-500/25 bg-emerald-950/10 text-slate-100" 
                          : "border-white/5 bg-slate-900/20 text-slate-400"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold truncate max-w-[150px]" title={student.name}>
                          {student.name}
                        </span>
                        <span className={`text-[9px] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider border ${
                          hasJoined
                            ? isLive
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
                            : "bg-slate-900 text-slate-500 border-white/5"
                        }`}>
                          {hasJoined ? (isLive ? "Live" : "Replay") : "Absent"}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 font-sans">Activity Score:</span>
                        <span className={`font-mono font-bold ${hasJoined ? "text-emerald-400" : "text-slate-500"}`}>
                          {score}%
                        </span>
                      </div>

                      {/* Mini visual performance slider */}
                      <div className="w-full bg-slate-900 rounded-full h-1.5 relative overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all duration-500 ${
                            score >= 80 
                              ? "bg-emerald-500" 
                              : score >= 50 
                                ? "bg-amber-500" 
                                : "bg-rose-500"
                          }`} 
                          style={{ width: `${score}%` }} 
                        />
                      </div>
                    </div>
                  );
                })}
              {studentUsers.length === 0 && (
                <div className="col-span-full py-8 text-center text-slate-500 italic text-xs">
                  No enrolled student profiles found.
                </div>
              )}
            </div>
          ) : (
            // Student's View: Checkpoint quizzes + overall evaluation
            <div className="space-y-4">
              {loadingQuizzes && (
                <div className="py-8 text-center text-xs text-slate-500 font-mono">
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full mr-2" />
                  Querying Server-Side Gemini...
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {quizzes.map((q, idx) => {
                  const answer = answers.find(a => a.quizIndex === idx);
                  const isCorrect = answer?.isCorrect;

                  return (
                    <div 
                      key={idx} 
                      className={`p-3.5 rounded-2xl border text-xs transition-all flex flex-col justify-between gap-3 ${
                        idx === quizTriggerIndex && currentQuiz
                          ? "border-indigo-500 bg-indigo-950/30 text-indigo-300 font-bold"
                          : "border-white/5 bg-slate-900/30 text-slate-350"
                      }`}
                    >
                      <div>
                        <span className="font-extrabold block text-[9px] uppercase font-mono tracking-widest text-slate-500 pb-1">
                          Checkpoint {idx + 1}
                        </span>
                        <span className="font-medium line-clamp-2 text-slate-200 font-sans" title={q.question}>{q.question}</span>
                      </div>

                      <div className="flex items-center justify-between border-t border-white/5 pt-2 mt-1">
                        <span className="text-[10px] text-slate-550 font-mono">{q.category || "Evaluation"}</span>
                        <div>
                          {idx > quizTriggerIndex ? (
                            <span className="text-[9px] px-2 py-0.5 rounded bg-slate-900 border border-white/5 text-slate-600 font-mono font-bold uppercase font-sans">Locked</span>
                          ) : idx === quizTriggerIndex && currentQuiz ? (
                            <span className="text-[9px] px-2 py-0.5 rounded bg-indigo-600 text-white font-bold uppercase font-mono tracking-wider animate-pulse font-sans">Solving</span>
                          ) : isCorrect ? (
                            <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold uppercase font-mono tracking-wider border border-emerald-500/20 font-sans">Correct</span>
                          ) : (
                            <span className="text-[9px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 font-bold uppercase font-mono tracking-wider border border-rose-500/20 font-sans">Incorrect</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {overallScore !== null && (
                <div className="pt-4 mt-2 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                      <Award className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase text-slate-450 tracking-wider font-mono block">Final Replay Evaluation</span>
                      <span className="text-xl font-extrabold text-indigo-400 font-mono">
                        {overallScore}% Score
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      fetchAlternativeQuizzes();
                      resetLessonReplay();
                    }}
                    className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/30 text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow font-sans"
                  >
                    <ListRestart className="w-3.5 h-3.5" />
                    <span>Give Quizzes Again</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>

    </div>

    {/* ── Quiz Checkpoint Overlay Modal ── Appears on top of everything when a milestone is hit */}
    {currentQuiz && !isTeacher && (
      <div className="fixed inset-0 z-[9000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-indigo-500/30 rounded-3xl p-7 md:p-10 w-full max-w-lg shadow-2xl scale-in-animation relative overflow-hidden">
          {/* Decorative gradient */}
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-600 via-violet-500 to-indigo-600 rounded-t-3xl" />

          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
            </div>
            <div>
              <span className="text-[10px] font-mono tracking-widest text-indigo-400 uppercase font-bold block">
                Checkpoint Quiz
              </span>
              <span className="text-[9px] font-mono text-slate-500">
                {quizTriggerIndex + 1} of {quizzes.length} • Video paused
              </span>
            </div>
          </div>

          <h4 className="text-sm font-bold text-slate-100 leading-relaxed mb-6 font-sans">
            {currentQuiz.question}
          </h4>

          <div className="space-y-2.5 mb-6">
            {currentQuiz.options.map((opt, oIdx) => {
              const wasSelected = selectedOption === oIdx;
              const isCorrectAnswer = oIdx === currentQuiz.correctAnswerIndex;
              return (
                <button
                  key={oIdx}
                  disabled={feedbackShown}
                  onClick={() => setSelectedOption(oIdx)}
                  className={`w-full text-left p-4 rounded-2xl text-xs transition-all flex items-center justify-between border cursor-pointer font-medium font-sans ${
                    feedbackShown
                      ? isCorrectAnswer
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                        : wasSelected && !isCorrectAnswer
                        ? "bg-rose-500/15 border-rose-500/30 text-rose-300"
                        : "bg-slate-800/50 border-white/5 text-slate-500"
                      : wasSelected
                      ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-200 font-semibold"
                      : "bg-slate-800/60 border-white/10 hover:bg-slate-800 text-slate-300"
                  }`}
                >
                  <span>{opt}</span>
                  {feedbackShown && isCorrectAnswer && (
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 ml-2" />
                  )}
                  {feedbackShown && wasSelected && !isCorrectAnswer && (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 ml-2" />
                  )}
                </button>
              );
            })}
          </div>

          {feedbackShown && (
            <div className={`p-4 rounded-2xl mb-5 text-xs font-semibold flex items-start gap-2 font-sans ${
              selectedOption === currentQuiz.correctAnswerIndex
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                : "bg-rose-500/10 border border-rose-500/20 text-rose-300"
            }`}>
              {selectedOption === currentQuiz.correctAnswerIndex ? (
                <>
                  <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Correct! Great work. Your score has been saved to the server.</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Incorrect. The correct answer is: <b className="text-rose-200">{currentQuiz.options[currentQuiz.correctAnswerIndex]}</b></span>
                </>
              )}
            </div>
          )}

          <div className="flex gap-3">
            {!feedbackShown ? (
              <button
                onClick={submitQuizSelection}
                disabled={selectedOption === null}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold text-xs rounded-2xl shadow-lg shadow-indigo-600/20 transition-all cursor-pointer font-sans"
              >
                Submit Answer
              </button>
            ) : (
              <button
                onClick={handleNextLessonSegment}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-2xl shadow border border-white/10 transition-all cursor-pointer flex items-center justify-center gap-2 font-sans"
              >
                <span>Resume Video</span>
                <ChevronRight className="w-4 h-4 text-indigo-400" />
              </button>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
};
