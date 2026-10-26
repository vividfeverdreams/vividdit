// Link-preview fetchers, crawlers and headless browsers. Most never run the
// gate page's JavaScript, so they don't reach the analytics beacon at all;
// this catches the ones that do. In-app browsers (Instagram, TikTok, Discord)
// are real fans and must not match.
const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|facebookcatalog|embedly|link ?preview|skypeuripreview|headless|lighthouse|phantomjs|puppeteer|playwright|python-requests|curl\/|wget/i

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true
  return BOT_UA.test(userAgent)
}
