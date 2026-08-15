import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  ATTENDANCE_STATUS,
  ATTENDANCE_TYPES,
  FOLLOWUP_STATUS,
  FOLLOWUP_TYPES,
  INTEREST_LEVELS,
  PRAYER_STATUS,
  STAGES,
} from "./constants";

export const roleValidator = v.union(
  v.literal("admin"),
  v.literal("coordinator"),
  v.literal("worker"),
  v.literal("leader"),
  v.literal("classLeader"),
);

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // default users table (auth). do not remove
    users: defineTable({
      name: v.optional(v.string()), // do not remove
      image: v.optional(v.string()), // do not remove
      email: v.optional(v.string()), // do not remove
      emailVerificationTime: v.optional(v.number()), // do not remove
      isAnonymous: v.optional(v.boolean()), // do not remove

      role: v.optional(roleValidator), // primary role (kept for display / back-compat)
      roles: v.optional(v.array(v.string())), // all assigned roles (a user may hold several)
      classScope: v.optional(v.string()), // class a Class Leader is locked to (Millison/Reuben/Jacob/Romina)
      phone: v.optional(v.string()), // contact number for workers
      testAs: v.optional(v.string()), // admin-only role impersonation for testing
      testClassScope: v.optional(v.string()), // class used while testing as a class leader
      memberId: v.optional(v.id("members")), // linked member record from the Members module (one-to-one)
      rolesOverridden: v.optional(v.boolean()), // admin manually overrode the roles derived from the member's position
    }).index("email", ["email"]), // do not remove or modify

    // ===== Contacts (people reached during outreach) =====
    contacts: defineTable({
      membershipId: v.string(),
      fullName: v.string(),
      gender: v.optional(v.union(v.literal("male"), v.literal("female"))),
      dateOfBirth: v.optional(v.string()),
      phone: v.optional(v.string()),
      whatsapp: v.optional(v.string()),
      email: v.optional(v.string()),
      homeAddress: v.optional(v.string()),
      landmark: v.optional(v.string()),
      gpsLocation: v.optional(v.string()),
      region: v.optional(v.string()),
      district: v.optional(v.string()),
      community: v.optional(v.string()),
      occupation: v.optional(v.string()),
      school: v.optional(v.string()),
      maritalStatus: v.optional(v.string()),
      emergencyContact: v.optional(v.string()),
      preferredLanguage: v.optional(v.string()),
      religion: v.optional(v.string()),
      churchBackground: v.optional(v.string()),

      // outreach / evangelism record
      area: v.optional(v.string()),
      areaShortcut: v.optional(v.string()),
      dateMet: v.optional(v.string()),
      locationMet: v.optional(v.string()),
      evangelismTeam: v.optional(v.string()),
      klass: v.optional(v.string()), // Millison / Reuben / Jacob / Romina
      street: v.optional(v.string()),
      event: v.optional(v.string()),
      conversationSummary: v.optional(v.string()),
      questionsAsked: v.optional(v.string()),
      needsIdentified: v.optional(v.string()),
      prayerOffered: v.optional(v.boolean()),
      outreachPrayerRequests: v.optional(v.string()),
      bibleVersesShared: v.optional(v.string()),
      gospelShared: v.optional(v.boolean()),
      decision: v.optional(v.string()),
      interestLevel: v.optional(
        v.union(
          v.literal(INTEREST_LEVELS.LOW),
          v.literal(INTEREST_LEVELS.MEDIUM),
          v.literal(INTEREST_LEVELS.HIGH),
          v.literal(INTEREST_LEVELS.VERY_HIGH),
        ),
      ),

      // discipleship assignment
      status: v.optional(
        v.union(
          v.literal(STAGES.REACHED),
          v.literal(STAGES.INTERESTED),
          v.literal(STAGES.FOLLOWUP_STARTED),
          v.literal(STAGES.ACCEPTED_CHRIST),
          v.literal(STAGES.BIBLE_STUDY),
          v.literal(STAGES.BAPTIZED),
          v.literal(STAGES.JOINED_CHURCH),
          v.literal(STAGES.COMPLETED_DISCIPLESHIP),
          v.literal(STAGES.SERVING),
          v.literal(STAGES.LEADING),
        ),
      ),
      assignedWorker: v.optional(v.string()), // display name
      assignedWorkerId: v.optional(v.id("users")),
      mentor: v.optional(v.string()),
      ministry: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      promotedToMemberId: v.optional(v.id("members")), // set when promoted

      isDeleted: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("membershipId", ["membershipId"])
      .index("status", ["status"])
      .index("isDeleted", ["isDeleted"])
      .index("assignedWorkerId", ["assignedWorkerId"]),

    // ===== Spiritual journey timeline =====
    journeyEvents: defineTable({
      contactId: v.id("contacts"),
      stage: v.string(),
      label: v.string(),
      date: v.string(), // ISO date
      note: v.optional(v.string()),
      worker: v.optional(v.string()),
      source: v.union(v.literal("auto"), v.literal("manual")),
      createdAt: v.number(),
    }).index("contactId", ["contactId"]),

    // ===== Follow-ups =====
    followUps: defineTable({
      contactId: v.id("contacts"),
      type: v.union(
        v.literal(FOLLOWUP_TYPES.HOME_VISIT),
        v.literal(FOLLOWUP_TYPES.PHONE_CALL),
        v.literal(FOLLOWUP_TYPES.WHATSAPP_CHAT),
        v.literal(FOLLOWUP_TYPES.BIBLE_STUDY),
        v.literal(FOLLOWUP_TYPES.PRAYER_VISIT),
        v.literal(FOLLOWUP_TYPES.CHURCH_INVITATION),
        v.literal(FOLLOWUP_TYPES.COUNSELLING),
      ),
      date: v.string(), // ISO date
      assignedWorker: v.optional(v.string()),
      notes: v.optional(v.string()),
      reminder: v.optional(v.boolean()),
      status: v.union(
        v.literal(FOLLOWUP_STATUS.PENDING),
        v.literal(FOLLOWUP_STATUS.COMPLETED),
        v.literal(FOLLOWUP_STATUS.MISSED),
        v.literal(FOLLOWUP_STATUS.CANCELLED),
      ),
      outcome: v.optional(v.string()),
      reasonMissed: v.optional(v.string()),
      reasonCancelled: v.optional(v.string()),
      completedDate: v.optional(v.string()),
      locked: v.optional(v.boolean()),
      isDeleted: v.optional(v.boolean()),
      createdAt: v.number(),
    })
      .index("contactId", ["contactId"])
      .index("status", ["status"])
      .index("date", ["date"]),

    // ===== Bible study tracking (8 fixed lessons) =====
    bibleStudies: defineTable({
      contactId: v.id("contacts"),
      lesson: v.number(), // 1-8
      status: v.union(
        v.literal("notStarted"),
        v.literal("inProgress"),
        v.literal("completed"),
      ),
      instructor: v.optional(v.string()),
      notes: v.optional(v.string()),
      instructorObservations: v.optional(v.string()),
      scriptureUsed: v.optional(v.string()),
      questionsAskedByContact: v.optional(v.string()),
      completedDate: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("contactId", ["contactId"])
      .index("lesson", ["lesson"]),

    // ===== Attendance (contacts + youth members) =====
    attendance: defineTable({
      subjectType: v.union(v.literal("contact"), v.literal("member")),
      contactId: v.optional(v.id("contacts")),
      memberId: v.optional(v.id("members")),
      date: v.string(), // ISO date
      type: v.union(
        v.literal(ATTENDANCE_TYPES.SUNDAY_SERVICE),
        v.literal(ATTENDANCE_TYPES.YOUTH_MEETING),
        v.literal(ATTENDANCE_TYPES.BIBLE_STUDY),
        v.literal(ATTENDANCE_TYPES.PRAYER_MEETING),
        v.literal(ATTENDANCE_TYPES.SPECIAL_PROGRAM),
        v.literal(ATTENDANCE_TYPES.MIDWEEK),
      ),
      programName: v.optional(v.string()),
      status: v.union(
        v.literal(ATTENDANCE_STATUS.PRESENT),
        v.literal(ATTENDANCE_STATUS.ABSENT),
        v.literal(ATTENDANCE_STATUS.EXCUSED),
      ),
      remarks: v.optional(v.string()),
      recordedBy: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("date", ["date"])
      .index("contactId", ["contactId"])
      .index("memberId", ["memberId"])
      .index("type", ["type"]),

    // ===== Prayer journal =====
    prayerRequests: defineTable({
      contactId: v.optional(v.id("contacts")),
      memberId: v.optional(v.id("members")),
      title: v.string(),
      summary: v.string(),
      status: v.union(
        v.literal(PRAYER_STATUS.ACTIVE),
        v.literal(PRAYER_STATUS.ANSWERED),
        v.literal(PRAYER_STATUS.CLOSED),
      ),
      answer: v.optional(v.string()),
      confidential: v.optional(v.boolean()),
      updatedAt: v.number(),
      createdAt: v.number(),
    })
      .index("contactId", ["contactId"])
      .index("memberId", ["memberId"])
      .index("status", ["status"]),

    // ===== Ministry / private notes =====
    notes: defineTable({
      contactId: v.optional(v.id("contacts")),
      memberId: v.optional(v.id("members")),
      author: v.optional(v.string()),
      authorId: v.optional(v.id("users")),
      type: v.union(
        v.literal("ministry"),
        v.literal("counselling"),
        v.literal("private"),
      ),
      content: v.string(),
      isPrivate: v.optional(v.boolean()),
      createdAt: v.number(),
    })
      .index("contactId", ["contactId"])
      .index("memberId", ["memberId"]),

    // ===== Youth Ministry members (attendance module) =====
    members: defineTable({
      membershipId: v.string(),
      fullName: v.string(),
      gender: v.optional(v.union(v.literal("male"), v.literal("female"))),
      phone: v.optional(v.string()),
      whatsapp: v.optional(v.string()),
      email: v.optional(v.string()),
      klass: v.optional(v.string()), // Millison / Reuben / Jacob / Romina
      area: v.optional(v.string()), // area used for the membership ID
      dateJoined: v.optional(v.string()),
      classLeader: v.optional(v.string()),
      ministryRoles: v.optional(v.string()),
      status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
      occupation: v.optional(v.string()),
      position: v.optional(
        v.union(
          v.literal("admin"),
          v.literal("coordinator"),
          v.literal("classLeader"),
          v.literal("worker"),
          v.literal("leader"),
          v.literal("member"),
        ),
      ), // ministry position — the source of truth for system roles
      isClassLeader: v.optional(v.boolean()), // legacy: class-leader flag (kept in sync with position)
      sourceContactId: v.optional(v.id("contacts")), // set when promoted from a contact
      attendanceFollowup: v.optional(
        v.object({
          date: v.string(), // ISO date the follow-up happened
          outcome: v.string(),
          by: v.optional(v.string()),
        }),
      ), // last low-attendance follow-up (recorded from the Attendance page)
      isDeleted: v.optional(v.boolean()),

      // Steward member sync (cross-app member exchange)
      stewardId: v.optional(v.string()), // the member's id in the Steward app
      stewardUpdatedAt: v.optional(v.number()), // last-modified timestamp from Steward (conflict resolution)
      syncedAt: v.optional(v.number()), // last time this record was written by the sync

      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("class", ["klass"])
      .index("status", ["status"])
      .index("membershipId", ["membershipId"]),

    // ===== Notifications / reminders =====
    notifications: defineTable({
      userId: v.id("users"),
      title: v.string(),
      message: v.string(),
      type: v.optional(v.string()),
      link: v.optional(v.string()),
      read: v.optional(v.boolean()),
      createdAt: v.number(),
    }).index("userId", ["userId"]),

    // ===== Audit logs =====
    auditLogs: defineTable({
      userId: v.optional(v.id("users")),
      userName: v.optional(v.string()),
      action: v.string(),
      entityType: v.string(),
      entityId: v.optional(v.string()),
      details: v.optional(v.string()),
      createdAt: v.number(),
    }).index("createdAt", ["createdAt"]),

    // ===== Team posts / announcements (internal content + comments) =====
    posts: defineTable({
      author: v.optional(v.string()),
      authorId: v.optional(v.id("users")),
      title: v.string(),
      body: v.string(),
      tags: v.optional(v.array(v.string())),
      isPinned: v.optional(v.boolean()),
      isDeleted: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("createdAt", ["createdAt"]),

    comments: defineTable({
      postId: v.id("posts"),
      author: v.optional(v.string()),
      authorId: v.optional(v.id("users")),
      body: v.string(),
      isDeleted: v.optional(v.boolean()),
      createdAt: v.number(),
    }).index("postId", ["postId"]),

    // ===== Ministry settings (key/value) =====
    settings: defineTable({
      key: v.string(),
      value: v.string(),
      updatedAt: v.number(),
    }).index("key", ["key"]),

    // ===== Sent emails (reminder digests, tests) =====
    emailLogs: defineTable({
      to: v.string(),
      subject: v.string(),
      kind: v.string(), // workerFollowups | classDigest | test
      userId: v.optional(v.id("users")),
      status: v.union(v.literal("sent"), v.literal("failed")),
      error: v.optional(v.string()),
      createdAt: v.number(),
    }).index("createdAt", ["createdAt"]),

    // ===== Sequence counters (membership IDs, per area+date) =====
    counters: defineTable({
      name: v.string(),
      value: v.number(),
    }).index("name", ["name"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
