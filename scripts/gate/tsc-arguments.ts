import { TS_CACHE_FLAGS } from '#scripts/josh/josh-command-types'

// The one `tsc` argument list: `josh check` and the pre-commit hook both run it, so a record either
// writes covers what the other would run, and both read and write the same `.tsbuildinfo`.
// A truncated or half-written `.tsbuildinfo` makes `tsc` fall back to a full check and rewrite it,
// so a hook and a gate overlapping on one tree cost time, never a wrong answer (joshuafolkken/kit#7124).
const TSC_ARGS = ['exec', 'tsc', '--noEmit', ...TS_CACHE_FLAGS] as const

export { TSC_ARGS }
