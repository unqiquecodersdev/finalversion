import { useState, useEffect, useRef } from "react";
import { UserProfile, Classroom, Meeting, UserRole } from "./types";
import { 
  auth, db, onAuthStateChanged, signOut,
  doc, getDoc, getDocs, collection, onSnapshot, addDoc, setDoc, updateDoc 
} from "./firebase";
import { Navbar } from "./components/Navbar";
import { AuthGate } from "./components/AuthGate";
import { ClassroomCard } from "./components/ClassroomCard";
import { MeetingRoom } from "./components/MeetingRoom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RecordedPlayer } from "./components/RecordedPlayer";
import { AnalyticsView } from "./components/AnalyticsView";
import { AdminDashboard } from "./components/AdminDashboard";
import { 
  Plus, Users, Key, Search, Copy, Check, Compass, BookOpen, User, 
  HelpCircle, Calendar, Sparkles, Award, Star, Video, ClipboardList,
  ChevronRight, Clock
} from "lucide-react";

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Tab & Session routing states
  const [activeTab, setActiveTab] = useState<string>("classrooms");
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedClassroom, setSelectedClassroom] = useState<Classroom | null>(null);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [activeReplay, setActiveReplay] = useState<Meeting | null>(null);

  // Active globally launched meetings (for quick join notifications)
  const [allActiveMeetings, setAllActiveMeetings] = useState<Meeting[]>([]);
  const [allMeetings, setAllMeetings] = useState<Meeting[]>([]);

  // Toggles & Forms
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [createClassError, setCreateClassError] = useState<string | null>(null);
  const [submittingClass, setSubmittingClass] = useState(false);

  const [showJoinClass, setShowJoinClass] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);

  // Optimistic classroom state
  const [optimisticClassrooms, setOptimisticClassrooms] = useState<Classroom[]>([]);

  // Combined classrooms (optimistic + loaded, keeping optimistic ones on top and avoiding duplicates)
  const displayedClassrooms = [
    ...optimisticClassrooms,
    ...classrooms.filter(c => !optimisticClassrooms.some(oc => oc.id === c.id))
  ];

  const userActiveMeetings = allActiveMeetings.filter(m => 
    user?.role === "admin" || 
    m.hostId === user?.uid ||
    displayedClassrooms.some(c => c.id === m.classroomId)
  );


  // 1. Listen to Authentication State with Persistent Synchronization
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Firebase Auth UID is ALWAYS the source of truth for identity.
        // Never rely on what's stored in the Firestore users doc uid field —
        // it may be stale from an older offline session.
        const firebaseUid = firebaseUser.uid;

        try {
          const userDoc = await getDoc(doc(db, "users", firebaseUid));
          if (userDoc && userDoc.exists()) {
            const storedProfile = userDoc.data() as UserProfile;

            // Always override uid with the real Firebase Auth UID and self-heal stale docs
            const profile: UserProfile = { ...storedProfile, uid: firebaseUid };
            if (storedProfile.uid !== firebaseUid) {
              console.warn("[Auth] Stale uid in Firestore users doc detected — self-healing.", { stored: storedProfile.uid, actual: firebaseUid });
              await setDoc(doc(db, "users", firebaseUid), profile);
            }

            setUser(profile);
            localStorage.setItem("active_user_profile", JSON.stringify(profile));
          } else {
            // No user document yet — create a fresh one
            const emailLower = (firebaseUser.email || "").toLowerCase();
            let suggestedRole: UserRole = "student";
            if (emailLower.includes("teacher")) suggestedRole = "teacher";
            else if (emailLower.includes("admin")) suggestedRole = "admin";

            let derivedName = firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "Scholar User";
            if (emailLower.includes("teacher_sandbox")) derivedName = "Dr. Sarah Jenkins";
            else if (emailLower.includes("student_sandbox")) derivedName = "Liam Thompson";
            else if (emailLower.includes("admin_sandbox")) derivedName = "Admin Registrar";

            const profile: UserProfile = {
              uid: firebaseUid,
              email: firebaseUser.email || "",
              name: derivedName,
              role: suggestedRole,
              createdAt: new Date().toISOString()
            };
            await setDoc(doc(db, "users", firebaseUid), profile);
            setUser(profile);
            localStorage.setItem("active_user_profile", JSON.stringify(profile));
          }
        } catch (err) {
          console.warn("[Auth] Firestore fetch failed — using cache or building fallback:", err);

          // Try localStorage cache first — but only if it matches the Firebase UID
          const localCache = localStorage.getItem("active_user_profile");
          if (localCache) {
            try {
              const cachedProfile = JSON.parse(localCache) as UserProfile;
              if (cachedProfile.uid === firebaseUid) {
                setUser(cachedProfile);
                setAuthChecked(true);
                return;
              }
            } catch (jsonErr) {
              console.warn("[Auth] Stale cache format:", jsonErr);
            }
          }

          // Last resort fallback — always use Firebase UID so classroom filters work
          const emailLower = (firebaseUser.email || "").toLowerCase();
          let fallbackRole: UserRole = "student";
          if (emailLower.includes("teacher")) fallbackRole = "teacher";
          else if (emailLower.includes("admin")) fallbackRole = "admin";

          let derivedName = firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "Scholar User";
          if (emailLower.includes("teacher_sandbox")) derivedName = "Dr. Sarah Jenkins";
          else if (emailLower.includes("student_sandbox")) derivedName = "Liam Thompson";
          else if (emailLower.includes("admin_sandbox")) derivedName = "Admin Registrar";

          const fallbackProfile: UserProfile = {
            uid: firebaseUid,
            email: firebaseUser.email || "guest@sandbox.edu",
            name: derivedName,
            role: fallbackRole,
            createdAt: new Date().toISOString()
          };
          setUser(fallbackProfile);
          localStorage.setItem("active_user_profile", JSON.stringify(fallbackProfile));
        }
      } else {
        localStorage.removeItem("active_user_profile");
        setUser(null);
      }
      setAuthChecked(true);
    });

    return () => unsubscribe();
  }, []);

  // 2. Real-time Listening of Educational Classroom List
  useEffect(() => {
    if (!user) {
      setClassrooms([]);
      return;
    }

    const classroomsQuery = collection(db, "classrooms");
    const unsubscribe = onSnapshot(classroomsQuery, (snapshot) => {
      const allRooms: Classroom[] = [];
      const repairQueue: { id: string }[] = [];

      snapshot.forEach((docSnap) => {
        const c = docSnap.data() as Classroom;

        // Filter by role — teacher sees their own classrooms, student sees joined ones, admin sees all
        if (user.role === "admin") {
          allRooms.push(c);
        } else if (user.role === "teacher") {
          if (c.teacherId === user.uid) {
            // Normal match — current UID is correct
            allRooms.push(c);
          } else if (c.teacherEmail && c.teacherEmail === user.email) {
            // Email match but teacherId is stale (e.g. from an old offline session)
            // Show the classroom immediately and queue a silent repair in the background
            allRooms.push({ ...c, teacherId: user.uid });
            repairQueue.push({ id: c.id });
          }
        } else if (user.role === "student" && c.studentIds?.includes(user.uid)) {
          allRooms.push(c);
        }
      });

      setClassrooms(allRooms);

      // Silently repair stale teacherIds in the background so next login is automatic
      if (repairQueue.length > 0) {
        repairQueue.forEach(({ id }) => {
          updateDoc(doc(db, "classrooms", id), { teacherId: user.uid })
            .then(() => console.log(`[Repair] Fixed stale teacherId on classroom ${id}`))
            .catch((err) => console.warn(`[Repair] Could not repair classroom ${id}:`, err));
        });
      }
    }, (error) => {
      console.error("[Classrooms] Firestore listener error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // 3. Real-time monitoring of meetings for student scheduler and admin stats
  useEffect(() => {
    if (!user) {
      setAllActiveMeetings([]);
      setAllMeetings([]);
      return;
    }
    const meetsQuery = collection(db, "meetings");
    const unsubscribe = onSnapshot(meetsQuery, (snapshot) => {
      const activeMeets: Meeting[] = [];
      const meets: Meeting[] = [];
      snapshot.forEach((doc) => {
        const m = doc.data() as Meeting;
        meets.push(m);
        if (m.status === "active") {
          activeMeets.push(m);
        }
      });
      setAllActiveMeetings(activeMeets);
      setAllMeetings(meets);
    });

    return () => unsubscribe();
  }, [user]);

  // Keep activeMeeting ref in sync to avoid stale closures in listeners
  const activeMeetingRef = useRef<Meeting | null>(null);
  useEffect(() => {
    activeMeetingRef.current = activeMeeting;
  }, [activeMeeting]);

  const checkEnrollmentAndJoin = async (meetingToJoin: Meeting) => {
    setEnrollmentError(null);
    if (!user) return;
    if (user.role === "admin") {
      setActiveMeeting(meetingToJoin);
      return;
    }
    try {
      const classDoc = await getDoc(doc(db, "classrooms", meetingToJoin.classroomId));
      if (classDoc.exists()) {
        const classroomData = classDoc.data() as Classroom;
        const isTeacher = classroomData.teacherId === user.uid || classroomData.teacherEmail === user.email;
        const isStudentEnrolled = classroomData.studentIds?.includes(user.uid) || false;
        if (isTeacher || isStudentEnrolled) {
          setActiveMeeting(meetingToJoin);
        } else {
          setEnrollmentError("Access Denied: You are not enrolled in the parent group of this class.");
        }
      } else {
        setEnrollmentError("Access Denied: Parent classroom not found.");
      }
    } catch (err) {
      console.error("Error verifying enrollment:", err);
      setEnrollmentError("Error verifying enrollment status.");
    }
  };

  // 4. URL-based Meeting Deep Linking
  useEffect(() => {
    if (!user) return;

    const checkUrlParams = async () => {
      const params = new URLSearchParams(window.location.search);
      const urlMeetingId = params.get("meetingId");
      const currentActive = activeMeetingRef.current;

      if (urlMeetingId && (!currentActive || currentActive.id !== urlMeetingId)) {
        try {
          const meetDoc = await getDoc(doc(db, "meetings", urlMeetingId));
          if (meetDoc.exists()) {
            const m = meetDoc.data() as Meeting;
            if (m.status === "active" || m.status === "scheduled") {
              await checkEnrollmentAndJoin(m);
            }
          }
        } catch (err) {
          console.warn("Failed to join meeting from URL parameter:", err);
        }
      } else if (!urlMeetingId && currentActive) {
        // Handle case where user navigated back/forward using browser navigation and URL parameter was removed
        setActiveMeeting(null);
      }
    };

    checkUrlParams();
    
    const handlePopState = () => {
      checkUrlParams();
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [user]);

  // Synchronize activeMeeting state changes back to URL search parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentMeetingId = params.get("meetingId");

    if (activeMeeting) {
      if (currentMeetingId !== activeMeeting.id) {
        params.set("meetingId", activeMeeting.id);
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.pushState({ meetingId: activeMeeting.id }, "", newUrl);
      }
    } else {
      if (currentMeetingId) {
        params.delete("meetingId");
        const queryStr = params.toString();
        const newUrl = window.location.pathname + (queryStr ? `?${queryStr}` : "");
        window.history.pushState(null, "", newUrl);
      }
    }
  }, [activeMeeting]);

  const handleLogout = async () => {
    setSelectedClassroom(null);
    setActiveMeeting(null);
    setActiveReplay(null);
    setUser(null);
    await signOut(auth);
  };

  // Helper alphanumeric room code generator for students
  const generateRandomCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassName.trim() || !user) return;

    if (user.role !== "teacher") {
      setCreateClassError("Only verified Teachers are authorized to build classroom group folders.");
      return;
    }

    setSubmittingClass(true);
    setCreateClassError(null);

    const classId = "class_" + Math.random().toString(36).substring(2, 9);
    const generatedCode = generateRandomCode();

    const newRoom: Classroom = {
      id: classId,
      name: newClassName.trim(),
      description: "",
      teacherId: user.uid,
      teacherEmail: user.email, // stored for stale-UID repair on future logins
      teacherName: user.name,
      code: generatedCode,
      studentIds: [],
      createdAt: new Date().toISOString()
    };

    // Optimistically add the new classroom to UI
    setOptimisticClassrooms(prev => [newRoom, ...prev]);

    try {
      await setDoc(doc(db, "classrooms", classId), newRoom);
      setNewClassName("");
      setCreateClassError(null);
      setShowCreateClass(false);
    } catch (err: any) {
      console.error("Failed placing classroom folder:", err);
      setCreateClassError(err?.message || "Failed to create the classroom folder. Please verify database connection.");
    } finally {
      // Clean up the optimistic room from state (the real document is now active in Firestore classrooms stream)
      setOptimisticClassrooms(prev => prev.filter(r => r.id !== classId));
      setSubmittingClass(false);
    }
  };

  const handleJoinClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);
    if (!joinCodeInput.trim() || !user) return;

    try {
      // Find matching class join code
      const classroomsQuery = collection(db, "classrooms");
      const snapshot = await getDocs(classroomsQuery);
      let matchRoom: Classroom | null = null;

      snapshot.forEach((docSnap) => {
        const c = docSnap.data() as Classroom;
        if (c.code.toUpperCase() === joinCodeInput.trim().toUpperCase()) {
          matchRoom = c;
        }
      });

      if (!matchRoom) {
        setJoinError("No classroom folder matching that Join Code could be found.");
        return;
      }

      const room = matchRoom as Classroom;
      if (room.studentIds?.includes(user.uid)) {
        setJoinError("You have already joined this interactive classroom folder!");
        return;
      }

      // Add student user UID
      const updatedStudents = [...(room.studentIds || []), user.uid];
      await updateDoc(doc(db, "classrooms", room.id), {
        studentIds: updatedStudents
      });

      setJoinCodeInput("");
      setShowJoinClass(false);
    } catch (err) {
      console.error(err);
      setJoinError("An unexpected error occurred while connecting classroom links.");
    }
  };

  const handleClassSelection = (room: Classroom) => {
    setSelectedClassroom(room);
    setActiveTab("classrooms"); // ensures we navigate inside classroom detail analytics
  };

  const copyToClipboard = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Auth gate check
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col justify-center items-center font-mono text-xs text-zinc-550">
        <span className="animate-spin inline-block w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full mb-3" />
        <span>Loading Virtual School environment...</span>
      </div>
    );
  }

  if (!user) {
    return <AuthGate onAuthenticated={setUser} />;
  }

  // IMMERSIVE STAGE: Full Screen Active Video Call
  if (activeMeeting) {
    return (
      <ErrorBoundary>
        <MeetingRoom 
          meeting={activeMeeting} 
          user={user} 
          onLeave={() => setActiveMeeting(null)} 
        />
      </ErrorBoundary>
    );
  }

  // IMMERSIVE STAGE: Missed Class recorded interactive lesson replay
  if (activeReplay) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col p-4 justify-center items-center">
        <div className="w-full h-full max-w-7xl">
          <RecordedPlayer 
            meeting={activeReplay} 
            user={user} 
            onClose={() => setActiveReplay(null)} 
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-800">
      <Navbar 
        user={user} 
        onLogout={handleLogout} 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
      />

      {/* Main active platform routes */}
      <main className="pb-16 relative">
        
        {/* Dynamic Classrooms List Tab */}
        {activeTab === "classrooms" && (
          <div>
            {!selectedClassroom ? (
              // General Classroom code/link board
              <div className="max-w-6xl mx-auto py-10 px-6 space-y-10">
                
                {/* Intro welcome HUD card */}
                <div className="bg-gradient-to-r from-teal-900 to-emerald-950 rounded-3xl text-white p-8 md:p-11 relative overflow-hidden shadow-lg shadow-teal-950/10">
                  <div className="absolute inset-x-0 bottom-0 bg-[radial-gradient(circle_at_bottom_left,rgba(20,184,166,0.15),transparent_60%)]" />
                  <div className="relative z-10 max-w-xl space-y-4">
                    <span className="px-2.5 py-0.5 rounded bg-teal-500/10 text-teal-400 font-mono tracking-wider font-semibold text-[10.5px] uppercase">
                      Class Portal Workspace
                    </span>
                    <h1 className="text-3xl font-extrabold tracking-tight leading-none text-zinc-50">
                      Welcome back, {user.name}
                    </h1>
                    <p className="text-zinc-300 text-xs leading-relaxed">
                      EduClass Workspace brings online lessons under singular, responsive class folder groups. Instructors create slots with pre-generated AI quizzes, and students join instantly.
                    </p>

                    <div className="flex items-center gap-3 pt-2 text-xs">
                      {user.role === "teacher" ? (
                        <button
                          onClick={() => setShowCreateClass(true)}
                          className="py-2.5 px-4 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl transition-all shadow cursor-pointer"
                        >
                          Establish Class Group Folder
                        </button>
                      ) : (
                        <button
                          onClick={() => setShowJoinClass(true)}
                          className="py-2.5 px-4 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl transition-all shadow cursor-pointer"
                        >
                          Join Class Code
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Popups Forms modals */}
                {showCreateClass && user.role === "teacher" && (
                  <div className="p-6 md:p-8 bg-white border border-zinc-150 rounded-3xl shadow-sm space-y-4 scale-in-animation">
                    <h3 className="text-sm font-semibold text-zinc-900 tracking-tight uppercase border-b border-zinc-100 pb-2.5">
                      Create Class Group Folder
                    </h3>
                    <form onSubmit={handleCreateClass} className="space-y-4 text-xs">
                      {createClassError && (
                        <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl font-medium leading-relaxed">
                          ⚠️ {createClassError}
                        </div>
                      )}
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-zinc-500 mb-1">Class title / course identifier</label>
                        <input
                          type="text"
                          required
                          disabled={submittingClass}
                          placeholder="e.g., Biology 101: Molecular Anatomy"
                          value={newClassName}
                          onChange={(e) => setNewClassName(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:border-teal-500 text-zinc-800 disabled:opacity-60"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button 
                          type="submit" 
                          disabled={submittingClass}
                          className="px-4 py-2 bg-teal-800 hover:bg-teal-900 text-white font-bold rounded-lg cursor-pointer disabled:opacity-50 transition-all flex items-center gap-2"
                        >
                          {submittingClass ? (
                            <>
                              <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                              <span>Building...</span>
                            </>
                          ) : (
                            <span>Build Folder</span>
                          )}
                        </button>
                        <button 
                          type="button" 
                          disabled={submittingClass}
                          onClick={() => {
                            setCreateClassError(null);
                            setShowCreateClass(false);
                          }}
                          className="px-4 py-2 bg-zinc-100 text-zinc-650 rounded-lg disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {showJoinClass && (
                  <div className="p-6 md:p-8 bg-white border border-zinc-150 rounded-3xl shadow-sm space-y-4 scale-in-animation">
                    <h3 className="text-sm font-semibold text-zinc-900 tracking-tight uppercase border-b border-zinc-100 pb-2.5">Join Classroom Code</h3>
                    <form onSubmit={handleJoinClass} className="space-y-4 text-xs">
                      {joinError && (
                        <div className="p-3 bg-rose-50 border border-rose-100 text-rose-800 rounded-xl font-medium">
                          {joinError}
                        </div>
                      )}
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-zinc-500 mb-1">Enter 6-Character Alphanumeric Course Code</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g., QX82M6"
                          maxLength={10}
                          value={joinCodeInput}
                          onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                          className="w-full px-3.5 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:border-teal-500 text-zinc-800 font-mono tracking-wider font-semibold text-center text-sm"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button type="submit" className="px-4 py-2 bg-teal-850 text-white font-bold rounded-lg cursor-pointer">
                          Join Classroom
                        </button>
                        <button 
                          type="button" 
                          onClick={() => setShowJoinClass(false)}
                          className="px-4 py-2 bg-zinc-100 text-zinc-650 rounded-lg"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Live Class Sessions Now */}
                {userActiveMeetings.length > 0 && (
                  <div className="space-y-5">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-rose-600 font-mono flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600"></span>
                      </span>
                      Broadcasting Live Sessions
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {userActiveMeetings.map((m) => (
                        <div key={m.id} className="bg-gradient-to-br from-rose-50 to-white border border-rose-200 rounded-3xl p-6 shadow-sm space-y-4 hover:border-rose-350 transition-all flex flex-col justify-between">
                          <div className="space-y-3">
                            <div className="flex items-start justify-between">
                              <div className="space-y-1">
                                <span className="text-[9px] uppercase font-bold tracking-widest text-rose-700 bg-rose-100 px-2 py-0.5 rounded border border-rose-200 block w-fit">
                                  {m.classroomName}
                                </span>
                                <h3 className="text-xs font-extrabold text-zinc-900 uppercase mt-2">
                                  {m.title}
                                </h3>
                              </div>
                              <span className="text-[9.5px] font-mono tracking-wider font-bold bg-rose-600 text-white rounded px-1.5 py-0.5 uppercase h-fit animate-pulse">
                                Live Now
                              </span>
                            </div>
                            <p className="text-[11px] text-zinc-500 line-clamp-2 leading-relaxed">
                              {m.description || "Live virtual video lesson and real-time comprehension drills."}
                            </p>
                          </div>

                          <div className="pt-3 border-t border-rose-100 flex items-center justify-between text-[10px]">
                            <span className="text-zinc-500 font-medium flex items-center gap-1.5 font-mono">
                              <User className="w-3.5 h-3.5 text-zinc-400" />
                              Host: {m.hostName}
                            </span>
                            <button
                              onClick={() => checkEnrollmentAndJoin(m)}
                              className="py-1.5 px-4 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg cursor-pointer transition-all uppercase tracking-wider text-[9.5px] flex items-center gap-1 shadow-sm"
                            >
                              <Video className="w-3.5 h-3.5" />
                              <span>Join Live Class</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Dashboard rooms grid */}
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 font-mono flex items-center gap-2">
                      <Compass className="w-4 h-4 text-teal-600" />
                      Instructor Folders
                    </h2>
                    <span className="text-[11px] text-zinc-400 font-mono">
                      {displayedClassrooms.length} active classroom folders matching profile parameters
                    </span>
                  </div>

                  {displayedClassrooms.length === 0 ? (
                    <div className="py-16 text-center border border-dashed border-zinc-250 bg-white rounded-3xl px-6 space-y-4">
                      <div className="w-14 h-14 rounded-full bg-zinc-100 text-zinc-400 flex items-center justify-center mx-auto shadow-inner">
                        <BookOpen className="w-6 h-6" />
                      </div>
                      <p className="text-zinc-500 font-medium text-xs max-w-sm mx-auto leading-relaxed">
                        {user.role === "teacher" 
                          ? "You have not set up any interactive educational classrooms. Click standard Create Folder above to initialize student access pipelines."
                          : "You have not joined any classroom groups. Obtain join alphanumeric code from your class teacher and enter above."
                        }
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {displayedClassrooms.map((room) => (
                        <ClassroomCard
                           key={room.id}
                           classroom={room}
                           activeMeetings={allActiveMeetings}
                           userRole={user.role}
                           onSelect={() => handleClassSelection(room)}
                           onJoinMeeting={(m) => {
                             checkEnrollmentAndJoin(m);
                           }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Upcoming Scheduled Class Sessions */}
                <div className="space-y-4 pt-10">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 font-mono flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    Upcoming Class Sessions
                  </h2>
                  {allMeetings.filter(m => m.status === "scheduled" && (user?.role === "admin" || user?.role === "teacher" || displayedClassrooms.some(c => c.id === m.classroomId))).length === 0 ? (
                    <div className="bg-white border border-zinc-150 rounded-3xl p-8 text-center text-xs text-zinc-400">
                      No upcoming scheduled sessions are currently registered for your course folders.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {allMeetings
                        .filter(m => m.status === "scheduled" && (user?.role === "admin" || user?.role === "teacher" || displayedClassrooms.some(c => c.id === m.classroomId)))
                        .map((m) => (
                          <div key={m.id} className="bg-white border border-zinc-150 rounded-3xl p-6 shadow-sm space-y-4 hover:border-indigo-300 transition-all flex flex-col justify-between">
                            <div className="space-y-3">
                              <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                  <span className="text-[9px] uppercase font-bold tracking-widest text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 block w-fit">
                                    {m.classroomName}
                                  </span>
                                  <h3 className="text-xs font-extrabold text-zinc-800 uppercase mt-2">
                                    {m.title}
                                  </h3>
                                </div>
                                <span className="text-[9.5px] font-mono tracking-wider font-bold bg-zinc-50 border border-zinc-150 text-zinc-455 rounded px-1.5 py-0.5 uppercase h-fit">
                                  Scheduled
                                </span>
                              </div>
                              <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                                {m.description || "Interactive virtual video lesson and real-time comprehension drills."}
                              </p>

                              {m.scheduledAt && (
                                <div className="p-2.5 bg-indigo-50/50 border border-indigo-100/50 rounded-xl flex items-center gap-2 text-[10.5px] text-indigo-700 font-semibold font-mono">
                                  <Calendar className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
                                  <span>Class Starting Time: <strong>{new Date(m.scheduledAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</strong></span>
                                </div>
                              )}
                            </div>

                            <div className="pt-3 border-t border-zinc-100 flex items-center justify-between text-[10px]">
                              <span className="text-zinc-500 font-medium flex items-center gap-1.5 font-mono">
                                <Clock className="w-3.5 h-3.5 text-zinc-400" />
                                Created: {new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              </span>
                              
                              {user?.role === "teacher" || user?.role === "admin" ? (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const startedAt = new Date().toISOString();
                                      const updatedMeeting = { ...m, status: "active" as const, startedAt };
                                      checkEnrollmentAndJoin(updatedMeeting);
                                      updateDoc(doc(db, "meetings", m.id), { status: "active", startedAt }).catch((err) => {
                                        console.error("Failed to activate meeting:", err);
                                      });
                                    }}
                                    className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg cursor-pointer transition-all uppercase tracking-wider text-[9.5px] flex items-center gap-1 shadow-sm shadow-indigo-600/20"
                                  >
                                    <Video className="w-3.5 h-3.5" />
                                    <span>Start Live Now</span>
                                  </button>
                                  <button
                                    onClick={() => {
                                      const targetRoom = displayedClassrooms.find(r => r.id === m.classroomId);
                                      if (targetRoom) {
                                        handleClassSelection(targetRoom);
                                      }
                                    }}
                                    className="p-1.5 text-zinc-500 hover:text-indigo-600 border border-zinc-200 hover:border-indigo-300 rounded-lg cursor-pointer transition-all"
                                    title="Go to Course Folder"
                                  >
                                    <ChevronRight className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    const targetRoom = displayedClassrooms.find(r => r.id === m.classroomId);
                                    if (targetRoom) {
                                      handleClassSelection(targetRoom);
                                    }
                                  }}
                                  className="text-indigo-600 hover:text-indigo-700 font-extrabold flex items-center gap-1 cursor-pointer transition-all uppercase tracking-wider text-[9.5px]"
                                >
                                  Go to Classroom <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

              </div>
            ) : (
              // Immersive analytic folder detail route
              <AnalyticsView
                classroom={selectedClassroom}
                user={user}
                activeMeetings={allActiveMeetings}
                onStartMeeting={(m) => {
                  checkEnrollmentAndJoin(m);
                }}
                onStartReplay={(m) => {
                  setActiveReplay(m);
                }}
                onGoBack={() => setSelectedClassroom(null)}
              />
            )}
          </div>
        )}

        {/* Dynamic User Profile Tab */}
        {activeTab === "profile" && (
          <div className="max-w-2xl mx-auto py-12 px-6">
            <div className="bg-white border border-zinc-150 rounded-3xl p-8 space-y-6 shadow-sm">
              <div className="text-center space-y-3 pb-6 border-b border-zinc-100">
                <div className="w-20 h-20 bg-teal-100 text-teal-800 rounded-full flex items-center justify-center mx-auto text-2xl font-bold font-sans">
                  {user.name.charAt(0)}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-zinc-900 tracking-tight uppercase leading-snug">{user.name}</h2>
                  <p className="text-xs text-zinc-400 font-mono mt-0.5">{user.email}</p>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase font-mono">Institutional Credentials</h3>
                
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="bg-zinc-50 p-4 border border-zinc-100 rounded-2xl">
                    <span className="text-zinc-400 block text-[9.5px] uppercase font-bold mb-1">Course Role Status</span>
                    <span className="font-semibold text-zinc-800 uppercase tracking-widest text-[11px] text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-100">
                      {user.role} mode
                    </span>
                  </div>

                  <div className="bg-zinc-50 p-4 border border-zinc-100 rounded-2xl">
                    <span className="text-zinc-400 block text-[9.5px] uppercase font-bold mb-1">Platform Account ID</span>
                    <span className="font-mono text-zinc-650 tracking-tight leading-none block overflow-hidden text-ellipsis truncate">
                      {user.uid}
                    </span>
                  </div>
                </div>

                <div className="p-4 bg-zinc-50 border border-zinc-150 rounded-2xl space-y-2 text-xs leading-relaxed text-zinc-500">
                  <span className="font-bold text-zinc-800 block mb-1">Student Integrity Guidelines</span>
                  All live interactive classes are automatically monitored with periodic verification overlays. Missed replays require individual checkpoint clearance prior to student credits processing.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Admin Control Tab */}
        {activeTab === "admin" && user.role === "admin" && (
          <AdminDashboard currentUser={user} />
        )}

      </main>

      {enrollmentError && (
        <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-zinc-200 p-6 md:p-8 rounded-2xl w-full max-w-md shadow-xl text-center text-zinc-800 scale-in-animation">
            <h4 className="text-sm font-bold text-red-650 uppercase tracking-wider mb-2">Access Denied</h4>
            <p className="text-xs text-zinc-500 mb-6">{enrollmentError}</p>
            <button
              onClick={() => setEnrollmentError(null)}
              className="py-2.5 px-6 bg-teal-800 hover:bg-teal-900 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
