import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { ArrowRight, Loader2, Mail, UserX } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch (error) {
      console.error("Email sign-in error:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to send verification code. Please try again.",
      );
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      navigate(redirect);
    } catch (error) {
      console.error("OTP verification error:", error);
      setError("The verification code you entered is incorrect.");
      setIsLoading(false);
      setOtp("");
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn("anonymous");
      navigate(redirect);
    } catch (error) {
      console.error("Guest login error:", error);
      setError(
        `Failed to sign in as guest: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen flex-col">
        <header className="border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
            <Link to="/" className="flex items-center gap-2">
              {/* Light mode: ministry logo image */}
              <div className="h-7 w-7 shrink-0 overflow-hidden rounded-md dark:hidden">
                <img
                  src="/sidebar-logo.png"
                  alt="Shepherd logo"
                  className="h-full w-full object-contain mix-blend-multiply"
                />
              </div>
              {/* Dark mode: transparent logo */}
              <div className="hidden h-7 w-7 shrink-0 overflow-hidden rounded-md dark:block">
                <img
                  src="/sidebarr-logo.png"
                  alt="Shepherd logo"
                  className="h-full w-full object-contain"
                />
              </div>
              <span className="text-sm font-bold tracking-[0.16em]">SHEPHERD</span>
            </Link>
            <ThemeToggle />
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="w-full max-w-md">
            <Card className="border shadow-lg">
              {step === "signIn" ? (
                <>
                  <CardHeader className="text-center">
                    {/* Light mode: ministry logo image */}
                    <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-primary/20 bg-card dark:hidden">
                      <img
                        src="/sidebar-logo.png"
                        alt="Shepherd logo"
                        className="h-full w-full object-contain mix-blend-multiply"
                      />
                    </div>
                    {/* Dark mode: transparent logo */}
                    <div className="mx-auto mb-3 hidden h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-primary/20 bg-card dark:flex">
                      <img
                        src="/sidebarr-logo.png"
                        alt="Shepherd logo"
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <CardTitle className="text-xl">Get Started</CardTitle>
                    <CardDescription>
                      Enter your ministry email to log in or sign up
                    </CardDescription>
                  </CardHeader>
                  <form onSubmit={handleEmailSubmit}>
                    <CardContent>
                      <div className="relative flex items-center gap-2">
                        <div className="relative flex-1">
                          <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            name="email"
                            placeholder="name@gethsemane.org"
                            type="email"
                            className="pl-9"
                            disabled={isLoading}
                            required
                          />
                        </div>
                        <Button
                          type="submit"
                          variant="outline"
                          size="icon"
                          disabled={isLoading}
                        >
                          {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ArrowRight className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      {error && (
                        <p className="mt-2 text-xs text-destructive">{error}</p>
                      )}

                      <div className="mt-4">
                        <div className="relative">
                          <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                          </div>
                          <div className="relative flex justify-center text-[10px] uppercase tracking-widest">
                            <span className="bg-card px-2 text-muted-foreground">
                              or
                            </span>
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          className="mt-4 w-full"
                          onClick={handleGuestLogin}
                          disabled={isLoading}
                        >
                          <UserX className="mr-2 h-4 w-4" />
                          Continue as Guest
                        </Button>
                        <p className="mt-2 text-center text-[10px] text-muted-foreground">
                          Guests can explore the system — the first account
                          becomes the Administrator.
                        </p>
                      </div>
                    </CardContent>
                  </form>
                </>
              ) : (
                <>
                  <CardHeader className="text-center">
                    <CardTitle>Check your email</CardTitle>
                    <CardDescription>
                      We've sent a code to {step.email}
                    </CardDescription>
                  </CardHeader>
                  <form onSubmit={handleOtpSubmit}>
                    <CardContent className="pb-4">
                      <input type="hidden" name="email" value={step.email} />
                      <input type="hidden" name="code" value={otp} />

                      <div className="flex justify-center">
                        <InputOTP
                          value={otp}
                          onChange={setOtp}
                          maxLength={6}
                          disabled={isLoading}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                              const form = (e.target as HTMLElement).closest("form");
                              if (form) form.requestSubmit();
                            }
                          }}
                        >
                          <InputOTPGroup>
                            {Array.from({ length: 6 }).map((_, index) => (
                              <InputOTPSlot key={index} index={index} />
                            ))}
                          </InputOTPGroup>
                        </InputOTP>
                      </div>
                      {error && (
                        <p className="mt-2 text-center text-xs text-destructive">
                          {error}
                        </p>
                      )}
                      <p className="mt-4 text-center text-sm text-muted-foreground">
                        Didn't receive a code?{" "}
                        <Button
                          variant="link"
                          className="h-auto p-0"
                          onClick={() => setStep("signIn")}
                        >
                          Try again
                        </Button>
                      </p>
                    </CardContent>
                    <CardFooter className="flex-col gap-2">
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={isLoading || otp.length !== 6}
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Verifying...
                          </>
                        ) : (
                          <>
                            Verify code
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setStep("signIn")}
                        disabled={isLoading}
                        className="w-full"
                      >
                        Use different email
                      </Button>
                    </CardFooter>
                  </form>
                </>
              )}

              <div className="border-t px-6 py-3 text-center text-[11px] text-muted-foreground">
                <Link
                  to="/"
                  className="underline-offset-2 hover:text-foreground hover:underline"
                >
                  ← back to home
                </Link>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
