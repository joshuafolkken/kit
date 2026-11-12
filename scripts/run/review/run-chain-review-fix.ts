import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { lane_child_invocation } from '#scripts/lane/lane-child-invocation'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_cut_handoff, type Handoff } from '#scripts/run/cut/run-cut-handoff'
import { run_cut_ready } from '#scripts/run/cut/run-cut-ready'

// Where a lane child fixes its round-1 findings (joshuafolkken/kit#6900). The session that implemented
// and reviewed re-reads all of that context on every fix turn, so a held round moves the fix to a fresh
// session over the implementation cut: the hold writes the handoff — the findings, which stay in the
// review slot for `review:record --from-slot`, and the record-and-ship steps — and asks for
// `run:cut --impl`. The gate and round 2 are untouched: the fresh session records this round 1, and the
// ship reads it as before. Outside a lane, on a committed tree, or where the cut does not relaunch, the
// fix stays in place.

type FixNext = (issue: string) => string

const COMPLETED =
	'the implementation on this branch and its round-1 review, attested — the findings below are in the review slot'
const CUT_VERDICT = 'cut'

function handoff_of(issue: string, findings: ReadonlyArray<string>, next: string): Handoff {
	return {
		instruction: lane_child_invocation.child_invocation(issue),
		completed: [COMPLETED],
		remaining: [next],
		untouched: [],
		findings: [...findings],
	}
}

// `undefined` where the handoff cannot be written, so the fix stays in place.
function write_handoff(issue: string, handoff: Handoff): string | undefined {
	const file = run_cut_handoff.handoff_path_of(issue)

	try {
		mkdirSync(path.dirname(file), { recursive: true })
		writeFileSync(file, `${JSON.stringify(handoff)}\n`)
	} catch {
		return undefined
	}

	return file
}

// The cut needs an uncommitted tree (`run-cut-ready.ts`): a round whose `run:review` open committed it
// is fixed in place, since a cut there answers `unready` and records a decline.
function can_cut(): boolean {
	return lane_child_marker.is_child_of(process.cwd()) && run_cut_ready.is_ready_sync()
}

function cut_next(file: string, in_place: string): FixNext {
	return (issue) =>
		`fix in a fresh session: issue \`pnpm josh run:cut ${issue} --impl --handoff ${file}\` alone and end the turn on \`${CUT_VERDICT}\` — the handoff carries the findings and the steps after the fix; on any other verdict, ${in_place}`
}

// The action after a held round: in a lane child that can cut, the cut that hands the fix to a fresh
// session; else `fix_next` in this one.
function route(issue: string, findings: ReadonlyArray<string>, fix_next: FixNext): FixNext {
	if (!can_cut()) return fix_next

	const in_place = fix_next(issue)
	const file = write_handoff(issue, handoff_of(issue, findings, in_place))

	return file === undefined ? fix_next : cut_next(file, in_place)
}

const run_chain_review_fix = { route }

export { run_chain_review_fix }
