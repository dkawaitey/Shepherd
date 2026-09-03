// Shared domain constants for Shepherd (safe to import from client and server).

export const ROLES = {
  ADMIN: "admin",
  COORDINATOR: "coordinator",
  WORKER: "worker",
  LEADER: "leader",
  CLASS_LEADER: "classLeader",
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<Role, string> = {
  [ROLES.ADMIN]: "Administrator",
  [ROLES.COORDINATOR]: "Evangelism Coordinator",
  [ROLES.WORKER]: "Follow-up Worker",
  [ROLES.LEADER]: "Read-only Leader",
  [ROLES.CLASS_LEADER]: "Class Leader",
};

/** Short capability notes shown in the Settings role picker. */
export const ROLE_NOTES: Record<Role, string> = {
  [ROLES.ADMIN]: "Full access, audit logs, settings, member control",
  [ROLES.COORDINATOR]: "Add contacts, assign workers, schedule, reports",
  [ROLES.WORKER]: "Assigned contacts, visits, prayers, progress",
  [ROLES.LEADER]: "View statistics, reports and dashboards only",
  [ROLES.CLASS_LEADER]: "Manage one class: contacts, workers, follow-ups, prayers, notes",
};

// ===== Ministry positions (Member Directory) =====
// The member's ministry position is the source of truth for system permissions:
// the linked user account inherits the corresponding system roles automatically.
export const POSITIONS = {
  ADMIN: "admin",
  COORDINATOR: "coordinator",
  CLASS_LEADER: "classLeader",
  WORKER: "worker",
  LEADER: "leader",
  MEMBER: "member",
} as const;
export type Position = (typeof POSITIONS)[keyof typeof POSITIONS];

export const POSITION_LABELS: Record<string, string> = {
  [POSITIONS.ADMIN]: "Administrator",
  [POSITIONS.COORDINATOR]: "Evangelism Coordinator",
  [POSITIONS.CLASS_LEADER]: "Class Leader",
  [POSITIONS.WORKER]: "Follow-up Worker",
  [POSITIONS.LEADER]: "Read-only Leader",
  [POSITIONS.MEMBER]: "Member",
};

export const POSITION_OPTIONS: Position[] = [
  POSITIONS.ADMIN,
  POSITIONS.COORDINATOR,
  POSITIONS.CLASS_LEADER,
  POSITIONS.WORKER,
  POSITIONS.LEADER,
  POSITIONS.MEMBER,
];

/** Effective ministry position, treating pre-position records (isClassLeader
 *  only) as Class Leader so existing data maps cleanly. */
export const effectivePosition = (
  position?: string,
  isClassLeader?: boolean,
): Position => {
  if (position && POSITION_OPTIONS.includes(position as Position)) {
    return position as Position;
  }
  return isClassLeader ? POSITIONS.CLASS_LEADER : POSITIONS.MEMBER;
};

/**
 * System roles derived from a member's ministry position. This is the single
 * mapping between the Member Directory and User Management:
 *   position -> system role(s)
 * An Administrator or Evangelism Coordinator may additionally lead a class
 * (isClassLeader) and then holds both their position role and the Class
 * Leader role (a dual role, like Administrator + Class Leader).
 */
export const deriveMemberRoles = (
  position?: string,
  isClassLeader?: boolean,
): Role[] => {
  const pos = effectivePosition(position, isClassLeader);
  switch (pos) {
    case POSITIONS.ADMIN:
      return isClassLeader ? [ROLES.ADMIN, ROLES.CLASS_LEADER] : [ROLES.ADMIN];
    case POSITIONS.CLASS_LEADER:
      return [ROLES.CLASS_LEADER];
    case POSITIONS.COORDINATOR:
      return isClassLeader
        ? [ROLES.COORDINATOR, ROLES.CLASS_LEADER]
        : [ROLES.COORDINATOR];
    case POSITIONS.WORKER:
      return [ROLES.WORKER];
    case POSITIONS.LEADER:
      return [ROLES.LEADER];
    default:
      return [];
  }
};

/** Access scope derived from a member's position + class. */
export const deriveMemberClassScope = (
  position?: string,
  isClassLeader?: boolean,
  klass?: string,
): string | undefined => {
  const pos = effectivePosition(position, isClassLeader);
  if (pos === POSITIONS.CLASS_LEADER) return klass;
  if (
    (pos === POSITIONS.ADMIN || pos === POSITIONS.COORDINATOR) &&
    isClassLeader
  ) {
    return klass;
  }
  return undefined;
};

// Spiritual journey stages (contact.status = furthest stage reached)
export const STAGES = {
  REACHED: "reached", // Met during outreach
  INTERESTED: "interested", // Wants more information
  FOLLOWUP_STARTED: "followupStarted", // First follow-up completed
  ACCEPTED_CHRIST: "acceptedChrist", // New convert
  BIBLE_STUDY: "bibleStudy", // Bible study started
  BAPTIZED: "baptized",
  JOINED_CHURCH: "joinedChurch",
  COMPLETED_DISCIPLESHIP: "completedDiscipleship",
  SERVING: "serving",
  LEADING: "leading",
} as const;
export type Stage = (typeof STAGES)[keyof typeof STAGES];

export const STAGE_ORDER: Stage[] = [
  STAGES.REACHED,
  STAGES.INTERESTED,
  STAGES.FOLLOWUP_STARTED,
  STAGES.ACCEPTED_CHRIST,
  STAGES.BIBLE_STUDY,
  STAGES.BAPTIZED,
  STAGES.JOINED_CHURCH,
  STAGES.COMPLETED_DISCIPLESHIP,
  STAGES.SERVING,
  STAGES.LEADING,
];

export const STAGE_LABELS: Record<Stage, string> = {
  [STAGES.REACHED]: "Met During Outreach",
  [STAGES.INTERESTED]: "Interested",
  [STAGES.FOLLOWUP_STARTED]: "First Follow-up Completed",
  [STAGES.ACCEPTED_CHRIST]: "Accepted Christ",
  [STAGES.BIBLE_STUDY]: "Bible Study Started",
  [STAGES.BAPTIZED]: "Baptized",
  [STAGES.JOINED_CHURCH]: "Joined Church",
  [STAGES.COMPLETED_DISCIPLESHIP]: "Completed Discipleship",
  [STAGES.SERVING]: "Serving",
  [STAGES.LEADING]: "Leading Others",
};

export const CONTACT_DECISIONS = {
  WANTS_INFO: "wantsInfo",
  ACCEPTED_CHRIST: "acceptedChrist",
  ALREADY_CHRISTIAN: "alreadyChristian",
  DECLINED: "declined",
  NOT_AVAILABLE: "notAvailable",
} as const;
export const DECISION_LABELS: Record<string, string> = {
  [CONTACT_DECISIONS.WANTS_INFO]: "Wants More Information",
  [CONTACT_DECISIONS.ACCEPTED_CHRIST]: "Accepted Christ",
  [CONTACT_DECISIONS.ALREADY_CHRISTIAN]: "Already Christian",
  [CONTACT_DECISIONS.DECLINED]: "Declined",
  [CONTACT_DECISIONS.NOT_AVAILABLE]: "Not Available",
};

export const INTEREST_LEVELS = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  VERY_HIGH: "veryHigh",
} as const;
export const INTEREST_LABELS: Record<string, string> = {
  [INTEREST_LEVELS.LOW]: "Low",
  [INTEREST_LEVELS.MEDIUM]: "Medium",
  [INTEREST_LEVELS.HIGH]: "High",
  [INTEREST_LEVELS.VERY_HIGH]: "Very High",
};

export const FOLLOWUP_TYPES = {
  HOME_VISIT: "homeVisit",
  PHONE_CALL: "phoneCall",
  WHATSAPP_CHAT: "whatsappChat",
  BIBLE_STUDY: "bibleStudy",
  PRAYER_VISIT: "prayerVisit",
  CHURCH_INVITATION: "churchInvitation",
  COUNSELLING: "counselling",
} as const;
export const FOLLOWUP_TYPE_LABELS: Record<string, string> = {
  [FOLLOWUP_TYPES.HOME_VISIT]: "Home Visit",
  [FOLLOWUP_TYPES.PHONE_CALL]: "Phone Call",
  [FOLLOWUP_TYPES.WHATSAPP_CHAT]: "WhatsApp Chat",
  [FOLLOWUP_TYPES.BIBLE_STUDY]: "Bible Study",
  [FOLLOWUP_TYPES.PRAYER_VISIT]: "Prayer Visit",
  [FOLLOWUP_TYPES.CHURCH_INVITATION]: "Church Invitation",
  [FOLLOWUP_TYPES.COUNSELLING]: "Counselling",
};

export const FOLLOWUP_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  MISSED: "missed",
  CANCELLED: "cancelled",
} as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUS)[keyof typeof FOLLOWUP_STATUS];
export const FOLLOWUP_STATUS_LABELS: Record<FollowupStatus, string> = {
  [FOLLOWUP_STATUS.PENDING]: "Pending",
  [FOLLOWUP_STATUS.COMPLETED]: "Completed",
  [FOLLOWUP_STATUS.MISSED]: "Missed",
  [FOLLOWUP_STATUS.CANCELLED]: "Cancelled",
};

// Status color coding: pending -> amber, completed -> green, missed -> red, cancelled -> grey
// Brightened for the dark terminal palette.
export const FOLLOWUP_STATUS_COLORS: Record<FollowupStatus, string> = {
  [FOLLOWUP_STATUS.PENDING]: "#f59e0b",
  [FOLLOWUP_STATUS.COMPLETED]: "#86efac",
  [FOLLOWUP_STATUS.MISSED]: "#f87171",
  [FOLLOWUP_STATUS.CANCELLED]: "#9ca3af",
};

export const CLASSES = {
  MILLISON: "Millison",
  REUBEN: "Reuben",
  JACOB: "Jacob",
  ROMINA: "Romina",
} as const;
export const CLASS_OPTIONS = [
  CLASSES.MILLISON,
  CLASSES.REUBEN,
  CLASSES.JACOB,
  CLASSES.ROMINA,
];

export const BIBLE_LESSONS = [
  "Salvation",
  "Prayer",
  "Bible Study",
  "The Holy Spirit",
  "Christian Living",
  "Church Fellowship",
  "Evangelism",
  "Stewardship",
] as const;

export const ATTENDANCE_TYPES = {
  SUNDAY_SERVICE: "sundayService",
  YOUTH_MEETING: "youthMeeting",
  BIBLE_STUDY: "bibleStudy",
  PRAYER_MEETING: "prayerMeeting",
  SPECIAL_PROGRAM: "specialProgram",
  MIDWEEK: "midweek",
} as const;
export const ATTENDANCE_TYPE_LABELS: Record<string, string> = {
  [ATTENDANCE_TYPES.SUNDAY_SERVICE]: "Sunday Service",
  [ATTENDANCE_TYPES.YOUTH_MEETING]: "Youth Meeting",
  [ATTENDANCE_TYPES.BIBLE_STUDY]: "Bible Study",
  [ATTENDANCE_TYPES.PRAYER_MEETING]: "Prayer Meeting",
  [ATTENDANCE_TYPES.SPECIAL_PROGRAM]: "Special Program",
  [ATTENDANCE_TYPES.MIDWEEK]: "Midweek Service",
};

export const ATTENDANCE_STATUS = {
  PRESENT: "present",
  ABSENT: "absent",
  EXCUSED: "excused",
} as const;
export const ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  [ATTENDANCE_STATUS.PRESENT]: "Present",
  [ATTENDANCE_STATUS.ABSENT]: "Absent",
  [ATTENDANCE_STATUS.EXCUSED]: "Excused",
};

export const PRAYER_STATUS = {
  ACTIVE: "active",
  ANSWERED: "answered",
  CLOSED: "closed",
} as const;
export const PRAYER_STATUS_LABELS: Record<string, string> = {
  [PRAYER_STATUS.ACTIVE]: "Active Prayer Request",
  [PRAYER_STATUS.ANSWERED]: "Answered Prayer",
  [PRAYER_STATUS.CLOSED]: "Closed Prayer Request",
};

export const NOTE_TYPES = {
  MINISTRY: "ministry",
  COUNSELLING: "counselling",
  PRIVATE: "private",
} as const;
export const NOTE_TYPE_LABELS: Record<string, string> = {
  [NOTE_TYPES.MINISTRY]: "Ministry Note",
  [NOTE_TYPES.COUNSELLING]: "Counselling Note",
  [NOTE_TYPES.PRIVATE]: "Confidential Note",
};

export const GENDERS = ["male", "female"] as const;
export const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
};

export const MARITAL_STATUSES = [
  "Single",
  "Married",
  "Engaged",
  "Divorced",
  "Widowed",
  "Prefer not to say",
];

export const MINISTRIES = [
  "Choir",
  "Instrumentalist",
  "Ushering",
  "Evangelism Team",
  "Youth Ministry",
  "Children's Ministry",
  "Media Team",
  "Prayer Team",
  "Discipleship Team",
  "Sunday School",
];

export const AREA_PRESETS = [
  { name: "Adjikpo", shortcut: "AD" },
  { name: "Atua", shortcut: "AT" },
  { name: "Odumasi", shortcut: "OD" },
];
