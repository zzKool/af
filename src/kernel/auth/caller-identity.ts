/** Application roles (constitution §6, D15). The Better Auth organisation role is mapped by roleFromMembership(). */
export type Role = "superadmin" | "owner" | "accountant" | "editor";

export type CallerIdentity = {
  userId: string;
  tenantId: string;
  role: Role;
  source: "web" | "mcp" | "cli" | "system" | "seed";
};
