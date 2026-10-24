import { test_pinned } from '#scripts/test/test-pinned'
import { test_pinned_logic } from '#scripts/test/test-pinned-logic'
import { test_pinned_record, type PinnedSummary } from '#scripts/test/test-pinned-record'

// The round-1 check of `josh run:review` (joshuafolkken/kit#4647): `josh test:pinned` over the change,
// changed hunks and added files' functions alike. A change no test pins is the finding a review used
// to stop a lane on in round 2, so the run stops on it instead, with each place listed as `file:line`.
// It runs in the background beside the gate and the brief, and `--join` stops on its answer
// (joshuafolkken/kit#4770), so its time leaves the critical path.
//
// **`--unpinned-ok "<reason>"` carries on past it** for a change no test can pin. That run checks in
// place, before the pair: the list and the reason follow the brief on stdout, so the reviewer reads
// both and judges them. Unchecked places (over the cap, an added file `typescript` could not read, or
// no Vitest to run a probe) never stop the run.

const UNPINNED_OK_FLAG = '--unpinned-ok'
const OK_ARGUMENT_COUNT = 2
const STOP_NOTE =
	'Pin each unpinned place with a test that turns red without it, then re-run `pnpm josh run:review`; for a change no test can pin, re-run it with `--unpinned-ok "<reason>"` (`pnpm josh ship --review` forwards it).'

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

// The same answer for the in-place check and the background one the join reads.
function verdict_of(summary: PinnedSummary, reason: string | undefined): PinnedVerdict {
	const { text } = summary

	if (summary.unpinned_count === 0) return { kind: 'clear', text }
	if (reason === undefined) return { kind: 'stop', text: `${text}${STOP_NOTE}\n` }

	return { kind: 'accepted', text: `${text}Unpinned accepted by the implementer: ${reason}\n` }
}

// A `test:pinned` that could not run (its worktree or copy-in failed) checked nothing, so it fails open
// as an unchecked run would: the note goes beside the other run notes and the review carries on.
async function check(reason: string | undefined): Promise<PinnedVerdict> {
	try {
		const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

		return verdict_of(test_pinned_record.summary_of(report), reason)
	} catch (error: unknown) {
		return verdict_of(test_pinned_record.not_run_summary(error), reason)
	}
}

const run_review_pinned = { STOP_NOTE, UNPINNED_OK_FLAG, check, ok_reason_of, verdict_of }

export type { PinnedVerdict }
export { run_review_pinned }
