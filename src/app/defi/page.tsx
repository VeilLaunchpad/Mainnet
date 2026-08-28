import { redirect } from "next/navigation";

/** Renamed to /swap, which is what it actually is. */
export default function DefiRedirect() {
  redirect("/swap");
}
