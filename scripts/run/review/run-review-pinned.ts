import type { PinnedSummary } from '#scripts/test/test-pinned-record'

// The round-1 check of `josh run:review` (joshuafolkken/kit#4647): `josh test:pinned` over the change,
// changed hunks and added files' functions alike. A change no test pins is the finding a review used
// to stop a lane on in round 2, so the run stops on it instead, with each place listed as `file:line`.
// It runs in the background beside the gate and the brief, and `--join` stops on its answer
// (joshuafolkken/kit#4770), so its time leaves the critical path.
//
// **`--unpinned-ok "<reason>"` carries on past it** for a change no test can pin. That check runs in
// the background too (joshuafolkken/kit#4793), so the pair never waits on it: the join prints the list
// and the reason and carries on. **Given after the join stopped, on the same tree and a green gate,
// the reason judges the finished answer** and re-runs neither the check nor the pair
// (joshuafolkken/kit#4920); an answer cut at its first unpinned hunk re-runs only the whole check
// (joshuafolkken/kit#5153). Unchecked places (over the cap, an added file `typescript` could not
// read, or no Vitest to run a probe) never stop the run.

const UNPINNED_OK_FLAG = '--unpinned-ok'
const OK_ARGUMENT_COUNT = 2
const STOP_NOTE =
	'Pin each unpinned place with a test that turns red without it, then re-run `pnpm josh run:review`; for a change no test can pin, leave the tree as it is and pass the reason with `pnpm josh run:review --unpinned-ok "<reason>"` — on this tree and a green gate it judges this answer (or, cut at its first unpinned place, checks the whole change) and re-runs neither the gate nor the pair (`pnpm josh ship --review` forwards it).'

type PinnedKind = 'clear' | 'stop' | 'accepted'

interface PinnedVerdict {
	kind: PinnedKind
	text: string
}

// `--unpinned-ok` with a non-blank reason; anything else carries none.
function ok_reason_of(argv: ReadonlyArray<string>): string | undefined {
	const [flag, reason = ''] = argv
	if (flag !== UNPINNED_OK_FLAG || argv.length !== OK_ARGUMENT_COUNT) return undefined

	return reason.trim() === '' ? undefined : reason
}

// The join's answer on the background check, judged by the reason it was launched with.
function verdict_of(summary: PinnedSummary, reason: string | undefined): PinnedVerdict {
	const { text } = summary

	if (summary.unpinned.length === 0) return { kind: 'clear', text }
	if (reason === undefined) return { kind: 'stop', text: `${text}${STOP_NOTE}\n` }

	return { kind: 'accepted', text: `${text}Unpinned accepted by the implementer: ${reason}\n` }
}

const run_review_pinned = { STOP_NOTE, UNPINNED_OK_FLAG, ok_reason_of, verdict_of }

export type { PinnedVerdict }
export { run_review_pinned }
