export type AuditLogger = {
  log: (params: {
    action: "create" | "update" | "delete" | "deactivate" | "reactivate";
    entityType: string;
    entityId: string;
    oldData?: Record<string, unknown> | null;
    newData?: Record<string, unknown> | null;
  }) => Promise<void>;
};
