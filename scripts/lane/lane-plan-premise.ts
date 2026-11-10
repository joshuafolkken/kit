import type { OpenIssueData } from '#scripts/git/git-schemas'
import {
	measure_declaration,
	type MeasureDeclaration,
	type MeasureVerdict,
} from '#scripts/issue/measure-declaration'
import { session_cite } from '#scripts/issue/session-cite'
import { trusted_measure, type CommandRun, type TrustedBody } from '#scripts/issue/trusted-measure'

// joshuafolkken/kit#7022: an issue filed on a premise that no longer held (joshuafolkken/kit#6982) reached
// a lane, which noticed only by chance before implementing. A first `lane:plan` re-runs every premise
// line (`measure-declaration.ts` → `PREMISE_PREFIX`) through the trusted-measure boundary `backlog:drive` uses, prints each
// value, and stops the lane before the first edit when one does not hold. An issue with no premise line
// runs nothing, so its answer is unchanged.

interface Measured {
	holds: boolean
	value: string
}

// The listing only skips the read when it shows the issue with no premise line; an issue it does not
// carry (not opted in, past the cutoff, or an unread listing) is read in full.
function is_listed_without_premise(
	issue: number,
	issues: ReadonlyArray<OpenIssueData> | undefined,
): boolean {
	const listed = issues?.find((candidate) => candidate.number === issue)

	return listed !== undefined && measure_declaration.premises(listed.body ?? '').length === 0
}

// A failed command keeps its message, so the stop says why the premise could not be measured.
function measured(declaration: MeasureDeclaration, run: CommandRun): Measured {
	if (run.kind === 'failed') return { holds: false, value: `failed (${run.message})` }
	const verdict: MeasureVerdict = measure_declaration.judge(declaration, run.output)
	const value = 'value' in verdict ? String(verdict.value) : verdict.kind

	return { holds: verdict.kind === 'pass', value }
}

// The premise's value goes on stderr; one that does not hold is returned for the stop.
function checked(declaration: MeasureDeclaration, source: TrustedBody): string | undefined {
	const result = measured(declaration, trusted_measure.run_command(declaration.command, source))
	const line = `${measure_declaration.format(declaration)} measured ${result.value}`

	console.error(`premise: ${line}`)

	return result.holds ? undefined : line
}

// The premises are read from the trusted body; a body that cannot be trusted runs nothing, so its
// premises are not confirmed either.
async function failed_premises(
	issue: number,
	issues: ReadonlyArray<OpenIssueData> | undefined,
): Promise<ReadonlyArray<string>> {
	if (is_listed_without_premise(issue, issues)) return []
	const read = await trusted_measure.read_trusted_body(String(issue))

	if (read.kind === 'refused') return [`not re-run: ${read.reason}`]

	return measure_declaration
		.premises(read.body)
		.flatMap((declaration) => checked(declaration, read) ?? [])
}

// The stop's reason when a premise of `issue` does not hold, else `undefined`.
async function stop_text(
	issue: number,
	issues: ReadonlyArray<OpenIssueData> | undefined,
): Promise<string | undefined> {
	const failed = await failed_premises(issue, issues)

	if (failed.length === 0) return undefined

	return `premise: ${session_cite.issue(issue)}'s premises do not hold (${failed.join('; ')}), so the lane stops before implementing: park it with these values (backlogrun-park.md → "park and continue").`
}

const lane_plan_premise = { stop_text }

export { lane_plan_premise }
