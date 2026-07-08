import React, { useState } from "react";
import { 
  auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, doc, setDoc, getDoc 
} from "../firebase";
import { UserProfile, UserRole } from "../types";
import { BookOpen, User, Lock, Mail, Users, ArrowRight, ShieldCheck, HelpCircle } from "lucide-react";

interface AuthGateProps {
  onAuthenticated: (profile: UserProfile) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ onAuthenticated }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("student");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isSignUp) {
        // Sign up with Firebase Auth
        if (!name.trim()) throw new Error("Please enter your full name.");
        
        const credentials = await createUserWithEmailAndPassword(auth, email, password);
        const userUid = credentials.user.uid;

        const profile: UserProfile = {
          uid: userUid,
          email,
          name,
          role,
          createdAt: new Date().toISOString(),
        };

        // Write to Firestore db
        await setDoc(doc(db, "users", userUid), profile);
        onAuthenticated(profile);
      } else {
        // Sign in
        const credentials = await signInWithEmailAndPassword(auth, email, password);
        const userUid = credentials.user.uid;

        // Fetch User profile
        const userDoc = await getDoc(doc(db, "users", userUid));
        if (userDoc.exists()) {
          onAuthenticated(userDoc.data() as UserProfile);
        } else {
          // If no doc exists (fallback), generate profile
          const profile: UserProfile = {
            uid: userUid,
            email,
            name: (credentials.user as any).displayName || email.split("@")[0],
            role: "student",
            createdAt: new Date().toISOString(),
          };
          await setDoc(doc(db, "users", userUid), profile);
          onAuthenticated(profile);
        }
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      let errMsg = err.message || "An authentication error occurred.";
      if (err.code === "auth/email-already-in-use") {
        errMsg = "This email address is already under use.";
      } else if (err.code === "auth/invalid-credential") {
        errMsg = "Invalid email or matching password combination.";
      } else if (err.code === "auth/weak-password") {
        errMsg = "Password should be at least 6 characters.";
      }
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Helper sandbox login to make reviewing or immediate multi-person testing super comfortable
   */
  const handleSandboxLogin = async (selectedRole: UserRole, sandboxName: string) => {
    setLoading(true);
    setError(null);
    try {
      // Use standard credentials for Sandbox to login seamlessly without prompting forms
      const sandboxEmail = `${selectedRole}_sandbox@edumeet.internal`;
      const sandboxPassword = "eduMeetSuperSafe99!";

      let firebaseUser: any = null;
      try {
        // Try logging in with Firebase Auth first
        const credentials = await signInWithEmailAndPassword(auth, sandboxEmail, sandboxPassword);
        firebaseUser = credentials.user;
      } catch (signinErr: any) {
        // If user credentials do not exist or are invalid, register a new sandbox user account
        if (signinErr.code === "auth/user-not-found" || signinErr.code === "auth/invalid-credential" || signinErr.code === "auth/wrong-password") {
          try {
            const credentials = await createUserWithEmailAndPassword(auth, sandboxEmail, sandboxPassword);
            firebaseUser = credentials.user;
          } catch (createErr) {
            console.warn("Failed creating sandbox user, trying to log in once more or propagating", createErr);
            throw signinErr;
          }
        } else {
          // Propagate network or other critical auth errors to trigger stable offline mode
          throw signinErr;
        }
      }

      if (firebaseUser) {
        // Ensure the matching profile is placed and loaded from Firestore DB
        let profile: UserProfile | null = null;
        try {
          const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
          if (userDoc && userDoc.exists()) {
            profile = userDoc.data() as UserProfile;
          }
        } catch (dbReadErr) {
          console.warn("Failed reading Sandbox profile from Firestore, using client sync placeholder:", dbReadErr);
        }

        if (!profile) {
          profile = {
            uid: firebaseUser.uid,
            email: sandboxEmail,
            name: sandboxName,
            role: selectedRole,
            createdAt: new Date().toISOString(),
          };
          try {
            await setDoc(doc(db, "users", firebaseUser.uid), profile);
          } catch (dbWriteErr) {
            console.warn("Could not save new user profile to Firestore database:", dbWriteErr);
          }
        }

        // Cache the active profile to localStorage to enable instant offline refresh matching
        localStorage.setItem("active_user_profile", JSON.stringify(profile));
        onAuthenticated(profile);
      }
    } catch (err: any) {
      console.warn("Firebase Sandbox auth failed or is offline. Activating stable role-based fallback:", err);
      
      // Generate or retrieve a consistent, non-random offline UID for testing continuity across refreshes
      const stableOfflineKey = `offline_uid_${selectedRole}`;
      let offlineUid = localStorage.getItem(stableOfflineKey);
      if (!offlineUid) {
        offlineUid = "offline_" + selectedRole + "_" + Math.floor(1000 + Math.random() * 9000);
        localStorage.setItem(stableOfflineKey, offlineUid);
      }

      const offlineProfile: UserProfile = {
        uid: offlineUid,
        email: `${selectedRole}_sandbox@edumeet.internal`,
        name: sandboxName + " (Offline Mode)",
        role: selectedRole,
        createdAt: new Date().toISOString()
      };
      
      localStorage.setItem("active_user_profile", JSON.stringify(offlineProfile));
      onAuthenticated(offlineProfile);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-slate-950 font-sans selection:bg-indigo-500/30 text-slate-200 p-6 md:p-12 relative overflow-hidden">
      {/* Background radial accent */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.08),transparent_70%)] pointer-events-none" />
      
      {/* Logo / Header */}
      <div className="flex items-center gap-2.5 mb-8 z-10">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <span className="font-extrabold text-base tracking-tight text-white block font-sans">EduClass Meet</span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-indigo-400 block">Interactive Classroom</span>
        </div>
      </div>

        
        {/* Interactive Classroom Sandbox Quick Access Toggles */}
        <div className="w-full max-w-md bg-slate-900 border border-white/5 rounded-2xl p-6 shadow-2xl mb-8">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h2 className="text-xs font-bold text-slate-200 tracking-wider uppercase">Sandbox Quick Access (Highly Recommended)</h2>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed mb-4">
            Skip writing register credentials by simulating a verified Sandbox profile immediately to test both perspectives simultaneously!
          </p>

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => handleSandboxLogin("teacher", "Dr. Sarah Jenkins")}
              className="py-2.5 px-2 bg-gradient-to-b from-indigo-900/30 to-indigo-950/40 hover:from-indigo-900/50 hover:to-indigo-950/60 text-indigo-300 font-semibold text-[11px] rounded-xl border border-indigo-500/20 text-center transition-all flex flex-col items-center gap-1.5 cursor-pointer shadow-[0_4px_12px_rgba(79,70,229,0.1)]"
            >
              <Users className="w-4 h-4 text-indigo-400" />
              <span>Dr. Sarah (Teacher)</span>
            </button>
            <button
              onClick={() => handleSandboxLogin("student", "Liam Thompson")}
              className="py-2.5 px-2 bg-gradient-to-b from-emerald-900/30 to-emerald-950/40 hover:from-emerald-900/50 hover:to-emerald-950/60 text-emerald-300 font-semibold text-[11px] rounded-xl border border-emerald-500/20 text-center transition-all flex flex-col items-center gap-1.5 cursor-pointer shadow-[0_4px_12px_rgba(16,185,129,0.1)]"
            >
              <User className="w-4 h-4 text-emerald-400" />
              <span>Liam (Student)</span>
            </button>
            <button
              onClick={() => handleSandboxLogin("admin", "Admin Registrar")}
              className="py-2.5 px-2 bg-gradient-to-b from-rose-900/30 to-rose-950/40 hover:from-rose-900/50 hover:to-rose-950/60 text-rose-300 font-semibold text-[11px] rounded-xl border border-rose-500/20 text-center transition-all flex flex-col items-center gap-1.5 cursor-pointer shadow-[0_4px_12px_rgba(244,63,94,0.1)]"
            >
              <Lock className="w-4 h-4 text-rose-450" />
              <span>Edu Admin</span>
            </button>
          </div>
        </div>

        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-extrabold text-slate-100 tracking-tight font-sans">
              {isSignUp ? "Create Virtual Account" : "Access Classroom Hub"}
            </h2>
            <p className="text-xs text-slate-400 mt-2">
              {isSignUp ? "Establish standard user status to register classroom links" : "Log in to join your teacher's scheduled meetings"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-305 text-xs font-semibold rounded-xl">
                {error}
              </div>
            )}

            {isSignUp && (
              <div>
                <label className="block text-xs font-bold text-slate-350 uppercase tracking-widest mb-1.5">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 w-4 h-4 text-indigo-400/70" />
                  <input
                    type="text"
                    required
                    placeholder="e.g., Prof. Carter"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 text-xs bg-slate-900 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 transition-all text-slate-100 placeholder:text-slate-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-350 uppercase tracking-widest mb-1.5">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 w-4 h-4 text-indigo-400/70" />
                <input
                  type="email"
                  required
                  placeholder="e.g., student@institute.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs bg-slate-900 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 transition-all text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-350 uppercase tracking-widest mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 w-4 h-4 text-indigo-400/70" />
                <input
                  type="password"
                  required
                  placeholder="Min 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs bg-slate-900 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 transition-all text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </div>

            {isSignUp && (
              <div>
                <label className="block text-xs font-bold text-slate-350 uppercase tracking-widest mb-1.5">Classroom Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 text-xs bg-slate-900 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 transition-all text-slate-100"
                >
                  <option value="student">Student (Joins Classroom Codes)</option>
                  <option value="teacher">Teacher (Creates Groups, Hosts and Previews Quizzes)</option>
                  <option value="admin">Super Admin (Institute Management)</option>
                </select>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-[0_0_20px_rgba(79,70,229,0.3)] hover:scale-[1.01] transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? "Authenticating Platform..." : isSignUp ? "Build Account" : "Access Terminal"}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>

          <div className="text-center mt-6">
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition-all"
            >
              {isSignUp ? "Already have an account? Log In" : "Need institutional access? Sign Up"}
            </button>
          </div>
        </div>
      </div>
    );
};
