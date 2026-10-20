// Registration of every module's linkable. Importing this file (done by index.ts and the actions) is what
// makes an entity type known to the linking module. New module → add one line here.
import { contractLinkable } from "@/modules/contracts";
import { documentLinkable } from "@/modules/documents";
import { invoiceLinkable } from "@/modules/invoices";
import { partnerLinkable } from "@/modules/partners";
import { registerLinkable } from "./linkable";

for (const l of [partnerLinkable, contractLinkable, documentLinkable, invoiceLinkable])
  registerLinkable(l);
