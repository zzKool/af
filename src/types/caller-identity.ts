export type CallerIdentity = {
  userId: string;
  tenantId: string;
  role: "owner" | "accountant";
  source: "web" | "api" | "system" | "seed";
};
