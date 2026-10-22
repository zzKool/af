"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/kernel/auth/auth-client";
import { useT } from "@/kernel/i18n/use-t";

export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError(t("auth.error.missingFields"));
      return;
    }

    setLoading(true);
    const result = await authClient.signIn.email({
      email,
      password,
    });

    if (result.error) {
      setError(t("auth.login.error.mismatch"));
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
        <h1 className="text-center text-2xl font-semibold">{t("auth.login.title")}</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              {t("auth.field.email")}
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
              {t("auth.field.password")}
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
                {t("auth.login.createAccount")}
              </Link>
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full" size="lg">
            {loading ? t("auth.login.submitting") : t("auth.login.submit")}
          </Button>
        </form>

        <p className="text-muted-foreground text-center text-sm">
          {t("auth.login.noAccount")}{" "}
          <Link href="/register" className="text-foreground underline">
            {t("auth.login.register")}
          </Link>
        </p>
      </div>
    </main>
  );
}
