import { time_command_key } from './time-command-key'
import type { Span } from './time-spans'

// What "the same call" means, in one place (joshuafolkken/kit#1979).
//
// Two readers ask it and must agree. `time-guard-refusals.ts` asks whether a refused call was later
// re-issued unchanged — the false-positive hint on the guard breakdown — and `time-batch-guard.ts`
// asks, live, whether the call in hand is one it has already refused, so it does not refuse the
// re-issue a second time. Both mean the same thing by "the same call", so the rule sits here rather
// than in either of them: a second copy is the clone `CLAUDE.md` prohibits, in the one place a drift
// would let the guard refuse a re-issue the report then says was the same call.
//
// **The same call twice is the same command naming the same files.** A coarser key (the command
// alone) would call two unrelated reads a re-issue; a finer one is not on the span, which keeps no
// command string — so this is the closest "same arguments" the timeline can answer, and the same key
// the guard can build for a live call once its input has been read into a `ToolCall`.

// A null byte cannot appear in a command, a check key or a path, so joining the fields on it makes an
// identity that no ordinary argument can forge a collision in — a space could, since a command key
// and a check key may each hold one.
const IDENTITY_SEPARATOR = '\0'

// The four fields the identity is read off, which both a full `Span` and a freshly-built `ToolCall`
// carry — so a refused span and the live call about to repeat it produce the identical string.
type IdentityCall = Pick<Span, 'label' | 'josh_command' | 'check_key' | 'targets'>

function identity_of(call: IdentityCall): string {
	return [
		time_command_key.command_key(call),
		call.check_key,
		[...call.targets].toSorted((left, right) => left.localeCompare(right)).join(','),
	].join(IDENTITY_SEPARATOR)
}

const time_call_identity = { identity_of }

export type { IdentityCall }
export { time_call_identity }
