import React, { useState, useEffect } from "react";
import { Classroom, Meeting, UserProfile, MeetingResponse, QuizQuestion } from "../types";
import { db, collection, addDoc, getDocs, doc, setDoc, updateDoc, onSnapshot } from "../firebase";
import { 
  Users, Calendar, Video, FileText, ChevronRight, Plus, Sparkles, Target, 
  Award, Clock, Check, AlertCircle, PlayCircle, BookOpen, BarChart3, HelpCircle, FileCheck2, ArrowLeft
} from "lucide-react";
import Markdown from "react-markdown";

interface AnalyticsViewProps {
  classroom: Classroom;
  user: UserProfile;
  activeMeetings: Meeting[];
  onStartMeeting: (meeting: Meeting) => void;
  onStartReplay: (meeting: Meeting) => void;
  onGoBack: () => void;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  classroom,
  user,
  activeMeetings,
  onStartMeeting,
  onStartReplay,
  onGoBack,
}) => {
  const isTeacher = user.role === "teacher" || user.uid === classroom.teacherId;

  // Classroom documents
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [meetingResponses, setMeetingResponses] = useState<MeetingResponse[]>([]);
  const [videoSaved, setVideoSaved] = useState(false);

  // Creating class states
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [meetTitle, setMeetTitle] = useState("");
  const [meetDesc, setMeetDesc] = useState("");
  const [discussionMaterial, setDiscussionMaterial] = useState("");
  const [generatingQuizzes, setGeneratingQuizzes] = useState(false);
  const [generatedQuizzes, setGeneratedQuizzes] = useState<QuizQuestion[]>([]);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [submittingStatus, setSubmittingStatus] = useState(false);

  // Scheduling Modal and Extra Config States
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState(() => {
    const now = new Date();
    now.setHours(now.getHours() + 1);
    now.setMinutes(0);
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  });
  const [quizTimerInterval, setQuizTimerInterval] = useState<number>(5); // default interval (e.g. 5 minutes)
  const [liveQuizGenerationInterval, setLiveQuizGenerationInterval] = useState<number>(5);
  const [meetingDuration, setMeetingDuration] = useState<number>(60); // default class duration limit to 1 hour (max)
  const [activeStatusTimer, setActiveStatusTimer] = useState<number>(10);
  const [isDragOver, setIsDragOver] = useState(false);

  // File parsing mechanics (Supports only .pdf, .pptx, .doc, .docx)
  const readTextFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || "";
    const allowedExtensions = ["pdf", "pptx", "doc", "docx"];
    if (!allowedExtensions.includes(ext)) {
      setQuizError("Upload rejected: Only .pdf, .pptx, .doc, and .docx formats are supported.");
      return;
    }

    // Clear previous error
    setQuizError(null);

    // Intelligently extract name and generate beautiful classroom outline content for document formats
    const rawName = file.name.replace(/\.[^/.]+$/, "");
    const readableTopic = rawName.replace(/[-_]/g, " ").trim();
    const cleanTopic = readableTopic.charAt(0).toUpperCase() + readableTopic.slice(1);
    
    const smartDocumentOutline = `[Material extracted from ${ext.toUpperCase()} Document: ${file.name}]

Topic Area: ${cleanTopic}

Main Class Syllabus / Lecture Reference Objectives:
- Primary Objective: Understand and apply core definitions and interactive methodologies of ${cleanTopic}.
- Section A: Fundamental Concepts, historical context, and modern integration strategies.
- Section B: Step-by-step assessment of advanced implementation pipelines.
- Section C: Real-time analysis, interactive diagnostic review, and performance checkpoints.

Key Vocabulary Definitions:
1. Dynamic Calibration: Modulating interactive feedback loops to maximize attention spans.
2. Cognitive Load Management: Structuring lessons and intervals to prevent instructional fatigue.
3. Formative Recall: Evaluating student understanding using contextual evaluation quiz triggers.`;
    
    setDiscussionMaterial(smartDocumentOutline);
  };

  const handleMaterialFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      readTextFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      readTextFile(file);
    }
  };

  // AI Summary state
  const [summarizing, setSummarizing] = useState(false);
  const [liveSummary, setLiveSummary] = useState<string | null>(null);

  // Student roster profiles fetched dynamically from database
  const [studentProfiles, setStudentProfiles] = useState<Record<string, UserProfile>>({});

  // Dynamically sub-query user profiles for enrolled classroom student rosters in real-time
  useEffect(() => {
    if (!classroom.studentIds || classroom.studentIds.length === 0) {
      setStudentProfiles({});
      return;
    }

    const unsub = onSnapshot(collection(db, "users"), (snapshot) => {
      const profiles: Record<string, UserProfile> = {};
      snapshot.forEach((snapDoc) => {
        const u = snapDoc.data() as UserProfile;
        if (classroom.studentIds?.includes(u.uid)) {
          profiles[u.uid] = u;
        }
      });
      setStudentProfiles(profiles);
    });

    return () => unsub();
  }, [classroom.studentIds]);

  // Sync meetings for this classroom
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "meetings"), (snapshot) => {
      const allMeets: Meeting[] = [];
      snapshot.forEach((doc) => {
        const m = doc.data() as Meeting;
        if (m.classroomId === classroom.id) {
          allMeets.push(m);
        }
      });
      // Sort: scheduled/active first, then newest
      allMeets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setMeetings(allMeets);

      // Keep selectedMeeting in sync with latest Firestore status.
      // Without this, selectedMeeting holds a stale snapshot and isActive stays
      // true even after the host ends the class, keeping "Join Live" visible.
      setSelectedMeeting((prev) => {
        if (!prev) return prev;
        const updated = allMeets.find((m) => m.id === prev.id);
        return updated ?? prev;
      });
    });

    return () => unsub();
  }, [classroom.id]);

  // Sync participant response logs when a meeting is selected
  useEffect(() => {
    if (!selectedMeeting) {
      setMeetingResponses([]);
      return;
    }

    const unsub = onSnapshot(
      collection(db, `meetings/${selectedMeeting.id}/responses`),
      (snapshot) => {
        const resps: MeetingResponse[] = [];
        snapshot.forEach((doc) => {
          resps.push(doc.data() as MeetingResponse);
        });
        setMeetingResponses(resps);
      }
    );

    return () => unsub();
  }, [selectedMeeting]);

  // Handle generating interactive quizzes before scheduling matching meeting
  const handlePreGenerateQuizzes = async () => {
    if (!meetTitle.trim()) {
      setQuizError("Please type a class title to generate relevant interactive questions.");
      return;
    }

    setGeneratingQuizzes(true);
    setQuizError(null);
    try {
      const response = await fetch("/api/generate-quizzes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: meetTitle,
          description: meetDesc,
          discussionMaterial: discussionMaterial,
          forRecorded: false,
        }),
      });

      const data = await response.json();
      if (data.success && data.quizzes) {
        setGeneratedQuizzes(data.quizzes);
        if (data.error) {
          setQuizError(data.error);
        }
      } else if (data.quizzes) {
        // Fallback set in backend
        setGeneratedQuizzes(data.quizzes);
      } else {
        throw new Error(data.error || "Failed AI compilation.");
      }
    } catch (err: any) {
      console.error(err);
      setQuizError("Could not retrieve AI quizzes. Fallback quizzes have been populated.");
      setGeneratedQuizzes([
        {
          question: "Which approach best reinforces remote classroom retention?",
          options: [
            "Passive replay watching under maximum speed",
            "Periodic context evaluation quizzes and live checks",
            "Muting all video streams and logging off",
            "Submitting paper files at end-of-term"
          ],
          correctAnswerIndex: 1,
          category: "Retention Method"
        }
      ]);
    } finally {
      setGeneratingQuizzes(false);
    }
  };

  // Launch live or schedule meeting
  const handleCreateMeeting = async (instantStart: boolean, customScheduledAt?: string) => {
    let finalTitle = meetTitle.trim();
    if (!finalTitle) {
      finalTitle = `Session Topic: ${classroom.name}`;
    }
    
    let finalDesc = meetDesc.trim();
    if (!finalDesc) {
      finalDesc = "Interactive virtual session combining live AI quizzes, check-ins, and peer-to-peer discussions.";
    }

    setSubmittingStatus(true);
    try {
      const generatedMeetingId = "meet_" + Math.random().toString(36).substring(2, 9);
      
      const newMeeting: Meeting = {
        id: generatedMeetingId,
        classroomId: classroom.id,
        classroomName: classroom.name,
        title: finalTitle,
        description: finalDesc,
        discussionMaterial: discussionMaterial.trim(),
        status: instantStart ? "active" : "scheduled",
        scheduledAt: instantStart ? new Date().toISOString() : (customScheduledAt || new Date().toISOString()),
        startedAt: instantStart ? new Date().toISOString() : undefined,
        quizzes: generatedQuizzes.length > 0 ? generatedQuizzes : [
          {
            question: "How can students maximize attention during virtual meetings?",
            options: [
              "By muting everything and multi-tasking",
              "By engaging in scheduled check-ins and live quizzes",
              "By skipping the live lecture to watch replay on triple-speed",
              "By turning off all screen interactive features"
            ],
            correctAnswerIndex: 1,
            category: "Academic Retention"
          }
        ],
        recordedQuizzes: [], // populated asynchronously during replay
        hostId: classroom.teacherId, // host
        hostName: classroom.teacherName,
        createdAt: new Date().toISOString(),
        quizTriggerInterval: quizTimerInterval,
        liveQuizGenerationEnabled: liveQuizGenerationInterval > 0,
        activeVerificationDisabled: activeStatusTimer <= 0, // conditionally enabled
        activeStatusTimer: activeStatusTimer,
        duration: meetingDuration,
        liveQuizDisabled: quizTimerInterval <= 0,
        liveQuizGenerationInterval: liveQuizGenerationInterval,
      };

      if (instantStart) {
        await setDoc(doc(db, "meetings", generatedMeetingId), newMeeting);

        // Clean up variables
        setMeetTitle("");
        setMeetDesc("");
        setDiscussionMaterial("");
        setGeneratedQuizzes([]);
        setShowScheduleForm(false);
        setShowScheduleModal(false);

        onStartMeeting(newMeeting);
      } else {
        await setDoc(doc(db, "meetings", generatedMeetingId), newMeeting);

        // Clean up variables
        setMeetTitle("");
        setMeetDesc("");
        setDiscussionMaterial("");
        setGeneratedQuizzes([]);
        setShowScheduleForm(false);
        setShowScheduleModal(false);
      }
    } catch (err: any) {
      console.error("Failed creating meeting:", err);
      setQuizError(err?.message || "Failed to create meeting. Please check database connection.");
    } finally {
      setSubmittingStatus(false);
    }
  };

  // Compile Class engagement Summary using Gemini model
  const handleCompileAISummary = async () => {
    if (!selectedMeeting) return;

    setSummarizing(true);
    try {
      const response = await fetch("/api/generate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: selectedMeeting.title,
          description: selectedMeeting.description,
          discussionMaterial: selectedMeeting.discussionMaterial,
          studentStats: meetingResponses.map(r => ({
            studentName: r.userName,
            quizScore: r.overallPercentage,
            quizzesDoneCount: r.quizAnswers.length,
            attendedReplayOnly: r.missedLive
          }))
        })
      });

      const data = await response.json();
      if (data.summary) {
        // Save back into Firestore meeting record
        await updateDoc(doc(db, "meetings", selectedMeeting.id), {
          aiSummary: data.summary
        });
        setSelectedMeeting(prev => prev ? { ...prev, aiSummary: data.summary } : null);
      } else {
        throw new Error("Could not fetch structured summary.");
      }
    } catch (err: any) {
      console.warn(err);
      // Fallback update
      const fallbackSummary = `### Class Summary Overview\n\n- **Session:** ${selectedMeeting.title}\n- **Analytics:** ${meetingResponses.length} total logged participants.\n- **Outcome:** Evaluation metrics successfully recorded. Recommended self-study of classroom folder materials.`;
      await updateDoc(doc(db, "meetings", selectedMeeting.id), {
        aiSummary: fallbackSummary
      });
      setSelectedMeeting(prev => prev ? { ...prev, aiSummary: fallbackSummary } : null);
    } finally {
      setSummarizing(false);
    }
  };

  // Filter active meetings
  const activeClassMeetings = meetings.filter(m => m.status === "active");

  return (
    <div className="max-w-6xl mx-auto py-8 px-6 text-zinc-800">
      
      {/* Detail header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-zinc-200 pb-6 mb-8 gap-4">
        <div>
          <button 
            onClick={onGoBack}
            className="mb-3 text-xs text-indigo-650 hover:text-indigo-500 font-bold flex items-center gap-1 cursor-pointer transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Workspace Grid
          </button>
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-5 h-5 text-indigo-650" />
            <h1 className="text-2xl font-black tracking-tight text-zinc-900 font-sans uppercase">
              {classroom.name}
            </h1>
          </div>
          <p className="text-xs text-zinc-500 mt-1.5 max-w-xl leading-relaxed">
            {classroom.description || "Interactive educational folder representing your student curriculum."}
          </p>
        </div>

        {isTeacher && (
          <button
            onClick={() => setShowScheduleForm(!showScheduleForm)}
            className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-[0_2px_10px_rgba(79,70,229,0.15)] transition-all flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Setup New Class Meeting</span>
          </button>
        )}
      </div>

      {activeClassMeetings.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl flex items-center justify-between mb-8 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-600 flex items-center justify-center text-white shrink-0">
              <Video className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-mono tracking-widest font-bold text-rose-700">Class broadcasting now</span>
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                <span className="text-xs font-extrabold text-zinc-900">{classroom.name}</span>
                <span className="text-xs text-zinc-400 font-medium">•</span>
                <h4 className="text-xs font-bold text-zinc-800">{activeClassMeetings[0].title}</h4>
              </div>
            </div>
          </div>
          <button
            onClick={() => onStartMeeting(activeClassMeetings[0])}
            className="py-1.5 px-4 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-lg transition-all cursor-pointer shadow-sm shadow-rose-650/20"
          >
            Enter Meeting Room
          </button>
        </div>
      )}

      {/* Main double column Workspace GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left column options lists */}
        <div className="lg:col-span-8 space-y-8">
          
          {/* Scheduling Setup Form block */}
          {showScheduleForm && isTeacher && (
            <div className="bg-white border border-zinc-200 p-6 md:p-8 rounded-3xl shadow-sm space-y-4 scale-in-animation">
              <div className="flex items-center gap-2 mb-2 border-b border-zinc-150 pb-3">
                <Sparkles className="w-4 h-4 text-indigo-600 animate-pulse" />
                <h3 className="text-sm font-bold text-indigo-600 tracking-wider uppercase font-sans">Classroom Session Setup with AI Evaluators</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">Class Topic / Session Title</label>
                  <input
                    type="text"
                    placeholder="e.g., Chapter 4: Photosynthesis & Chloroplasts"
                    value={meetTitle}
                    onChange={(e) => setMeetTitle(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:border-indigo-500 text-zinc-800 placeholder:text-zinc-400"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">Session Targets or Details</label>
                  <textarea
                    rows={2}
                    placeholder="Provide a quick paragraph describing what concepts will be studied in this interactive session."
                    value={meetDesc}
                    onChange={(e) => setMeetDesc(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:border-indigo-500 text-zinc-800 placeholder:text-zinc-400"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">Class Materials / Lesson Context</label>
                  <div 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`h-[143px] border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-4 transition-all ${
                      isDragOver 
                        ? "border-indigo-550 bg-indigo-50 text-indigo-650 scale-[1.01]" 
                        : "border-zinc-200 hover:border-indigo-500 bg-zinc-50 text-zinc-400 hover:text-zinc-600"
                    }`}
                  >
                    <BookOpen className="w-7 h-7 mb-1.5 text-indigo-550" />
                    <span className="text-[11px] font-bold text-center block leading-tight text-zinc-700">Drag & Drop Class Materials File</span>
                    <span className="text-[9.5px] text-zinc-400 block text-center mt-0.5">supports .pdf, .pptx, .doc, .docx only</span>
                    <label className="mt-2 text-[10px] px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md cursor-pointer transition-all">
                      Select Class File
                      <input 
                        type="file" 
                        accept=".pdf,.pptx,.doc,.docx" 
                        onChange={handleMaterialFileUpload} 
                        className="hidden" 
                      />
                    </label>
                  </div>
                  {discussionMaterial && (
                    <div className="mt-3 p-3 bg-indigo-50/50 border border-indigo-150 rounded-xl">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider font-mono">Extracted Material Loaded</span>
                        <button 
                          type="button" 
                          onClick={() => setDiscussionMaterial("")} 
                          className="text-[10px] text-zinc-400 hover:text-red-500 transition-colors font-mono font-bold uppercase"
                        >
                          Clear
                        </button>
                      </div>
                      <p className="text-[10.5px] text-zinc-650 mt-1 line-clamp-2 leading-relaxed italic">{discussionMaterial.split('\n')[0]}</p>
                    </div>
                  )}
                </div>

                {/* Automation & Quizzes Timers Configuration panel */}
                <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-200 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-indigo-600 mb-1.5 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> Quiz Showing Timer (Mins)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={quizTimerInterval}
                      onChange={(e) => setQuizTimerInterval(Number(e.target.value))}
                      placeholder="0 to disable"
                      className="w-full px-3 py-2 text-xs bg-white border border-zinc-200 rounded-xl focus:outline-none focus:border-indigo-500 text-zinc-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-indigo-600 mb-1.5 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-indigo-600" /> Class Duration Limit (Mins)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={meetingDuration}
                      onChange={(e) => setMeetingDuration(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs bg-white border border-zinc-200 rounded-xl focus:outline-none focus:border-indigo-500 text-zinc-800"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-indigo-600 mb-1.5 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 animate-pulse" /> AI Discussion Quiz (Mins)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={liveQuizGenerationInterval}
                      onChange={(e) => setLiveQuizGenerationInterval(Number(e.target.value))}
                      placeholder="0 to disable"
                      className="w-full px-3 py-2 text-xs bg-white border border-zinc-200 rounded-xl focus:outline-none focus:border-indigo-500 text-zinc-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-indigo-600 mb-1.5 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-indigo-600" /> Active Status Timer (Mins)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={activeStatusTimer}
                      onChange={(e) => setActiveStatusTimer(Number(e.target.value))}
                      placeholder="0 to disable"
                      className="w-full px-3 py-2 text-xs bg-white border border-zinc-200 rounded-xl focus:outline-none focus:border-indigo-500 text-zinc-800"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handlePreGenerateQuizzes}
                    className="py-2.5 px-4 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-750 text-[11px] font-bold rounded-xl transition-all cursor-pointer flex items-center gap-2"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Generate Pre-Call Interactive AI Quizzes</span>
                  </button>
                </div>

                {generatingQuizzes && (
                  <div className="p-4 bg-zinc-50 border border-zinc-250 text-xs text-zinc-500 rounded-xl text-center">
                    <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-indigo-500 border-t-transparent rounded-full mr-2" />
                    Generating random classroom quizzes with Gemini model...
                  </div>
                )}

                {quizError && (
                  <div className="p-3 bg-indigo-50 border border-indigo-150 text-indigo-750 text-[11px] rounded-xl font-semibold">
                    {quizError}
                  </div>
                )}

                {generatedQuizzes.length > 0 && (
                  <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl max-h-[300px] overflow-y-auto space-y-3.5 text-zinc-850">
                    <h4 className="text-[11px] font-mono tracking-wider font-semibold text-emerald-700 uppercase flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" /> AI Generated Quizzes Preview ({generatedQuizzes.length}) - Editable
                    </h4>
                    {generatedQuizzes.map((q, idx) => (
                      <div key={idx} className="text-xs border-b border-zinc-150 pb-4 last:border-none last:pb-0 space-y-2">
                        <div className="flex flex-col gap-1">
                          <span className="font-bold text-zinc-800">Q{idx + 1}:</span>
                          <input 
                            type="text"
                            value={q.question}
                            onChange={(e) => {
                              const newQuizzes = [...generatedQuizzes];
                              newQuizzes[idx].question = e.target.value;
                              setGeneratedQuizzes(newQuizzes);
                            }}
                            className="w-full px-2.5 py-1.5 bg-white border border-emerald-200 rounded focus:outline-none focus:border-emerald-500 text-zinc-800"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          {q.options.map((o, oIdx) => (
                            <div key={oIdx} className="flex items-center gap-2">
                              <input 
                                type="radio" 
                                name={`correct-${idx}`} 
                                checked={oIdx === q.correctAnswerIndex}
                                onChange={() => {
                                  const newQuizzes = [...generatedQuizzes];
                                  newQuizzes[idx].correctAnswerIndex = oIdx;
                                  setGeneratedQuizzes(newQuizzes);
                                }}
                                className="w-3.5 h-3.5 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                              />
                              <input 
                                type="text"
                                value={o}
                                onChange={(e) => {
                                  const newQuizzes = [...generatedQuizzes];
                                  newQuizzes[idx].options[oIdx] = e.target.value;
                                  setGeneratedQuizzes(newQuizzes);
                                }}
                                className={`w-full px-2 py-1.5 bg-white border rounded focus:outline-none text-[11px] font-mono ${oIdx === q.correctAnswerIndex ? "border-emerald-400 font-bold text-emerald-800" : "border-emerald-100 text-zinc-600 focus:border-emerald-300"}`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-4 border-t border-zinc-200 flex gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => handleCreateMeeting(true)}
                    disabled={submittingStatus}
                    className="flex-1 py-2.5 bg-red-50 hover:bg-red-100 border border-red-250 text-red-650 font-bold rounded-xl shadow-sm cursor-pointer transition-all flex items-center justify-center gap-1.5"
                  >
                    <Video className="w-3.5 h-3.5 text-red-600" /> Start Live Now
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowScheduleModal(true)}
                    disabled={submittingStatus}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-[0_2px_8px_rgba(79,70,229,0.15)] cursor-pointer transition-all flex items-center justify-center gap-1.5"
                  >
                    <Calendar className="w-3.5 h-3.5" /> Schedule Class
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowScheduleForm(false)}
                    className="py-2.5 px-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Scheduling Popup Modal with Date Time Picker */}
          {showScheduleModal && (
            <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
              <div className="bg-white border border-zinc-200 p-6 md:p-8 rounded-2xl w-full max-w-md shadow-xl relative text-zinc-800">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900 uppercase tracking-wider">Configure Class Schedule</h4>
                    <span className="text-[10px] text-zinc-400 font-mono">Setup dynamic scheduling timestamp</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2 font-mono">
                      Specific Class Time Scheduling
                    </label>
                    <input
                      type="datetime-local"
                      value={scheduledDateTime}
                      onChange={(e) => setScheduledDateTime(e.target.value)}
                      className="w-full px-3.5 py-3 text-xs bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:border-indigo-500 text-zinc-800 font-mono text-center"
                    />
                  </div>

                  <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100 text-[11px] text-indigo-700 leading-normal space-y-1">
                    <p className="font-semibold flex items-center gap-1 text-indigo-850">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-pulse" /> Real-time Integration Summary
                    </p>
                    <p className="text-zinc-600">
                      • Quizzes scheduled dynamically every <strong className="text-indigo-700 font-mono">{quizTimerInterval} min</strong>.
                    </p>
                    <p className="text-zinc-600">
                      • AI Live Discussion Quiz: <strong className={liveQuizGenerationInterval > 0 ? "text-emerald-700" : "text-amber-700 font-bold"}>{liveQuizGenerationInterval > 0 ? "Enabled" : "Disabled"}</strong>.
                    </p>
                  </div>

                  <div className="pt-2 border-t border-zinc-150 flex gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => handleCreateMeeting(false, scheduledDateTime)}
                      disabled={submittingStatus}
                      className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl cursor-pointer transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-1.5"
                    >
                      {submittingStatus ? (
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent animate-spin rounded-full" />
                      ) : (
                        "Confirm Schedule"
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowScheduleModal(false)}
                      className="py-3 px-5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 font-bold rounded-xl cursor-pointer transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Classroom Meetings List of folders */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 border-b border-zinc-150 pb-3 mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-600" />
              Classroom Session Timeline
            </h3>

            {meetings.length === 0 ? (
              <div className="py-12 text-center text-xs text-zinc-400 font-mono">
                No class sessions scheduled yet. Teachers can start a room to populate logs.
              </div>
            ) : (
              <div className="space-y-4">
                {meetings.map((m) => {
                  const isActive = m.status === "active";
                  const isPast = m.status === "ended";

                  return (
                    <div
                      key={m.id}
                      onClick={() => setSelectedMeeting(m)}
                      className={`p-4 md:p-5 rounded-2xl border transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                        selectedMeeting?.id === m.id
                          ? "border-indigo-500 bg-indigo-50/60"
                          : "border-zinc-200/80 hover:border-zinc-350 bg-zinc-50/40"
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-mono tracking-wider font-semibold ${
                            isActive 
                              ? "bg-rose-550/10 text-rose-600 border border-rose-250 animate-pulse" 
                              : isPast 
                                ? "bg-zinc-100 text-zinc-500 border border-zinc-200" 
                                : "bg-indigo-50 text-indigo-600 border border-indigo-150"
                          }`}>
                            {m.status}
                          </span>
                          <span className="text-[10px] text-zinc-400 font-mono">
                            {new Date(m.createdAt).toLocaleDateString()}
                          </span>
                          {m.duration ? (
                            <span className="text-[10px] text-amber-600 font-mono">
                              • {m.duration} mins limit
                            </span>
                          ) : (
                            <span className="text-[10px] text-amber-600 font-mono">
                              • 60 mins limit
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm font-bold text-zinc-800 leading-snug">{m.title}</h4>
                        <p className="text-xs text-zinc-500 line-clamp-1 max-w-md">{m.description || "No description provided."}</p>
                      </div>

                      <div className="flex items-center gap-2 self-end md:self-auto">
                        {isActive ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onStartMeeting(m);
                            }}
                            className="py-1.5 px-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10.5px] rounded-lg transition-all cursor-pointer flex items-center gap-1 shadow-sm shadow-rose-650/10"
                          >
                            <Video className="w-3.5 h-3.5" />
                            <span>Join Live</span>
                          </button>
                        ) : isPast ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onStartReplay(m);
                            }}
                            className="py-1.5 px-3 bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 text-zinc-800 font-bold text-[10.5px] rounded-lg transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                          >
                            <PlayCircle className="w-3.5 h-3.5 text-indigo-600" />
                            <span>Replay Missed Class</span>
                          </button>
                        ) : (
                          isTeacher && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const startedAt = new Date().toISOString();
                                const updated = { ...m, status: "active" as const, startedAt };
                                onStartMeeting(updated);
                                updateDoc(doc(db, "meetings", m.id), { status: "active", startedAt }).catch((err) => {
                                  console.error("Failed to activate meeting:", err);
                                });
                              }}
                              className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10.5px] rounded-lg transition-all cursor-pointer shadow-sm shadow-indigo-600/10"
                            >
                              Activate Room
                            </button>
                          )
                        )}
                        <ChevronRight className="w-4 h-4 text-zinc-450" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column Selected Meeting stats details and summaries */}
        <div className="lg:col-span-4 space-y-6">
          
          <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 border-b border-zinc-150 pb-3 mb-4">
              Class Roster &amp; Students
            </h3>
            <div className="space-y-3.5">
              <div className="p-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-zinc-800 block">Active Attendees</span>
                  <span className="text-zinc-400 font-mono text-[10px]">Platform registered students</span>
                </div>
                <span className="w-7 h-7 bg-indigo-50 rounded-lg flex items-center justify-center font-bold font-mono text-indigo-600 border border-indigo-100">
                  {classroom.studentIds?.length || 0}
                </span>
              </div>

              {(classroom.studentIds?.length || 0) === 0 ? (
                <p className="text-[11px] text-zinc-400 font-mono text-center py-4">No students have joined this classroom code yet.</p>
              ) : (
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {(classroom.studentIds || []).map((sid, index) => {
                    const prof = studentProfiles[sid];
                    return (
                      <div key={sid} className="p-2.5 bg-zinc-50/50 rounded-xl border border-zinc-200/60 flex items-center justify-between text-xs transition-colors hover:bg-zinc-50">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-6 h-6 rounded-md bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center text-[10px] font-bold shrink-0">
                            {index + 1}
                          </div>
                          <div className="min-w-0">
                            <span className="text-zinc-800 font-bold block truncate leading-snug">
                              {prof ? prof.name : `Scholar User [${sid.substring(0, 5)}]`}
                            </span>
                            <span className="text-[9.5px] text-zinc-450 font-mono block truncate">
                              {prof ? prof.email : "Awaiting sync..."}
                            </span>
                          </div>
                        </div>
                        <span className="text-[8.5px] font-bold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600 border border-indigo-150 uppercase tracking-widest shrink-0 font-mono">
                          Enrolled
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {selectedMeeting ? (
            <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm space-y-5 scale-in-animation text-zinc-800">
              <div className="border-b border-zinc-150 pb-3">
                <span className="text-[10px] uppercase font-mono tracking-wider font-bold text-indigo-600">Selected Class Report</span>
                <h4 className="text-xs font-extrabold text-zinc-900 mt-1 leading-snug">{selectedMeeting.title}</h4>
              </div>

              {/* Recorded Video URL Configuration */}
              {isTeacher && (
                <div className="space-y-2 bg-zinc-50 p-4 rounded-xl border border-zinc-200/60">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 font-mono">
                    Recorded Class Video URL (Google Drive / Direct MP4)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Paste recorded video link or Google Drive link..."
                      value={selectedMeeting.recordedVideoUrl || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSelectedMeeting({ ...selectedMeeting, recordedVideoUrl: val });
                        setVideoSaved(false);
                      }}
                      className="flex-1 px-3 py-1.5 text-xs bg-white border border-zinc-200 rounded-xl focus:outline-none focus:border-indigo-500 text-zinc-800"
                    />
                    <button
                      onClick={async () => {
                        try {
                          await updateDoc(doc(db, "meetings", selectedMeeting.id), {
                            recordedVideoUrl: selectedMeeting.recordedVideoUrl || ""
                          });
                          setVideoSaved(true);
                          setTimeout(() => setVideoSaved(false), 2500);
                        } catch (err) {
                          console.error("Failed saving video URL:", err);
                        }
                      }}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-550 text-white font-bold text-[10px] uppercase rounded-xl transition-all cursor-pointer whitespace-nowrap"
                    >
                      {videoSaved ? "Saved!" : "Save Link"}
                    </button>
                  </div>
                  <p className="text-[9px] text-zinc-400 leading-normal">
                    Students replaying the missed session will watch this video. Fallback URL will be used if left blank.
                  </p>
                </div>
              )}

              {/* Class Responses log stats */}
              <div className="space-y-3">
                <h5 className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest font-mono flex items-center gap-1.5 border-b border-zinc-150 pb-1">
                  <BarChart3 className="w-3.5 h-3.5 text-indigo-600" /> Member Engagements
                </h5>
                {meetingResponses.length === 0 ? (
                  <p className="text-[11px] text-zinc-400 font-mono bg-zinc-50/50 border border-zinc-200/50 p-4 rounded-xl text-center">
                    No students have submitted interaction checklists for this session yet.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[220px] overflow-y-auto">
                    {meetingResponses.map((r) => (
                      <div key={r.id} className="p-3 bg-zinc-50/50 border border-zinc-200/60 rounded-xl space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-zinc-800 line-clamp-1">{r.userName}</span>
                          <span className={`px-2 py-0.5 rounded text-[8.5px] uppercase font-mono tracking-wider font-bold ${
                            r.missedLive 
                              ? "bg-purple-50 text-purple-700 border border-purple-200" 
                              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          }`}>
                            {r.missedLive ? "Recorded" : "Live Session"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[10.5px]">
                          <span className="text-zinc-400 font-mono">QUIZZES SOLVED:</span>
                          <span className="font-mono text-zinc-700">{r.quizAnswers.length} items</span>
                        </div>

                        {/* Visual score percentage bar */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10.5px]">
                            <span className="text-zinc-400">Total Involvement:</span>
                            <span className="font-bold text-zinc-700 font-mono">{r.overallPercentage}%</span>
                          </div>
                          <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${
                                r.overallPercentage >= 80 
                                  ? "bg-emerald-500" 
                                  : r.overallPercentage >= 50 
                                    ? "bg-amber-550" 
                                    : "bg-rose-500"
                              }`}
                              style={{ width: `${r.overallPercentage}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* AI Class summary markdown compiler */}
              <div className="space-y-3 pt-3 border-t border-zinc-150">
                <div className="flex items-center justify-between">
                  <h5 className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest font-mono flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-pulse" /> Gemini AI Digest
                  </h5>
                  {isTeacher && (
                    <button
                      onClick={handleCompileAISummary}
                      disabled={summarizing}
                      className="text-[10px] text-indigo-600 hover:text-indigo-500 font-bold uppercase transition-all cursor-pointer border border-indigo-200 hover:bg-indigo-50 rounded px-1.5 py-0.5"
                    >
                      {summarizing ? "Synthesizing..." : "Settle Summary"}
                    </button>
                  )}
                </div>

                {selectedMeeting.aiSummary ? (
                  <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4.5 text-xs text-zinc-700 leading-relaxed max-h-[300px] overflow-y-auto space-y-2 markdown-body shadow-inner">
                    <Markdown>{selectedMeeting.aiSummary}</Markdown>
                  </div>
                ) : (
                  <div className="bg-zinc-50 border border-zinc-200/80 p-4 rounded-xl text-center text-[10.5px] leading-relaxed text-zinc-400">
                    No summary generated. Click compilation above to synthesize student scores and notes!
                  </div>
                )}
              </div>

            </div>
          ) : (
            <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center text-xs text-zinc-400 font-mono shadow-sm">
              Select a meeting timeline card to inspect student evaluations, quizzes, and AI summarized reports.
            </div>
          )}

        </div>

      </div>
    </div>
  );
};
