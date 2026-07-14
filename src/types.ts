export type UserRole = "student" | "teacher" | "admin";

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

export interface Classroom {
  id: string;
  name: string;
  description: string;
  teacherId: string;
  teacherName: string;
  code: string;
  studentIds: string[];
  createdAt: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswerIndex: number;
  category?: string;
}

export interface Meeting {
  id: string;
  classroomId: string;
  classroomName: string;
  title: string;
  description: string;
  discussionMaterial: string;
  scheduledAt?: string;
  status: "scheduled" | "active" | "ended";
  quizzes: QuizQuestion[];
  recordedQuizzes: QuizQuestion[];
  hostId: string;
  hostName: string;
  aiSummary?: string;
  createdAt: string;
  quizTriggerInterval?: number;
  liveQuizGenerationEnabled?: boolean;
  activeVerificationDisabled?: boolean;
  duration?: number;
  liveQuizDisabled?: boolean;
  recordedVideoUrl?: string;
  screenShareBy?: string | null;
  screenShareByName?: string | null;
}

export interface StudentQuizSubmission {
  quizIndex: number;
  selectedIndex: number;
  isCorrect: boolean;
}

export interface MeetingResponse {
  id: string; // usually meetingId + "_" + userId
  meetingId: string;
  userId: string;
  userName: string;
  activePopupShown: number;
  activePopupClicked: number;
  quizAnswers: StudentQuizSubmission[];
  overallPercentage: number;
  missedLive: boolean; // True if answered during asynchronous playback
  updatedAt: string;
}
