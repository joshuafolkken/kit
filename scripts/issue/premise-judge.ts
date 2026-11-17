import {
	measure_declaration,
	type MeasureDeclaration,
	type MeasureVerdict,
} from './measure-declaration'
import { session_cite } from './session-cite'
import { trusted_measure, type TrustedBody } from './trusted-measure'

// One premise line run and read the one way: the lane entry (`lane-plan-premise.ts`) stops on the run,
// and filing and a body edit refuse a premise it cannot read, so a premise `lane:plan` would stop on as
// unreadable is caught when it is written (joshuafolkken/kit#7769). The measurement declaration is never run here: it
// measures after the merge, so its command may not exist yet.

type PremiseRun =
	| { kind: 'failed'; declaration: MeasureDeclaration; message: string }
	| { kind: 'judged'; declaration: MeasureDeclaration; output: string; verdict: MeasureVerdict }

function run_of(declaration: MeasureDeclaration, source: TrustedBody): PremiseRun {
	const run = trusted_measure.run_command(declaration.command, source)

	if (run.kind === 'failed') return { kind: 'failed', declaration, message: run.message }
	const verdict = measure_declaration.judge(declaration, run.output)

	return { kind: 'judged', declaration, output: run.output, verdict }
}

function unreadable_of(premise: PremiseRun): string | undefined {
	if (premise.kind === 'failed' || premise.verdict.kind !== 'unreadable') return undefined

	return measure_declaration.unreadable_problem(premise.declaration, premise.output)
}

function is_inherited(declaration: MeasureDeclaration, inherited: string): boolean {
	return measure_declaration
		.premises(inherited)
		.some((premise) => premise.command === declaration.command)
}

// The refusal of each premise of a draft body whose output cannot be read. A failed command or a
// premise that no longer holds is not refused: the lane entry stops on those. A premise `inherited`
// declares — an untrusted body the draft was built from — is not the filer's and is never run.
function draft_problems(body: string, inherited = ''): ReadonlyArray<string> {
	const source = trusted_measure.drafted(body)

	return measure_declaration
		.premises(body)
		.filter((declaration) => !is_inherited(declaration, inherited))
		.flatMap((declaration) => unreadable_of(run_of(declaration, source)) ?? [])
}

// Whether `issue`'s author and last editor are trusted, so its premises may be run as ours.
async function is_trusted(issue: string): Promise<boolean> {
	const read = await trusted_measure.read_trusted_body(issue)

	return read.kind === 'trusted'
}

// `body` of `issue`, its premise lines dropped unless `issue` is trusted: a draft carrying them would
// run an outside author's commands as the filer's own.
async function carried(issue: string, body: string): Promise<string> {
	if (await is_trusted(issue)) return body
	console.info(
		`premise lines of ${session_cite.issue(issue)} are not carried: its author or last editor is untrusted`,
	)

	return measure_declaration.without_premises(body)
}

const premise_judge = { carried, draft_problems, is_trusted, run_of }

export type { PremiseRun }
export { premise_judge }
