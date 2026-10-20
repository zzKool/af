"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/kernel/auth/auth-client";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Please fill in all fields.");
      return;
    }

    setLoading(true);
    try {
      const signUpResult = await authClient.signUp.email({
        email,
        password,
        name: name || email.split("@")[0],
      });

      if (signUpResult.error) {
        if (
          signUpResult.error.code === "USER_ALREADY_EXISTS" ||
          signUpResult.error.message?.includes("already")
        ) {
          setError("EMAIL_TAKEN");
          setLoading(false);
          return;
        }
        setError(signUpResult.error.message ?? "Registration failed.");
        setLoading(false);
        return;
      }

      const orgName = `${name || email.split("@")[0]}'s Business`;
      const slug = `${(name || email.split("@")[0]).toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now()}`;

      const orgResult = await authClient.organization.create({
        name: orgName,
        slug,
      });

      if (orgResult.error) {
        setError("Account created but setup incomplete. Please try again.");
        setLoading(false);
        return;
      }

      const setActiveResult = await authClient.organization.setActive({
        organizationId: orgResult.data.id,
      });

      if (setActiveResult.error) {
        setError("Account created but setup incomplete. Please try again.");
        setLoading(false);
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-center text-2xl font-semibold">Create account</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-border bg-background focus:border-ring focus:ring-ring/50 h-9 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-border bg-background focus:border-ring focus:ring-ring/50 h-9 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-border bg-background focus:border-ring focus:ring-ring/50 h-9 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2"
            />
          </div>

          {error === "EMAIL_TAKEN" ? (
            <p className="text-destructive text-sm">
              This email already has an account.{" "}
              <Link href="/login" className="underline">
                Sign in instead?
              </Link>
            </p>
          ) : error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : null}

          <Button type="submit" disabled={loading} className="w-full" size="lg">
            {loading ? "Creating account..." : "Create account"}
          </Button>
        </form>

        <p className="text-muted-foreground text-center text-sm">
          Already have an account?{" "}
          <Link href="/login" className="text-foreground underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
