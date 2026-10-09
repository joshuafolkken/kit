import { document_reachability } from './document-reachability'

// The byte budget of the always-resident document — `CLAUDE.md`, loaded on every request. It is held
// here rather than in `document-byte-budget.ts` because a resident document is covered by every entry
// total and must not carry a per-document block entry as well; it is held here rather than inside
// `workflow-skills.test.ts` so `josh bytes CLAUDE.md` counts against the same number the suite
// enforces. Loosening any of the three constants is Tier C —
// `prompts/collaboration-workflow/residency.md`.

// The ceiling keeps `CLAUDE.md` to triggers and pointers, so the document cannot creep back. It is a
// guard against re-inlining, not a budget to tune prose against.
const RESIDENT_CEILING_BYTES = 12_216

// The ceiling alone stops the wrong thing. Reached, it does not block the
// next rule — it makes that rule pay for itself by deleting a neighboring sentence, and the
// sentence chosen is whichever one no marker pinned rather than whichever one matters least. A
// required margin turns "at the limit" into a failure while there is still room to write the fix,
// which is the only point at which moving a procedure into a skill is still a choice.
const RESIDENT_HEADROOM_BYTES = 2000

// A floor under the room left once the procedures are out, so a wholesale
// re-inlining fails by name instead of silently returning the document to a few bytes of headroom.
const RE_INLINE_GUARD_HEADROOM_BYTES = 1000

const EFFECTIVE_CEILING_BYTES = RESIDENT_CEILING_BYTES - RESIDENT_HEADROOM_BYTES

// The size a resident document must stay below — the effective ceiling minus the re-inline floor. The
// suite fails at it, and `josh bytes` counts the headroom against it.
const RESIDENT_LIMIT_BYTES = EFFECTIVE_CEILING_BYTES - RE_INLINE_GUARD_HEADROOM_BYTES

// The limit for a resident document, or undefined for any other path.
function limit_bytes_for(relative_path: string): number | undefined {
	return document_reachability.RESIDENT_BASE.includes(relative_path)
		? RESIDENT_LIMIT_BYTES
		: undefined
}

const resident_budget = {
	EFFECTIVE_CEILING_BYTES,
	RE_INLINE_GUARD_HEADROOM_BYTES,
	RESIDENT_LIMIT_BYTES,
	limit_bytes_for,
}

export { resident_budget }
