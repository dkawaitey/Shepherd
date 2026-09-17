/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as constants from "../constants.js";
import type * as contacts from "../contacts.js";
import type * as crons from "../crons.js";
import type * as customerio from "../customerio.js";
import type * as dashboard from "../dashboard.js";
import type * as discipleship from "../discipleship.js";
import type * as emailHtml from "../emailHtml.js";
import type * as emails from "../emails.js";
import type * as errorLogs from "../errorLogs.js";
import type * as followups from "../followups.js";
import type * as helpers from "../helpers.js";
import type * as http from "../http.js";
import type * as members from "../members.js";
import type * as notificationQueries from "../notificationQueries.js";
import type * as notifications from "../notifications.js";
import type * as posts from "../posts.js";
import type * as push from "../push.js";
import type * as pushNode from "../pushNode.js";
import type * as pushScheduler from "../pushScheduler.js";
import type * as rateLimit from "../rateLimit.js";
import type * as reminders from "../reminders.js";
import type * as reports from "../reports.js";
import type * as settings from "../settings.js";
import type * as users from "../users.js";
import type * as validate from "../validate.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  "auth/emailOtp": typeof auth_emailOtp;
  constants: typeof constants;
  contacts: typeof contacts;
  crons: typeof crons;
  customerio: typeof customerio;
  dashboard: typeof dashboard;
  discipleship: typeof discipleship;
  emailHtml: typeof emailHtml;
  emails: typeof emails;
  errorLogs: typeof errorLogs;
  followups: typeof followups;
  helpers: typeof helpers;
  http: typeof http;
  members: typeof members;
  notificationQueries: typeof notificationQueries;
  notifications: typeof notifications;
  posts: typeof posts;
  push: typeof push;
  pushNode: typeof pushNode;
  pushScheduler: typeof pushScheduler;
  rateLimit: typeof rateLimit;
  reminders: typeof reminders;
  reports: typeof reports;
  settings: typeof settings;
  users: typeof users;
  validate: typeof validate;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
