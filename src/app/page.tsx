import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
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
      </div>
      <div className="flex gap-3">
        <Button render={<Link href="/signup" />} size="lg">
          Get started free
        </Button>
        <Button render={<Link href="/login" />} size="lg" variant="outline">
          Log in
        </Button>
      </div>
    </main>
  );
}
