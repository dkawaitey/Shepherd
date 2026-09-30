import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Plus, XCircle } from "lucide-react";

/**
 * Class-scoped assigned-worker picker.
 *
 * A follow-up or contact worker is expected to be a member of the class the
 * record belongs to, so this suggests names from that class instead of
 * accepting free text. A name can still be typed as a fallback for legacy
 * records, but the member list is the primary path — it keeps the stored name
 * resolvable so reminders reach a real account.
 */
export function WorkerPicker({
  value,
  onChange,
  members,
  loading,
  placeholder = "Select a class member",
}: {
  value: string;
  onChange: (v: string) => void;
  members: { _id: string; fullName: string; membershipId?: string }[];
  loading?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.toLowerCase().trim();
  const filtered = q
    ? members.filter((m) =>
        [m.fullName, m.membershipId]
          .filter(Boolean)
          .some((f) => f!.toLowerCase().includes(q)),
      )
    : members;
  const typedName = query.trim();
  const exactMatch = members.some(
    (m) => m.fullName.toLowerCase() === typedName.toLowerCase(),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search class members..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {loading ? "Loading members..." : "No members in this class."}
            </CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value="__clear"
                  onSelect={() => {
                    onChange("");
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <XCircle className="mr-2 h-4 w-4 opacity-60" />
                  Clear assignment
                </CommandItem>
              )}
              {filtered.map((m) => (
                <CommandItem
                  key={m._id}
                  value={m.fullName}
                  onSelect={() => {
                    onChange(m.fullName);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      value === m.fullName ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex-1 truncate">{m.fullName}</span>
                  {m.membershipId && (
                    <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">
                      {m.membershipId}
                    </span>
                  )}
                </CommandItem>
              ))}
              {typedName && !exactMatch && (
                <CommandItem
                  value="__custom"
                  onSelect={() => {
                    onChange(typedName);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4 opacity-60" />
                  Use “{typedName}”
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
