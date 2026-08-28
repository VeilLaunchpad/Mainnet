import { redirect } from "next/navigation";

/** Renamed to /desk: it is the private trading desk, not a generic trade page. */
export default function TradeRedirect() {
  redirect("/desk");
}
