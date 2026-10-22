import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Msg } from "@/kernel/i18n/msg";

export default function PartnerNotFound() {
  return (
    <div className="p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <Msg k="errors.partnerNotFound.title" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            <Msg k="errors.partnerNotFound.body" />
          </p>
          <Link
            href="/partners"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Msg k="errors.partnerNotFound.back" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
