"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Hint } from "@/components/ui/Field";
import { createAssetAction, saveDocumentAction, type HrFormState } from "./actions";

const DOC_STATUSES = [
  { value: "PENDING", label: "Pending" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "VERIFIED", label: "Verified" },
  { value: "REJECTED", label: "Rejected" },
  { value: "EXPIRED", label: "Expired" },
];

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function AssetForm() {
  const [state, formAction] = useActionState<HrFormState, FormData>(createAssetAction, {});

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="itemName">Item</Label>
          <Input id="itemName" name="itemName" required placeholder="MacBook Pro 14" />
        </div>
        <div>
          <Label htmlFor="assetTag">Asset tag</Label>
          <Input id="assetTag" name="assetTag" placeholder="NG-LT-014" />
        </div>
      </div>

      <div>
        <Label htmlFor="serialNumber">Serial number</Label>
        <Input id="serialNumber" name="serialNumber" />
        <Hint>The asset keeps its full history as it moves between people.</Hint>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <Submit label="Register asset" />
    </form>
  );
}

export function DocumentForm({
  people,
}: {
  people: { personId: string; name: string }[];
}) {
  const [state, formAction] = useActionState<HrFormState, FormData>(saveDocumentAction, {});

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="personId">Person</Label>
          <Select id="personId" name="personId" required>
            {people.map((p) => (
              <option key={p.personId} value={p.personId}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="docType">Document type</Label>
          <Input id="docType" name="docType" required placeholder="Passport" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue="PENDING">
            {DOC_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="expiryDate">Expiry date</Label>
          <Input id="expiryDate" name="expiryDate" type="date" />
        </div>
        <div>
          <Label htmlFor="verifiedAt">Date verified</Label>
          <Input id="verifiedAt" name="verifiedAt" type="date" />
          <Hint>
            When the check actually happened. Leave blank to record it as today.
          </Hint>
        </div>
      </div>

      <div>
        <Label htmlFor="externalLink">Link to the document</Label>
        <Input id="externalLink" name="externalLink" type="url" placeholder="https://…" />
        <Hint>
          Store the file in your secure drive and paste the link. No files are uploaded here.
        </Hint>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <Submit label="Save record" />
    </form>
  );
}
