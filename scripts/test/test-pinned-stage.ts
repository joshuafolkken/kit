import type { RedProbe } from './test-red-logic'

// The stages of one `josh test:pinned` probe (joshuafolkken/kit#5292): a hunk whose file reaches far
// more test files than import it directly runs those importers first, since a revert's red almost
// always lands there, and the whole reach only when they do not go red. A narrow file runs its reach
// once, as before. Between the two, the hunk is type-checked with it reverted (joshuafolkken/kit#5385):
// a change only the types pin reads red there, so the whole reach is run only when that is green too.

// A reach of this many test files is wide whatever the direct importers number.
const WIDE_REACH = 100
// A reach this many times the direct importers is wide.
const WIDE_RATIO = 3
// A red the type check reached: no test file failed, so none is named.
const TYPE_RED: RedProbe = { verdict: 'red', failed: [], pinned_by: 'type-check' }

// What a fresh probe runs: `direct` first where the reach is wide, then `reach` unless `direct` went red.
interface StagePlan {
	direct?: ReadonlyArray<string> | undefined
	reach: ReadonlyArray<string>
}

// How many probes the direct importers decided, how many the type check, and how many escalated to the
// whole reach.
interface Staged {
	direct: number
	typed: number
	escalated: number
}

type StageRun = (files: ReadonlyArray<string>) => Promise<RedProbe>
// Whether the type check reads red with the hunk reverted.
type TypeRun = () => Promise<boolean>

function none(): Staged {
	return { direct: 0, typed: 0, escalated: 0 }
}

// No direct importer, or as many as the reach, leaves no smaller first stage to run.
function is_wide(reach: number, direct: number): boolean {
	if (direct === 0 || direct >= reach) return false

	return reach >= WIDE_REACH || reach >= WIDE_RATIO * direct
}

// The plan for `file`, read off its `direct` importers and how many test files its imports `reach`.
function plan_over(file: string, direct: ReadonlyArray<string>, reach: number): StagePlan {
	return is_wide(reach, direct.length) ? { direct, reach: [file] } : { reach: [file] }
}

// What follows a direct stage that did not go red: the type check's red, or the whole reach.
async function past_direct(
	plan: StagePlan,
	run: StageRun,
	is_type_red: TypeRun,
	staged: Staged,
): Promise<RedProbe> {
	if (await is_type_red()) {
		staged.typed += 1

		return TYPE_RED
	}

	staged.escalated += 1

	return await run(plan.reach)
}

// The verdict over `plan`, each stage run through `run` or `is_type_red` and tallied into `staged`: a red
// from the direct importers decides, then a red from the type check, and anything else is answered by
// the whole reach.
async function staged_verdict(
	plan: StagePlan,
	run: StageRun,
	is_type_red: TypeRun,
	staged: Staged,
): Promise<RedProbe> {
	if (plan.direct === undefined) return await run(plan.reach)
	const first = await run(plan.direct)

	if (first.verdict !== 'red') return await past_direct(plan, run, is_type_red, staged)
	staged.direct += 1

	return first
}

// The counts line's tail, empty when no probe ran in stages.
function counts_suffix(staged: Staged | undefined): string {
	if (staged === undefined || staged.direct + staged.typed + staged.escalated === 0) return ''
	const typed = staged.typed === 0 ? '' : ` · type check ${String(staged.typed)}`

	return ` · direct ${String(staged.direct)}${typed} · escalated ${String(staged.escalated)}`
}

const test_pinned_stage = { WIDE_RATIO, WIDE_REACH, counts_suffix, none, plan_over, staged_verdict }

export type { Staged, StagePlan, TypeRun }
export { test_pinned_stage }
