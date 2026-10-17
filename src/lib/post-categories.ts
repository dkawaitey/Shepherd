/**
 * How a post category is drawn.
 *
 * The values and labels live in convex/constants.ts because the server
 * validates against them; the icon each one shows is a client concern, so it
 * lives here and is shared by the feed and the constitution page.
 */
import {
  BookOpen,
  FileBarChart,
  FileText,
  Image,
  Megaphone,
  NotebookPen,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { POST_CATEGORY_LABELS, postCategory } from "@/convex/constants";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  announcement: Megaphone,
  constitution: ScrollText,
  form: FileText,
  report: FileBarChart,
  minutes: NotebookPen,
  resource: BookOpen,
  media: Image,
};

/** Label and icon for a post's category, with the announcement fallback. */
export function categoryMeta(value?: string | null): {
  value: string;
  label: string;
  Icon: LucideIcon;
} {
  const key = postCategory(value);
  return {
    value: key,
    label: POST_CATEGORY_LABELS[key] ?? "Announcement",
    Icon: CATEGORY_ICONS[key] ?? Megaphone,
  };
}
