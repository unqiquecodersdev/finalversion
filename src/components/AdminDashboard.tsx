import React, { useState, useEffect } from "react";
import { UserProfile, Meeting, Classroom, UserRole } from "../types";
import { db, collection, onSnapshot, doc, updateDoc, deleteDoc, getDocs } from "../firebase";
import { 
  Users, Shield, Search, Trash2, Edit2, Check, X, 
  BookOpen, Video, Calendar, Eye, UserPlus, Key 
} from "lucide-react";

interface AdminDashboardProps {
  currentUser: UserProfile;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ currentUser }) => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);

  // Search and editing state
  const [searchQuery, setSearchQuery] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingRole, setEditingRole] = useState<UserRole>("student");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Sync real-time metrics
  useEffect(() => {
    setLoading(true);
    
    // Subscribe to all Users
    const unsubUsers = onSnapshot(collection(db, "users"), (snapshot) => {
      const uList: UserProfile[] = [];
      snapshot.forEach((d) => {
        uList.push(d.data() as UserProfile);
      });
      // Sort: Admin first, then newest/alphabetical
      uList.sort((a, b) => {
        if (a.role === "admin" && b.role !== "admin") return -1;
        if (b.role === "admin" && a.role !== "admin") return 1;
        return a.name.localeCompare(b.name);
      });
      setUsers(uList);
      setLoading(false);
    }, (err) => {
      console.error("Firestore user sub failed:", err);
      setLoading(false);
    });

    // Subscribe to all meetings (running, ended, upcoming)
    const unsubMeetings = onSnapshot(collection(db, "meetings"), (snapshot) => {
      const mList: Meeting[] = [];
      snapshot.forEach((d) => {
        mList.push(d.data() as Meeting);
      });
      setMeetings(mList);
    });

    // Subscribe to all Classrooms
    const unsubClasses = onSnapshot(collection(db, "classrooms"), (snapshot) => {
      const cList: Classroom[] = [];
      snapshot.forEach((d) => {
        cList.push(d.data() as Classroom);
      });
      setClassrooms(cList);
    });

    return () => {
      unsubUsers();
      unsubMeetings();
      unsubClasses();
    };
  }, []);

  // Compute key stats
  const totalStudentsCount = users.filter(u => u.role === "student").length;
  const totalTeachersCount = users.filter(u => u.role === "teacher").length;
  const totalAdminsCount = users.filter(u => u.role === "admin").length;

  const runningCalls = meetings.filter(m => m.status === "active").length;
  const upcomingCalls = meetings.filter(m => m.status === "scheduled").length;
  const endedCalls = meetings.filter(m => m.status === "ended").length;

  // Handle Edit User Submit
  const handleSaveEdit = async (uid: string) => {
    setActionError(null);
    setActionSuccess(null);
    if (!editingName.trim()) {
      setActionError("User display name cannot be blank.");
      return;
    }

    try {
      await updateDoc(doc(db, "users", uid), {
        name: editingName.trim(),
        role: editingRole
      });
      setActionSuccess(`Successfully updated configuration for user ID: ${uid}`);
      setEditingUserId(null);
    } catch (e: any) {
      console.error(e);
      setActionError(`Failed to update user profile: ${e?.message || e}`);
    }
  };

  // Handle Delete User
  const handleDeleteUser = async (uid: string, userName: string) => {
    setActionError(null);
    setActionSuccess(null);
    if (uid === currentUser.uid) {
      setActionError("For security reasons, you cannot delete your own active running administrator profile.");
      return;
    }

    if (!window.confirm(`Are you sure you want to permanently remove user "${userName}" from the virtual academy? This action is irreversible.`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, "users", uid));
      setActionSuccess(`Successfully deregistered and removed "${userName}" credentials.`);
    } catch (e: any) {
      console.error(e);
      setActionError(`Failed to delete user profile from Firestore: ${e?.message || e}`);
    }
  };

  // Filter users list based on search bar
  const filteredUsers = users.filter(u => {
    const term = searchQuery.toLowerCase();
    return u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term) || u.uid.toLowerCase().includes(term);
  });

  return (
    <div className="max-w-6xl mx-auto py-10 px-6 space-y-10 text-zinc-800">
      
      {/* Admin Title HUD */}
      <div className="bg-gradient-to-r from-zinc-900 to-slate-950 text-white rounded-3xl p-8 md:p-10 shadow-lg relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(244,63,94,0.12),transparent_50%)]" />
        <div className="relative z-10 space-y-3">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded bg-rose-500/10 text-rose-450 font-mono tracking-wider font-bold text-[10px] uppercase border border-rose-500/20 flex items-center gap-1">
              <Shield className="w-3 h-3" /> System Security Operations
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight font-sans text-zinc-50">
            Academy Management Console
          </h1>
          <p className="text-zinc-400 text-xs leading-relaxed max-w-2xl">
            Monitor real-time virtual metrics, audit classroom directories, and configure global roles for academic users across the EduClass online network.
          </p>
        </div>
      </div>

      {actionError && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-805 text-xs font-semibold rounded-2xl flex items-center gap-2">
          <X className="w-4 h-4 text-rose-600 shrink-0" onClick={() => setActionError(null)} />
          <span>{actionError}</span>
        </div>
      )}

      {actionSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-805 text-xs font-semibold rounded-2xl flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" onClick={() => setActionSuccess(null)} />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Metrics Bento Grid */}
      <div className="space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 font-mono flex items-center gap-2">
          <Video className="w-4 h-4 text-indigo-500" />
          Realtime Academy Metrics
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          
          {/* Running calls */}
          <div className="bg-white p-5 border border-zinc-150 rounded-2xl shadow-sm hover:border-emerald-200 hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <span className="block text-[10px] font-bold uppercase text-zinc-400 tracking-wider">Running Calls</span>
              <span className="text-3xl font-extrabold text-emerald-600 block mt-2 font-mono">
                {runningCalls}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping inline-block" />
              <span>Live Streams Active</span>
            </div>
          </div>

          {/* Upcoming calls */}
          <div className="bg-white p-5 border border-zinc-150 rounded-2xl shadow-sm hover:border-indigo-200 hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <span className="block text-[10px] font-bold uppercase text-zinc-400 tracking-wider">Upcoming Calls</span>
              <span className="text-3xl font-extrabold text-indigo-600 block mt-2 font-mono">
                {upcomingCalls}
              </span>
            </div>
            <div className="mt-3 text-[10px] text-zinc-400 font-medium">
              <span>Scheduled Sessions</span>
            </div>
          </div>

          {/* Ended calls */}
          <div className="bg-white p-5 border border-zinc-150 rounded-2xl shadow-sm hover:border-zinc-300 hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <span className="block text-[10px] font-bold uppercase text-zinc-400 tracking-wider">Ended Calls</span>
              <span className="text-3xl font-extrabold text-zinc-700 block mt-2 font-mono">
                {endedCalls}
              </span>
            </div>
            <div className="mt-3 text-[10px] text-zinc-400 font-medium">
              <span>Lessons Archived</span>
            </div>
          </div>

          {/* Students registered */}
          <div className="bg-white p-5 border border-zinc-150 rounded-2xl shadow-sm hover:border-blue-200 hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <span className="block text-[10px] font-bold uppercase text-zinc-400 tracking-wider">Active Students</span>
              <span className="text-3xl font-extrabold text-blue-600 block mt-2 font-mono">
                {totalStudentsCount}
              </span>
            </div>
            <div className="mt-3 text-[10px] text-zinc-400 font-medium">
              <span>Enrolled scholars</span>
            </div>
          </div>

          {/* Teachers registered */}
          <div className="bg-white p-5 border border-zinc-150 rounded-2xl shadow-sm hover:border-amber-200 hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <span className="block text-[10px] font-bold uppercase text-zinc-400 tracking-wider">Active Teachers</span>
              <span className="text-3xl font-extrabold text-amber-600 block mt-2 font-mono">
                {totalTeachersCount}
              </span>
            </div>
            <div className="mt-3 text-[10px] text-zinc-400 font-medium">
              <span>Curriculum Leads</span>
            </div>
          </div>

          {/* Total Classrooms */}
          <div className="bg-white p-5 border border-zinc-150 rounded-2xl shadow-sm hover:border-zinc-300 hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <span className="block text-[10px] font-bold uppercase text-zinc-400 tracking-wider">Total Folders</span>
              <span className="text-3xl font-extrabold text-black block mt-2 font-mono">
                {classrooms.length}
              </span>
            </div>
            <div className="mt-3 text-[10px] text-zinc-400 font-medium">
              <span>Course Groups Build</span>
            </div>
          </div>

        </div>
      </div>

      {/* Users Management list */}
      <div className="bg-white border border-zinc-150 rounded-3xl p-6 md:p-8 space-y-6 shadow-sm">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-100 pb-5">
          <div>
            <h2 className="text-sm font-bold uppercase text-zinc-900 tracking-wider flex items-center gap-2">
              <Users className="w-4 h-4 text-rose-500" /> Users & Role Registries
            </h2>
            <p className="text-xs text-zinc-405 mt-1 font-medium">Edit display names, change platform roles, or de-register user accounts.</p>
          </div>

          {/* Search bar */}
          <div className="relative max-w-xs w-full">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search name, email, or UID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:border-rose-500 text-zinc-805"
            />
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-zinc-450 font-mono">
            <span className="animate-spin inline-block w-5 h-5 border-2 border-rose-500 border-t-transparent rounded-full mr-2.5 vertical-middle" />
            <span>Loading database profiles...</span>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-zinc-200 rounded-2xl">
            <p className="text-xs text-zinc-400">No users match your query filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-zinc-650 border-collapse">
              <thead>
                <tr className="border-b border-zinc-100 text-zinc-400 font-mono uppercase text-[9.5px] tracking-wider bg-zinc-50">
                  <th className="py-3 px-4">User Identity Info</th>
                  <th className="py-3 px-4">Unique User ID (UID)</th>
                  <th className="py-3 px-4">Academy Role Assign</th>
                  <th className="py-3 px-4 text-right">Actions Panel</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 font-sans">
                {filteredUsers.map((u) => {
                  const isEditing = editingUserId === u.uid;

                  return (
                    <tr key={u.uid} className="hover:bg-zinc-50 transition-colors">
                      
                      {/* Name & Email detail */}
                      <td className="py-4 px-4 font-sans max-w-[220px]">
                        {isEditing ? (
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-white border border-zinc-200 rounded-lg focus:border-indigo-500 text-zinc-900 font-bold"
                            />
                            <span className="block text-[10px] text-zinc-400 truncate">{u.email}</span>
                          </div>
                        ) : (
                          <div>
                            <span className="block font-bold text-zinc-900 leading-tight">
                              {u.name}
                            </span>
                            <span className="text-[10px] text-zinc-400 tracking-tight leading-none block mt-0.5 whitespace-nowrap">
                              {u.email}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Unique UID */}
                      <td className="py-4 px-4 font-mono text-[10px] text-zinc-450 tracking-tight select-all">
                        {u.uid}
                      </td>

                      {/* User Role */}
                      <td className="py-4 px-4">
                        {isEditing ? (
                          <select
                            value={editingRole}
                            onChange={(e) => setEditingRole(e.target.value as UserRole)}
                            className="px-2 py-1.5 bg-white border border-zinc-200 rounded-lg focus:border-indigo-500 font-medium"
                          >
                            <option value="student">Student</option>
                            <option value="teacher">Teacher</option>
                            <option value="admin">Super Admin</option>
                          </select>
                        ) : (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded font-mono font-bold uppercase text-[9.5px] border ${
                            u.role === "admin" 
                              ? "bg-rose-50 text-rose-700 border-rose-100" 
                              : u.role === "teacher" 
                                ? "bg-indigo-50 text-indigo-700 border-indigo-100" 
                                : "bg-emerald-50 text-emerald-750 border-emerald-100"
                          }`}>
                            {u.role}
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-2 text-zinc-500">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => handleSaveEdit(u.uid)}
                                className="p-1.5 text-emerald-600 bg-emerald-50 hover:bg-emerald-150 rounded-lg transition-all"
                                title="Save Profile changes"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingUserId(null)}
                                className="p-1.5 text-zinc-400 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-all"
                                title="Cancel modification"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setEditingUserId(u.uid);
                                  setEditingName(u.name);
                                  setEditingRole(u.role);
                                }}
                                className="p-1.5 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded-lg transition-all"
                                title="Edit display credentials and privileges"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteUser(u.uid, u.name)}
                                disabled={u.uid === currentUser.uid}
                                className={`p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all ${
                                  u.uid === currentUser.uid ? "opacity-30 cursor-not-allowed" : ""
                                }`}
                                title={u.uid === currentUser.uid ? "You cannot delete yourself" : "Delete user profile permanently"}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
};
