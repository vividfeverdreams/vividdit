"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  Disc3,
  Mail,
  GraduationCap,
  Settings,
  ShieldCheck,
} from "lucide-react"

import { cn } from "@/lib/utils"

const items = [
  { href: "/dashboard", label: "Download Gates", icon: Disc3 },
  { href: "/dashboard/reviews", label: "Reviews", icon: ShieldCheck },
  { href: "/dashboard/fans", label: "Fans", icon: Mail },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
]

// Creator's YouTube tutorial playlist — opens in a new tab.
const TUTORIALS_URL =
  "https://youtube.com/playlist?list=PLWmaqUTb9eUAeX43wnZnAqngAN_GfA1MT"

export function DashboardNav() {
  const pathname = usePathname()

  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5">
      {items.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        )
      })}
      <a
        href={TUTORIALS_URL}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <GraduationCap className="size-4" />
        Tutorials
      </a>
    </nav>
  )
}
