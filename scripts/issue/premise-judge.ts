import {
	measure_declaration,
	type MeasureDeclaration,
	type MeasureVerdict,
} from './measure-declaration'
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

// The refusal of each premise of a draft body whose output cannot be read. A failed command or a
// premise that no longer holds is not refused: the lane entry stops on those.
function draft_problems(body: string): ReadonlyArray<string> {
	const source = trusted_measure.drafted(body)

	return measure_declaration
		.premises(body)
		.flatMap((declaration) => unreadable_of(run_of(declaration, source)) ?? [])
}

const premise_judge = { draft_problems, run_of }

export type { PremiseRun }
export { premise_judge }
