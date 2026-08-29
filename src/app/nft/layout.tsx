"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const TABS = [
  { href: "/nft", label: "Marketplace" },
  { href: "/nft/studio", label: "Studio" },
  { href: "/nft/stake", label: "Stake" },
  { href: "/nft/activity", label: "Activity" },
  { href: "/nft/profile", label: "Profile" },
];

export default function NFTLayout({ children }: { children: ReactNode }) {
  const path = usePathname();

  return (
    <div className="pb-20">
      <div className="sticky top-[57px] z-30 border-b border-white/[0.06] bg-ink/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1400px] items-center gap-1 overflow-x-auto px-4 py-2 sm:px-6">
          {TABS.map((t) => {
            const active = t.href === "/nft" ? path === "/nft" : path.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={
                  "whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition " +
                  (active ? "bg-white/10 text-white" : "text-white/45 hover:text-white/80")
                }
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="pt-6">{children}</div>
    </div>
  );
}
