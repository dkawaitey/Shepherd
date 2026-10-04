import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { ConvexError } from "convex/values";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

/**
 * Key used to send the one-time sign-in code.
 *
 * Override it by setting `VLY_OTP_EMAIL_API_KEY` in the project's Keys tab —
 * the template's shared key remains the fallback so sign-in keeps working until
 * a replacement is configured. (This file is otherwise template-owned: see the
 * note in README.md — do not change the provider id or token generation.)
 */
const OTP_EMAIL_API_KEY =
  process.env.VLY_OTP_EMAIL_API_KEY ||
  "fb_email_2crN1hqIArZP2bEfvjp5Qik4";

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  // This function can be asynchronous
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array<ArrayBuffer>) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    try {
      await axios.post(
        "https://auth.freebuff.app/send_otp",
        {
          to: email,
          otp: token,
          appName: process.env.VLY_APP_NAME || "a freebuff.com application",
        },
        {
          headers: {
            "x-api-key": OTP_EMAIL_API_KEY,
          },
        },
      );
    } catch (error) {
      // Log a short, non-sensitive reason server-side only. Never surface the
      // raw axios error to the client: its `config.headers` carries the API
      // key, so the old `JSON.stringify(error)` leaked the key into the browser
      // console and the admin error log. The client gets a clean message.
      const detail = axios.isAxiosError(error)
        ? `HTTP ${error.response?.status ?? "-"} (${error.code ?? "network error"})`
        : error instanceof Error
          ? error.message
          : "unknown error";
      console.error(`[auth:emailOtp] Failed to send verification code: ${detail}`);
      throw new ConvexError(
        "Could not send the verification code right now. Please try again.",
      );
    }
  },
});
