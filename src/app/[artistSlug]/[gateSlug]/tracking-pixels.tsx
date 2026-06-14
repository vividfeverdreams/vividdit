"use client"

import Script from "next/script"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { hasAnyTracking, type GateTracking } from "@/lib/tracking"

const CONSENT_KEY = "vividdit-consent"

// Renders nothing unless the gate has tracking configured. Then it shows a
// consent notice and only loads the pixels (+ PageView) after the fan accepts
// — pixels never load without consent.
export function TrackingPixels({
  tracking,
  accent,
}: {
  tracking: GateTracking
  accent: string
}) {
  const [consent, setConsent] = useState<"granted" | "denied" | "unknown">(
    "unknown"
  )

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY)
    if (stored === "granted" || stored === "denied") setConsent(stored)
  }, [])

  if (!hasAnyTracking(tracking)) return null

  const decide = (value: "granted" | "denied") => {
    localStorage.setItem(CONSENT_KEY, value)
    setConsent(value)
  }

  return (
    <>
      {consent === "granted" && (
        <>
          {tracking.facebookPixelId && (
            <Script id="vd-fb" strategy="afterInteractive">
              {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${tracking.facebookPixelId}');fbq('track','PageView');`}
            </Script>
          )}
          {tracking.googleAdsTagId && (
            <>
              <Script
                src={`https://www.googletagmanager.com/gtag/js?id=${tracking.googleAdsTagId}`}
                strategy="afterInteractive"
              />
              <Script id="vd-gtag" strategy="afterInteractive">
                {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${tracking.googleAdsTagId}');`}
              </Script>
            </>
          )}
          {tracking.tiktokPixelId && (
            <Script id="vd-ttq" strategy="afterInteractive">
              {`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=d.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${tracking.tiktokPixelId}');ttq.page()}(window,document,'ttq');`}
            </Script>
          )}
        </>
      )}

      {consent === "unknown" && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 p-4 backdrop-blur">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
            <p className="flex-1 text-sm text-muted-foreground">
              This page uses cookies and tracking pixels (Meta, Google, TikTok)
              so the artist can measure and improve their promotion. You can
              decline and still unlock your download.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => decide("denied")}>
                Decline
              </Button>
              <Button
                size="sm"
                onClick={() => decide("granted")}
                style={{ backgroundColor: accent }}
              >
                Accept
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
