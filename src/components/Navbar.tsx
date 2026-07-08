import React, { useState, useEffect } from "react";
import { LogOut, User, Compass, BookOpen, Shield, ChevronDown } from "lucide-react";
import { UserProfile } from "../types";

interface NavbarProps {
  user: UserProfile | null;
  onLogout: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ user, onLogout, activeTab, setActiveTab }) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    if (!dropdownOpen) return;
    const closeDropdown = () => setDropdownOpen(false);
    document.addEventListener("click", closeDropdown);
    return () => document.removeEventListener("click", closeDropdown);
  }, [dropdownOpen]);

  const getInitials = (name: string) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();
  };

  return (
    <header className="border-b border-white/10 bg-black sticky top-0 z-40 px-6 py-3.5 flex items-center justify-between text-slate-200 shadow-md">
      {/* Left side: Logo only (clickable to return to classrooms) */}
      <button 
        onClick={() => setActiveTab("classrooms")}
        className="flex items-center gap-3 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
        title="Go to Classrooms"
      >
        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-semibold shadow-[0_0_20px_rgba(79,70,229,0.4)] transition-all hover:scale-105 active:scale-95">
          <BookOpen className="w-5 h-5 text-zinc-50" />
        </div>
      </button>

      {/* Right side: Profile avatar and dropdown */}
      <div className="flex items-center gap-4">
        {user && (
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDropdownOpen(!dropdownOpen);
              }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-slate-800/50 transition-all focus:outline-none cursor-pointer group"
            >
              {/* Profile Avatar with radial gradient */}
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-400 text-white font-mono font-bold text-xs flex items-center justify-center border-2 border-indigo-500/50 group-hover:border-indigo-400 transition-all shadow-sm">
                {getInitials(user.name)}
              </div>
              
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 transition-transform duration-250 ${dropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <div 
                className="absolute right-0 mt-2.5 w-64 bg-slate-950 border border-white/10 rounded-2xl shadow-xl shadow-black/40 overflow-hidden divide-y divide-white/5 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                onClick={(e) => e.stopPropagation()}
              >
                {/* User Info Header */}
                <div className="p-4 space-y-1.5 bg-slate-900/50">
                  <span className="block text-xs font-extrabold text-slate-100 truncate">{user.name}</span>
                  <span className="block text-[10px] text-slate-400 truncate tracking-tight">{user.email}</span>
                  
                  {/* Role Badge */}
                  <div className="pt-1">
                    {user.role === "teacher" && (
                      <span className="inline-flex bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase font-mono">
                        Teacher Mode
                      </span>
                    )}
                    {user.role === "student" && (
                      <span className="inline-flex bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase font-mono">
                        Student Room
                      </span>
                    )}
                    {user.role === "admin" && (
                      <span className="inline-flex bg-rose-500/15 text-rose-300 border border-rose-500/20 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase font-mono items-center gap-0.5">
                        <Shield className="w-2.5 h-2.5" /> Super Admin
                      </span>
                    )}
                  </div>
                </div>

                {/* Mobile/Responsive Navigation Links inside Dropdown */}
                <div className="p-1.5 space-y-0.5">
                  <button
                    onClick={() => {
                      setActiveTab("classrooms");
                      setDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-all ${
                      activeTab === "classrooms"
                        ? "bg-indigo-600/20 text-indigo-300 font-semibold"
                        : "text-slate-400 hover:text-slate-100 hover:bg-slate-900"
                    }`}
                  >
                    <Compass className="w-4 h-4 shrink-0" />
                    Classrooms
                  </button>
                  
                  <button
                    onClick={() => {
                      setActiveTab("profile");
                      setDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-all ${
                      activeTab === "profile"
                        ? "bg-indigo-600/20 text-indigo-300 font-semibold"
                        : "text-slate-400 hover:text-slate-100 hover:bg-slate-900"
                    }`}
                  >
                    <User className="w-4 h-4 shrink-0" />
                    My Portal
                  </button>

                  {user.role === "admin" && (
                    <button
                      onClick={() => {
                      setActiveTab("admin");
                      setDropdownOpen(false);
                    }}
                      className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-all ${
                        activeTab === "admin"
                          ? "bg-rose-600/20 text-rose-300 font-semibold"
                          : "text-slate-400 hover:text-rose-400 hover:bg-slate-900"
                      }`}
                    >
                      <Shield className="w-4 h-4 shrink-0" />
                      Admin Control
                    </button>
                  )}
                </div>

                {/* Logout Button Action */}
                <div className="p-1.5 bg-slate-950">
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      onLogout();
                    }}
                    className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold text-rose-400 hover:text-white hover:bg-rose-500/10 flex items-center gap-2.5 transition-all cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 shrink-0" />
                    Logout Account
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
