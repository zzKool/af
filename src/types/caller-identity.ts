export type CallerIdentity = {
  userId: string;
  tenantId: string;
  role: "owner" | "accountant";
  source: string;
};
