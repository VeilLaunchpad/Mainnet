import { redirect } from "next/navigation";

/**
 * The wallet lives inside the dashboard now. Kept as a redirect so links and
 * bookmarks that predate the move still land somewhere sensible.
 */
export default function WalletRedirect() {
  redirect("/dashboard?tab=wallet");
}
