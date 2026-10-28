import type { RedProbe } from './test-red-logic'

// The stages of one `josh test:pinned` probe (joshuafolkken/kit#5292): a hunk whose file reaches far
// more test files than import it directly runs those importers first, since a revert's red almost
// always lands there, and the whole reach only when they do not go red. A narrow file runs its reach
// once, as before.

// A reach of this many test files is wide whatever the direct importers number.
const WIDE_REACH = 100
// A reach this many times the direct importers is wide.
const WIDE_RATIO = 3

// What a fresh probe runs: `direct` first where the reach is wide, then `reach` unless `direct` went red.
interface StagePlan {
	direct?: ReadonlyArray<string> | undefined
	reach: ReadonlyArray<string>
}

// How many probes the direct importers decided, and how many escalated to the whole reach.
interface Staged {
	direct: number
	escalated: number
}

type StageRun = (files: ReadonlyArray<string>) => Promise<RedProbe>

function none(): Staged {
	return { direct: 0, escalated: 0 }
}

function is_wide(reach: number, direct: number): boolean {
	if (direct === 0) return false

	return reach >= WIDE_REACH || reach >= WIDE_RATIO * direct
}

// The plan for `file`, read off its `direct` importers and how many test files its imports `reach`.
function plan_over(file: string, direct: ReadonlyArray<string>, reach: number): StagePlan {
	return is_wide(reach, direct.length) ? { direct, reach: [file] } : { reach: [file] }
}

// The verdict over `plan`, each stage run through `run` and tallied into `staged`: a red from the
// direct importers decides, anything else is answered by the whole reach.
async function staged_verdict(plan: StagePlan, run: StageRun, staged: Staged): Promise<RedProbe> {
	if (plan.direct === undefined) return await run(plan.reach)
	const first = await run(plan.direct)

	if (first.verdict === 'red') {
		staged.direct += 1

		return first
	}

	staged.escalated += 1

	return await run(plan.reach)
}

// The counts line's tail, empty when no probe ran in stages.
function counts_suffix(staged: Staged | undefined): string {
	if (staged === undefined || staged.direct + staged.escalated === 0) return ''

	return ` · direct ${String(staged.direct)} · escalated ${String(staged.escalated)}`
}

const test_pinned_stage = { WIDE_RATIO, WIDE_REACH, counts_suffix, none, plan_over, staged_verdict }

export type { Staged, StagePlan }
export { test_pinned_stage }
