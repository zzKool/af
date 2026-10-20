"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/kernel/auth/auth-client";

export default function LoginPage() {
  const router = useRouter();
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
    const result = await authClient.signIn.email({
      email,
      password,
    });

    if (result.error) {
      setError("Email or password didn't match. Try again or create an account.");
      setLoading(false);
      return;
    }

    // Set active organization so the dashboard layout gets a valid tenantId
    const orgs = await authClient.organization.list();
    if (orgs.data && orgs.data.length > 0) {
      await authClient.organization.setActive({
        organizationId: orgs.data[0].id,
      });
    }

    router.push("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-center text-2xl font-semibold">Sign in</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
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
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-border bg-background focus:border-ring focus:ring-ring/50 h-9 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2"
            />
          </div>

          {error && (
            <p className="text-destructive text-sm">
              {error}{" "}
              <Link href="/register" className="underline">
                Create an account
              </Link>
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full" size="lg">
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <p className="text-muted-foreground text-center text-sm">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-foreground underline">
            Register
          </Link>
        </p>
      </div>
    </main>
  );
}
