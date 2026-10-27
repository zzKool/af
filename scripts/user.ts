// The admin CLI (F112, D61 — audit 2026-10-27 D6): the three things a one-owner box needs and the UI does not
// offer — create a user, set a password, add a member to the tenant — over Better Auth's own API, so the rows,
// hashes and hooks are the ones the app writes. No sign-up page needed (F105 closes it), no members UI (F03 parked).
//
//   npx tsx scripts/user.ts create <email> <name> [password]        # the password is prompted when omitted
//   npx tsx scripts/user.ts set-password <email> [password]
//   npx tsx scripts/user.ts add-member <email> <owner|member|editor> [tenant-slug]   # one tenant → no slug needed
//   npx tsx scripts/user.ts list
//
// On the box: `docker compose -f docker-compose.prod.yml run --rm app npx tsx scripts/user.ts …` is not possible
// (the runner image has no source tree) — run it from a checkout with `DATABASE_URL` pointing at the database
// (`docs/deployment.md`, *The first user*). Dev: `.env.local`.
import { createInterface } from "node:readline/promises";
import { auth } from "@/kernel/auth/auth";
import { KNOWN_ORG_ROLES } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function password(given: string | undefined): Promise<string> {
  const pw = given ?? (await ask("Password (min 8): "));
  if (pw.length < 8) throw new Error("the password needs at least 8 characters");
  return pw;
}

async function userByEmail(email: string) {
  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) throw new Error(`no user with the email ${email}`);
  return user;
}

async function create(email: string, name: string, pw: string | undefined) {
  const result = await auth.api.signUpEmail({
    body: { email, password: await password(pw), name },
  });
  console.log(
    `created ${result.user.email} (${result.user.id}); now add-member to give it a tenant`,
  );
}

async function setPassword(email: string, pw: string | undefined) {
  const user = await userByEmail(email);
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(await password(pw));
  await ctx.internalAdapter.updatePassword(user.id, hash);
  // every session of that user ends — the new password is the only way back in
  await prisma.session.deleteMany({ where: { userId: user.id } });
  console.log(`password set for ${email}; its sessions are signed out`);
}

async function addMember(email: string, role: string, slug: string | undefined) {
  if (!KNOWN_ORG_ROLES.includes(role)) {
    throw new Error(`role must be one of ${KNOWN_ORG_ROLES.join(" | ")}`);
  }
  const user = await userByEmail(email);
  const orgs = await prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
  const org = slug ? orgs.find((o) => o.slug === slug) : orgs.length === 1 ? orgs[0] : undefined;
  if (!org) {
    throw new Error(
      slug
        ? `no tenant with the slug ${slug}`
        : `several tenants — name one: ${orgs.map((o) => o.slug).join(", ")}`,
    );
  }
  const existing = await prisma.member.findFirst({
    where: { userId: user.id, organizationId: org.id },
  });
  if (existing) {
    await prisma.member.update({ where: { id: existing.id }, data: { role } });
    console.log(`${email} is now ${role} of ${org.name}`);
    return;
  }
  await prisma.member.create({
    data: { userId: user.id, organizationId: org.id, role, createdAt: new Date() },
  });
  console.log(`${email} added to ${org.name} as ${role}`);
}

async function list() {
  const members = await prisma.member.findMany({
    include: { user: true, organization: true },
    orderBy: [{ organizationId: "asc" }, { createdAt: "asc" }],
  });
  for (const m of members) console.log(`${m.organization.name}\t${m.role}\t${m.user.email}`);
  const orphans = await prisma.user.findMany({ where: { members: { none: {} } } });
  for (const u of orphans) console.log(`(no tenant)\t-\t${u.email}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "create":
      if (!args[0] || !args[1]) throw new Error("create <email> <name> [password]");
      return create(args[0], args[1], args[2]);
    case "set-password":
      if (!args[0]) throw new Error("set-password <email> [password]");
      return setPassword(args[0], args[1]);
    case "add-member":
      if (!args[0] || !args[1])
        throw new Error("add-member <email> <owner|member|editor> [tenant-slug]");
      return addMember(args[0], args[1], args[2]);
    case "list":
      return list();
    default:
      throw new Error("usage: user.ts create | set-password | add-member | list");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
