/**
 * How each reaction looks in the UI: a Lucide icon and its colour.
 *
 * Reaction kinds and labels come from the shared constants (the server
 * validates against them), but icons are a client concern — the Convex bundle
 * has no business importing React components. One mapping here means the feed,
 * the comment thread and the engagement details all draw the same thing.
 */

import {
  Church,
  HandHeart,
  Heart,
  PartyPopper,
  type LucideIcon,
} from "lucide-react";
import { REACTIONS } from "@/convex/constants";

const REACTION_STYLES: Record<string, { Icon: LucideIcon; className: string }> = {
  like: { Icon: Heart, className: "fill-rose-500 text-rose-500" },
  amen: { Icon: HandHeart, className: "text-amber-500" },
  pray: { Icon: Church, className: "text-sky-500" },
  celebrate: { Icon: PartyPopper, className: "text-fuchsia-500" },
};

/** Unknown kinds (rows written under an older naming) still render. */
const FALLBACK_STYLE = REACTION_STYLES.like;

export type ReactionMeta = {
  kind: string;
  label: string;
  Icon: LucideIcon;
  className: string;
};

/** Icon, colour, kind and label for one reaction kind. */
export function reactionMeta(kind: string): ReactionMeta {
  const known = REACTIONS.find((r) => r.kind === kind);
  return {
    kind: known?.kind ?? "like",
    label: known?.label ?? "Like",
    ...(REACTION_STYLES[kind] ?? FALLBACK_STYLE),
  };
}

/** The picker's palette, in the order the shared constants declare. */
export const REACTION_PALETTE: ReactionMeta[] = REACTIONS.map((r) =>
  reactionMeta(r.kind),
);
