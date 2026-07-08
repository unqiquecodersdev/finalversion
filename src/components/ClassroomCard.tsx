import React, { useState } from "react";
import { Classroom, Meeting } from "../types";
import { BookOpen, Copy, Check, Calendar, Plus, Link, Video, AlertCircle, ArrowRight } from "lucide-react";

interface ClassroomCardProps {
  classroom: Classroom;
  activeMeetings: Meeting[];
  userRole: "student" | "teacher" | "admin";
  onSelect: () => void;
  onJoinMeeting: (meeting: Meeting) => void;
}

export const ClassroomCard: React.FC<ClassroomCardProps> = ({
  classroom,
  activeMeetings,
  userRole,
  onSelect,
  onJoinMeeting,
}) => {
  const [copied, setCopied] = useState(false);

  // Filter meetings specifically belonging to this classroom
  const activeClassMeetings = activeMeetings.filter(
    (m) => m.classroomId === classroom.id && m.status === "active"
  );

  const copyCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(classroom.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div 
      onClick={onSelect}
      className="bg-white border border-zinc-200/80 rounded-2xl p-6 hover:shadow-[0_8px_24px_rgba(99,102,241,0.06)] hover:border-indigo-500/70 hover:scale-[1.01] transition-all duration-200 cursor-pointer flex flex-col justify-between h-[210px] text-zinc-800 shadow-sm"
    >
      <div>
        <div className="flex items-start justify-between">
          <div className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-100">
            <BookOpen className="w-5 h-5 text-indigo-600" />
          </div>
          <button
            onClick={copyCode}
            className="px-2.5 py-1 text-[10px] font-mono font-medium rounded-lg bg-zinc-50 hover:bg-zinc-100 text-zinc-500 border border-zinc-200 flex items-center gap-1.5 transition-all cursor-pointer"
            title="Copy Join Code"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-indigo-500" />}
            Join Code: <span className="font-bold text-zinc-800">{classroom.code}</span>
          </button>
        </div>

        <h3 className="text-sm font-bold text-zinc-900 tracking-tight mt-4 truncate">
          {classroom.name}
        </h3>
        <p className="text-xs text-zinc-500 mt-1 line-clamp-2 leading-relaxed">
          {classroom.description || "No description provided for this online educational folder."}
        </p>
      </div>

      <div className="pt-4 border-t border-zinc-100 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-400">
          <span>Instructor:</span>
          <span className="font-semibold text-zinc-700">{classroom.teacherName}</span>
        </div>

        {activeClassMeetings.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onJoinMeeting(activeClassMeetings[0]);
              }}
              className="py-1 px-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] rounded-lg shadow-[0_2px_8px_rgba(244,63,94,0.2)] transition-all flex items-center gap-1 cursor-pointer"
            >
              <Video className="w-3 h-3 animate-pulse" />
              Join Live
            </button>
          </div>
        ) : (
          <div className="text-[10px] text-zinc-400 flex items-center gap-1 uppercase tracking-wider font-mono">
            <span>No Active Class</span>
            <ArrowRight className="w-3 h-3 text-indigo-400/50" />
          </div>
        )}
      </div>
    </div>
  );
};
