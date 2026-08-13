import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CLASS_OPTIONS, ROLE_LABELS, Role } from "@/convex/constants";
import { FlaskConical } from "lucide-react";

const TEST_ROLES: Role[] = ["coordinator", "worker", "leader", "classLeader"];

/** Admin-only: impersonate another role to preview the app exactly as that
 *  role sees it — including the permission checks, server-side. */
export function TestAsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const me = useQuery(api.users.currentUser);
  const setTestAs = useMutation(api.users.setTestAs);
  const [role, setRole] = useState<Role>("worker");
  const [klass, setKlass] = useState<string>(CLASS_OPTIONS[0]);
  const [busy, setBusy] = useState(false);

  const active = !!me?.testAs;
  const activeLabel = me?.testAs ? (ROLE_LABELS[me.testAs as Role] ?? me.testAs) : "";

  const start = async () => {
    setBusy(true);
    try {
      await setTestAs({
        role,
        classScope: role === "classLeader" ? klass : undefined,
      });
      toast.success(`Testing as ${ROLE_LABELS[role]}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start test");
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    setBusy(true);
    try {
      await setTestAs({ role: undefined });
      toast.success("Test ended — back to your normal role");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to end test");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" /> Test as another role
          </DialogTitle>
          <DialogDescription>
            Administrators can preview the app exactly as another role sees it —
            including what that role cannot do. Everything is enforced server-side.
          </DialogDescription>
        </DialogHeader>

        {active ? (
          <div className="rounded-md border border-[#f59e0b]/40 bg-[#2e2408] px-3 py-2.5 text-[11px] text-[#fbbf24]">
            Currently testing as <b>{activeLabel}</b>
            {me?.testAs === "classLeader" && me?.classScope
              ? ` · ${me.classScope} Class`
              : ""}
            . Your permissions are those of that role until you end the test.
          </div>
        ) : null}

        <div className="space-y-3">
          <div>
            <Label htmlFor="test-role">Role to test as</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as Role)}
              disabled={active}
            >
              <SelectTrigger id="test-role" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEST_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {role === "classLeader" && (
            <div>
              <Label htmlFor="test-class">Class scope</Label>
              <Select
                value={klass}
                onValueChange={setKlass}
                disabled={active}
              >
                <SelectTrigger id="test-class" className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLASS_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c} Class
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {active ? (
            <Button variant="destructive" onClick={end} disabled={busy}>
              {busy ? "Ending..." : "End test"}
            </Button>
          ) : (
            <Button onClick={start} disabled={busy}>
              {busy ? "Starting..." : "Start test"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
