import { test_pinned } from '#scripts/test/test-pinned'
import { test_pinned_logic, type PinnedReport } from '#scripts/test/test-pinned-logic'

// The round-1 check `josh run:review` runs before it starts the gate (joshuafolkken/kit#4647): `josh
// test:pinned` over the change, changed hunks and added files' functions alike. A change no test pins
// is the finding a review used to stop a lane on in round 2, so the run stops here instead, before the
// gate and the brief, with each place listed as `file:line`.
//
// **`--unpinned-ok "<reason>"` carries on past it** for a change no test can pin; the list and the
// reason follow the brief on stdout, so the reviewer reads both and judges them. Unchecked places
// (over the cap, an added file `typescript` could not read, or no Vitest to run a probe) never stop
// the run.

const UNPINNED_OK_FLAG = '--unpinned-ok'
const OK_ARGUMENT_COUNT = 2
const STOP_NOTE =
	'Pin each unpinned place with a test that turns red without it, then re-run `pnpm josh run:review`; for a change no test can pin, re-run it with `--unpinned-ok "<reason>"` (`pnpm josh ship --review` forwards it).'
const NOT_RUN_NOTE = '`josh test:pinned` could not run, so nothing was checked: '

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

function verdict_of(report: PinnedReport, reason: string | undefined): PinnedVerdict {
	const text = test_pinned_logic.report_text(report)

	if (report.unpinned.length === 0) return { kind: 'clear', text }
	if (reason === undefined) return { kind: 'stop', text: `${text}${STOP_NOTE}\n` }

	return { kind: 'accepted', text: `${text}Unpinned accepted by the implementer: ${reason}\n` }
}

// A `test:pinned` that could not run (its worktree or copy-in failed) checked nothing, so it fails open
// as an unchecked run would: the note goes beside the other run notes and the review carries on.
async function check(reason: string | undefined): Promise<PinnedVerdict> {
	try {
		return verdict_of(await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS), reason)
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error)

		return { kind: 'clear', text: `${NOT_RUN_NOTE}${message}\n` }
	}
}

const run_review_pinned = { STOP_NOTE, UNPINNED_OK_FLAG, check, ok_reason_of }

export type { PinnedVerdict }
export { run_review_pinned }
