// How much a gate asks of a fan. Every extra step loses people, so the gate
// editor warns past three asks.

export const HEAVY_GATE_ASKS = 3

export function countAsks(gate: {
  emailEnabled: boolean
  requireLike: boolean
  requireRepost: boolean
  followCount: number
}): number {
  return (
    (gate.emailEnabled ? 1 : 0) +
    (gate.requireLike ? 1 : 0) +
    (gate.requireRepost ? 1 : 0) +
    gate.followCount
  )
}
