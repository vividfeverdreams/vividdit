import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <>
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-24 text-center">
      <div className="space-y-4 max-w-2xl">
        <p className="text-sm font-medium tracking-widest uppercase text-muted-foreground">
          Vividdit
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Turn free downloads into fans
        </h1>
        <p className="text-lg text-muted-foreground">
          Gate your HQ files behind likes, reposts, follows, and email signups.
          Your track stays public on SoundCloud — the WAV is the reward.
        </p>
        <p className="text-base text-muted-foreground">
          Built by an artist, for artists — and free to use. I made Vividdit
          after SoundCloud broke the old download gates, and I&apos;m sharing
          it with the community at no cost.
        </p>
      </div>
      <div className="flex gap-3">
        <Button render={<Link href="/signup" />} nativeButton={false} size="lg">
          Get started
        </Button>
        <Button
          render={<Link href="/login" />}
          nativeButton={false}
          size="lg"
          variant="outline"
        >
          Log in
        </Button>
      </div>
    </main>
    <footer className="flex items-center justify-center gap-4 px-6 py-8 text-xs text-muted-foreground">
      <Link href="/privacy" className="hover:text-foreground">
        Privacy
      </Link>
      <Link href="/terms" className="hover:text-foreground">
        Terms
      </Link>
    </footer>
    </>
  );
}
