import "server-only"

import {
  CREATOR_INSTAGRAM_HANDLE,
  CREATOR_INSTAGRAM_URL,
} from "@/lib/creator-access-constants"

// The tool's own access gate: new creators must follow the Vividdit creator on
// Instagram. Verified with the PLATFORM OpenAI key (creators don't have their
// own key yet at onboarding). This is the ONE place the platform key is used.

const MODEL = "gpt-5.4-mini"

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    is_instagram: { type: "boolean" },
    follow_confirmed: {
      type: "boolean",
      description: `True only if the screenshot clearly shows the viewer follows @${CREATOR_INSTAGRAM_HANDLE} (button reads "Following").`,
    },
    confidence: { type: "number" },
    tampering_suspected: { type: "boolean" },
    message: {
      type: "string",
      description: "One short sentence for the creator if not confirmed.",
    },
  },
  required: [
    "is_instagram",
    "follow_confirmed",
    "confidence",
    "tampering_suspected",
    "message",
  ],
} as const

export type AccessCheck = {
  confirmed: boolean
  message: string
}

export async function verifyCreatorInstagramFollow(
  images: { mime: string; b64: string }[]
): Promise<AccessCheck> {
  const key = process.env.PLATFORM_OPENAI_API_KEY
  if (!key) {
    return {
      confirmed: false,
      message: "Verification is temporarily unavailable — try again shortly.",
    }
  }

  const prompt = `You verify a screenshot proving someone follows a specific
Instagram account.

Target account: @${CREATOR_INSTAGRAM_HANDLE} (${CREATOR_INSTAGRAM_URL})

Confirm ALL of:
- The screenshot is really Instagram (web or app).
- It shows the profile of @${CREATOR_INSTAGRAM_HANDLE} (or that account in the
  viewer's following list).
- The follow button reads "Following" (not "Follow") — i.e. the viewer
  follows this account.

Set follow_confirmed true only when clearly shown. tampering_suspected: edited,
stitched, or AI-generated images, or a photo of another screen.`

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              ...images.map((img) => ({
                type: "input_image",
                image_url: `data:${img.mime};base64,${img.b64}`,
              })),
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "instagram_follow_check",
            strict: true,
            schema: SCHEMA,
          },
        },
        max_output_tokens: 1000,
      }),
      signal: AbortSignal.timeout(60_000),
    })

    const body = await res.json()
    if (!res.ok) {
      return {
        confirmed: false,
        message: "Couldn't verify right now — please try again.",
      }
    }
    const text: string | undefined = body.output
      ?.find((o: { type: string }) => o.type === "message")
      ?.content?.find((c: { type: string }) => c.type === "output_text")?.text
    if (!text) {
      return { confirmed: false, message: "Couldn't read the result — try again." }
    }

    const out = JSON.parse(text) as {
      is_instagram: boolean
      follow_confirmed: boolean
      confidence: number
      tampering_suspected: boolean
      message: string
    }

    const confirmed =
      out.is_instagram &&
      out.follow_confirmed &&
      !out.tampering_suspected &&
      out.confidence >= 0.7

    return {
      confirmed,
      message: confirmed
        ? "Verified — welcome in!"
        : out.message ||
          `Make sure the screenshot shows you Following @${CREATOR_INSTAGRAM_HANDLE}.`,
    }
  } catch {
    return {
      confirmed: false,
      message: "Verification timed out — please try again.",
    }
  }
}
