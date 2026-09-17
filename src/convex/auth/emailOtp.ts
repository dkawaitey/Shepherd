import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
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
      throw new Error(JSON.stringify(error));
    }
  },
});
