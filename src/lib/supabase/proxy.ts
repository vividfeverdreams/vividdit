import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const PROTECTED_PREFIXES = ["/dashboard", "/onboarding", "/get-access"]
const AUTH_PAGES = ["/login", "/signup"]

// Refreshes the auth session on every request and enforces login for the
// creator area. Profile-completeness (onboarding) checks live in the
// dashboard layout — they need a DB read, which doesn't belong here.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Do not run code between createServerClient and getClaims() — a subtle
  // bug window where the session can be desynced from cookies.
  const { data } = await supabase.auth.getClaims()
  const isAuthed = !!data?.claims

  const path = request.nextUrl.pathname

  const redirectTo = (target: string) => {
    const url = request.nextUrl.clone()
    url.pathname = target
    url.search = ""
    const response = NextResponse.redirect(url)
    // Preserve refreshed session cookies on the redirect.
    supabaseResponse.cookies.getAll().forEach(({ name, value }) => {
      response.cookies.set(name, value)
    })
    return response
  }

  if (!isAuthed && PROTECTED_PREFIXES.some((p) => path.startsWith(p))) {
    return redirectTo("/login")
  }

  if (isAuthed && AUTH_PAGES.some((p) => path === p)) {
    return redirectTo("/dashboard")
  }

  return supabaseResponse
}
