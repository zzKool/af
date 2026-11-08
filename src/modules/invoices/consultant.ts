// The consultant printed on an invoice (F145, the owner's invoice: "Consultant: …"): the employee the contract is
// assigned to. Null without a contract or an assignment — the line is then left out.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as contracts from "@/modules/contracts";
import * as partners from "@/modules/partners";

export async function consultantName(
  tx: TransactionClient,
  contractId: string | null,
): Promise<string | null> {
  if (!contractId) return null;
  const contract = await contracts.getContract(tx, contractId);
  const employeeId = contract.data?.assignedEmployeeId;
  if (!employeeId) return null;
  return (await partners.partnerNames(tx, [employeeId])).get(employeeId) ?? null;
}
