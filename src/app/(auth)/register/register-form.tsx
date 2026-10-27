"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/kernel/auth/auth-client";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { registerErrorKey } from "./register-error";

export function RegisterForm() {
  const router = useRouter();
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // a message key, not a string: the message follows the page's language
  const [error, setError] = useState<MessageKey | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("auth.error.missingFields");
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
        setError(registerErrorKey(signUpResult.error));
        setLoading(false);
        return;
      }

      const orgName = t("auth.register.orgName", { name: name || email.split("@")[0] });
      const slug = `${(name || email.split("@")[0]).toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now()}`;

      const orgResult = await authClient.organization.create({
        name: orgName,
        slug,
      });

      if (orgResult.error) {
        setError("auth.register.error.setupIncomplete");
        setLoading(false);
        return;
      }

      const setActiveResult = await authClient.organization.setActive({
        organizationId: orgResult.data.id,
      });

      if (setActiveResult.error) {
        setError("auth.register.error.setupIncomplete");
        setLoading(false);
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("errors.generic");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-center text-2xl font-semibold">{t("auth.register.title")}</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="name" className="text-sm font-medium">
              {t("auth.field.name")}
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
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-border bg-background focus:border-ring focus:ring-ring/50 h-9 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2"
            />
          </div>

          {error === "auth.register.error.emailTaken" ? (
            <p className="text-destructive text-sm">
              {t(error)}{" "}
              <Link href="/login" className="underline">
                {t("auth.register.error.signInInstead")}
              </Link>
            </p>
          ) : error ? (
            <p className="text-destructive text-sm">{t(error)}</p>
          ) : null}

          <Button type="submit" disabled={loading} className="w-full" size="lg">
            {loading ? t("auth.register.submitting") : t("auth.register.submit")}
          </Button>
        </form>

        <p className="text-muted-foreground text-center text-sm">
          {t("auth.register.haveAccount")}{" "}
          <Link href="/login" className="text-foreground underline">
            {t("auth.register.signIn")}
          </Link>
        </p>
      </div>
    </main>
  );
}
