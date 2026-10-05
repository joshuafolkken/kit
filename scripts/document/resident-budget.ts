import { document_reachability } from './document-reachability'

// The byte budget of the always-resident document — `CLAUDE.md`, loaded on every request. It is held
// here rather than in `document-byte-budget.ts` because a resident document is covered by every entry
// total and must not carry a per-document block entry as well (joshuafolkken/kit#2257); it is held here
// rather than inside `workflow-skills.test.ts` so `josh bytes CLAUDE.md` counts against the same number
// the suite enforces (joshuafolkken/kit#3171). Loosening any of the three constants is Tier C —
// `prompts/collaboration-workflow/residency.md`.

// The documents sat at ~83 KB each before the joshuafolkken/kit#854 split, crept back to ~56 KB, and
// were cut below 30 KB by joshuafolkken/kit#1924. joshuafolkken/kit#3171 cut `CLAUDE.md` to ~14 KB —
// triggers and pointers only — and lowered this ceiling with it, so the document cannot creep back. It
// is a guard against re-inlining, not a budget to tune prose against.
const RESIDENT_CEILING_BYTES = 18_000

// joshuafolkken/kit#951: the ceiling alone stops the wrong thing. Reached, it does not block the
// next rule — it makes that rule pay for itself by deleting a neighboring sentence, and the
// sentence chosen is whichever one no marker pinned rather than whichever one matters least. A
// required margin turns "at the limit" into a failure while there is still room to write the fix,
// which is the only point at which moving a procedure into a skill is still a choice.
const RESIDENT_HEADROOM_BYTES = 2000

// joshuafolkken/kit#1275: a floor under the room left once the procedures are out, so a wholesale
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
