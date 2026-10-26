import { ArrowRight, Check, ChartColumn, Mail, ShieldCheck, Link2 } from "lucide-react"
import Link from "next/link"

import { InstagramIcon, SoundCloudIcon } from "@/components/brand-icons"
import { createClient } from "@/lib/supabase/server"

// The artist whose live page the landing links to and whose latest release
// fills the phone mockup.
const FEATURED_ARTIST = "vividfeverdreams"

async function loadFeatured() {
  try {
    const supabase = await createClient()
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, artist_name, artist_slug")
      .eq("artist_slug", FEATURED_ARTIST)
      .maybeSingle()
    if (!profile) return null
    const { data: gates } = await supabase
      .from("gates")
      .select("title, artist, cover_path, theme")
      .eq("creator_id", profile.id)
      .eq("kind", "single")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(10)
    // Covers are either uploaded (cover_path) or the track's SoundCloud artwork.
    const withCover = (gates ?? [])
      .map((g) => ({
        title: g.title,
        artist: g.artist,
        cover: g.cover_path
          ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/covers/${g.cover_path}`
          : ((g.theme as { artworkUrl?: string | null } | null)?.artworkUrl ?? null),
      }))
      .find((g) => g.cover)
    return { profile, gate: withCover ?? null }
  } catch {
    return null
  }
}

const STEPS = [
  {
    title: "Add your track",
    body: "Paste the SoundCloud link and upload the WAV. Cover art and colors come from the track.",
  },
  {
    title: "Pick the asks",
    body: "Email plus a follow or two. With Quick unlock, fans just tap through: no screenshots.",
  },
  {
    title: "Share the link",
    body: "Put it in your SoundCloud buy link and your bio. Fans unlock in three taps.",
  },
]

const FEATURES = [
  {
    Icon: Mail,
    title: "Your email list",
    body: "Every fan who opts in is yours. Export it to Mailchimp anytime.",
  },
  {
    Icon: ShieldCheck,
    title: "Quick or Verified",
    body: "Tap-through by default. Turn on screenshot checks for exclusive drops.",
  },
  {
    Icon: ChartColumn,
    title: "Honest stats",
    body: "Real visitors, not page loads, and a funnel per song showing where fans drop.",
  },
  {
    Icon: Link2,
    title: "One link for everything",
    body: "Your artist page lists every free download, with the full vault on top.",
  },
]

const FAQ = [
  {
    q: "Is it free?",
    a: "Yes. Vividdit is free for artists. Fan emails go out through your own Resend account, and Verified gates use your own AI key, so nobody bills you for your fans.",
  },
  {
    q: "Does SoundCloud allow this?",
    a: "Vividdit doesn't connect to SoundCloud's API; fans follow and like on their own account, in the app. Some platforms restrict requiring follows in exchange for a download, so review their terms. Vividdit isn't affiliated with SoundCloud, Instagram or Spotify.",
  },
  {
    q: "Do fans need to send screenshots?",
    a: "Not with Quick unlock, the default: fans tap each follow and download. Verified gates ask for one screenshot per step, checked by AI in the background, and the fan still gets the file right away.",
  },
  {
    q: "Where does the file live?",
    a: "On Vividdit's storage for your first gates, or on your own Cloudflare R2 bucket for unlimited gates and no download fees.",
  },
]

export default async function Home() {
  const featured = await loadFeatured()

  return (
    <div className="flex min-h-svh flex-col bg-[#09090b] text-zinc-50">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <span className="text-sm font-semibold tracking-widest uppercase">Vividdit</span>
        <nav className="flex items-center gap-2">
          <Link
            href="/login"
            className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-zinc-300 hover:text-white"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200"
          >
            Get started
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pt-8 pb-20 md:grid-cols-[1.1fr_0.9fr] md:pt-16">
          <div className="space-y-6">
            <p className="text-sm font-medium text-zinc-400">
              Free download gates for SoundCloud artists
            </p>
            <h1 className="text-5xl leading-[1.02] font-bold tracking-tight text-balance md:text-6xl">
              Turn free downloads into fans.
            </h1>
            <p className="max-w-xl text-lg text-zinc-300">
              Fans follow you, join your email list and get the WAV in about 20
              seconds. No screenshots, nothing to install, and free to use.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-base font-semibold text-zinc-950 hover:bg-zinc-200"
              >
                Make your first gate
                <ArrowRight className="size-5" />
              </Link>
              {featured?.profile && (
                <Link
                  href={`/${featured.profile.artist_slug}`}
                  className="inline-flex h-12 items-center rounded-xl border border-zinc-700 px-6 text-base font-medium hover:bg-zinc-900"
                >
                  See a live page
                </Link>
              )}
            </div>
            <p className="max-w-xl text-sm text-zinc-500">
              Built by an artist, for artists. I made Vividdit after SoundCloud
              broke the old download gates, and I&apos;m sharing it with the
              community at no cost.
            </p>
          </div>

          <PhoneMockup
            title={featured?.gate?.title ?? "Your next release"}
            artist={featured?.gate?.artist ?? "Your name"}
            cover={featured?.gate?.cover ?? null}
          />
        </section>

        <section className="border-t border-zinc-800/80">
          <div className="mx-auto w-full max-w-6xl px-5 py-20">
            <h2 className="text-3xl font-bold tracking-tight">How it works</h2>
            <ol className="mt-10 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.title} className="space-y-3">
                  <span className="grid size-10 place-items-center rounded-full bg-white text-sm font-bold text-zinc-950">
                    {i + 1}
                  </span>
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                  <p className="text-zinc-400">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t border-zinc-800/80">
          <div className="mx-auto grid w-full max-w-6xl gap-4 px-5 py-20 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ Icon, title, body }) => (
              <div key={title} className="space-y-2 rounded-2xl border border-zinc-800 p-5">
                <Icon className="size-5 text-zinc-300" aria-hidden="true" />
                <h3 className="font-semibold">{title}</h3>
                <p className="text-sm text-zinc-400">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-zinc-800/80">
          <div className="mx-auto w-full max-w-3xl px-5 py-20">
            <h2 className="text-3xl font-bold tracking-tight">Questions</h2>
            <div className="mt-8 divide-y divide-zinc-800 border-y border-zinc-800">
              {FAQ.map(({ q, a }) => (
                <details key={q} className="group">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-lg font-medium">
                    {q}
                    <span
                      aria-hidden="true"
                      className="text-2xl leading-none text-zinc-500 transition-transform group-open:rotate-45 motion-reduce:transition-none"
                    >
                      +
                    </span>
                  </summary>
                  <p className="pb-5 text-zinc-400">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-800/80">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-5 px-5 py-20 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-balance md:text-4xl">
              Your next free download could be your next 100 followers.
            </h2>
            <Link
              href="/signup"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-base font-semibold text-zinc-950 hover:bg-zinc-200"
            >
              Get started free
              <ArrowRight className="size-5" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="flex items-center justify-center gap-4 px-6 py-8 text-sm text-zinc-500">
        <Link href="/privacy" className="px-2 py-1 hover:text-zinc-200">
          Privacy
        </Link>
        <Link href="/terms" className="px-2 py-1 hover:text-zinc-200">
          Terms
        </Link>
      </footer>
    </div>
  )
}

// A still of the fan's second step, drawn with the same pieces as the live
// gate page.
function PhoneMockup({
  title,
  artist,
  cover,
}: {
  title: string
  artist: string
  cover: string | null
}) {
  return (
    <div className="mx-auto w-full max-w-[320px]" aria-hidden="true">
      <div className="rounded-[2.75rem] border border-zinc-700 bg-zinc-900 p-2.5 shadow-2xl shadow-black/60">
        <div className="space-y-3 overflow-hidden rounded-[2.2rem] bg-[#141012] px-4 pt-8 pb-6">
          <div className="flex items-center gap-3">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt="" className="size-16 rounded-lg object-cover" />
            ) : (
              <div className="size-16 rounded-lg bg-gradient-to-br from-orange-500 to-rose-600" />
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-semibold tracking-widest text-orange-400 uppercase">
                Free download · WAV
              </p>
              <p className="truncate text-sm font-bold">{title}</p>
              <p className="truncate text-xs text-zinc-400">{artist}</p>
            </div>
          </div>
          <div className="space-y-2.5 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <div className="flex justify-between text-[11px] text-zinc-400">
              <span>Step 2 of 3</span>
              <span>1 step left</span>
            </div>
            <div className="flex gap-1">
              <span className="h-1 flex-1 rounded-full bg-orange-500" />
              <span className="h-1 flex-1 rounded-full bg-orange-500" />
              <span className="h-1 flex-1 rounded-full bg-white/15" />
            </div>
            <p className="pt-1 text-base font-bold">Follow to unlock</p>
            <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.07] p-2.5">
              <span className="grid size-8 place-items-center rounded-full bg-white/10 text-[#ff5500]">
                <SoundCloudIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">Follow on SoundCloud</p>
                <p className="text-[11px] text-zinc-400">Done</p>
              </div>
              <span className="grid size-5 place-items-center rounded-full bg-orange-500 text-zinc-950">
                <Check className="size-3" strokeWidth={3} />
              </span>
            </div>
            <div className="space-y-2 rounded-xl border border-white/10 p-2.5">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-full bg-white/10 text-[#e4405f]">
                  <InstagramIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">Follow on Instagram</p>
                  <p className="text-[11px] text-zinc-400">Opens the app</p>
                </div>
              </div>
              <div className="flex h-9 items-center justify-center rounded-lg bg-orange-500 text-xs font-bold text-zinc-950">
                Open Instagram
              </div>
            </div>
            <p className="text-center text-[11px] text-zinc-500">
              Your progress is saved if you switch apps.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
