"use client";

import type { DocumentReviewData } from "@/server/services/documents";

// Placeholder — full implementation in Task 6
export function DocumentReviewClient({ data }: { data: DocumentReviewData }) {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <p>Document review: {data.businessKey}</p>
    </div>
  );
}
