import type { Verdict } from './eval-judge'

// What a run prints. A passing line says only that the rule held; a failing one says which
// expectation broke and why that expectation is the rule — the sentence the scenario author wrote,
// not a restatement of the tool name. Reading a red run should tell you which prose to change.

const PASS_MARK = '✔'
const FAIL_MARK = '✘'
const INCONCLUSIVE_MARK = '?'
const UNREACHABLE_MARK = '⚠'
const CALL_PREVIEW_LENGTH = 80

function summarize_calls(verdict: Verdict): string {
	const names = verdict.calls.map((call) => call.name).join(' → ')

	return names === '' ? '(none)' : names.slice(0, CALL_PREVIEW_LENGTH)
}

function report_failure(verdict: Verdict): void {
	console.error(`  ${FAIL_MARK} ${verdict.name} — ${verdict.rule}`)

	for (const failure of verdict.failures) {
		console.error(`      ${failure.expectation}`)
		console.error(`      → ${failure.because}`)
	}

	console.error(`      calls: ${summarize_calls(verdict)}`)
}

// An inconclusive run is printed apart from a failure on purpose: the thing to fix is the harness or
// the prompt, not the rule, and reporting it as a violation sends the reader to the wrong file.
function report_inconclusive(verdict: Verdict): void {
	console.error(
		`  ${INCONCLUSIVE_MARK} ${verdict.name} — ${verdict.note ?? 'nothing was measured'}`,
	)
	console.error('      → fix the harness or the prompt; this says nothing about the rule')
}

// Printed apart from an ordinary non-measurement, because it sends the reader somewhere else again.
// A `?` line says the harness or the prompt is wrong; this one says nothing about either — the
// session never reached the API, so the scenario, the prompt and the rule are all untested rather
// than tested and unclear (joshuafolkken/kit#1197).
function report_unreachable(verdict: Verdict): void {
	console.error(
		`  ${UNREACHABLE_MARK} ${verdict.name} — ${verdict.note ?? 'the session could not reach the API'}`,
	)
	console.error('      → nothing was attempted; this says nothing about the rule or the harness')
}

function report_verdict(verdict: Verdict): void {
	if (verdict.is_unreachable) {
		report_unreachable(verdict)

		return
	}

	if (verdict.is_inconclusive) {
		report_inconclusive(verdict)

		return
	}

	if (verdict.is_pass) {
		console.info(`  ${PASS_MARK} ${verdict.name}`)

		return
	}

	report_failure(verdict)
}

// The two kinds of non-measurement are counted apart. Merged into one "inconclusive" number, a suite
// that never connected read as five scenarios that ran and said nothing — the same figure as a real
// measurement problem, at five sessions' cost (joshuafolkken/kit#1197).
function count_note(verdicts: ReadonlyArray<Verdict>): string {
	const unreachable = verdicts.filter((verdict) => verdict.is_unreachable).length
	const inconclusive = verdicts.filter(
		(verdict) => verdict.is_inconclusive && !verdict.is_unreachable,
	).length
	const parts = [
		inconclusive === 0 ? undefined : `${String(inconclusive)} inconclusive`,
		unreachable === 0 ? undefined : `${String(unreachable)} could not reach the API`,
	].filter((part) => part !== undefined)

	return parts.length === 0 ? '' : ` (${parts.join(', ')})`
}

// The count is printed even when everything passed, because "5 of 5" is the number a document change
// is compared against; "no output" is not a baseline anyone can act on.
function report_summary(verdicts: ReadonlyArray<Verdict>): boolean {
	// A suite that ran nothing is not a suite that passed. `passed === total` is true of an empty run,
	// so `0/0 scenarios held.` would have exited zero — the greenest possible report for no
	// measurement at all.
	if (verdicts.length === 0) {
		console.error('\nNo scenarios ran.')

		return false
	}

	const passed = verdicts.filter((verdict) => verdict.is_pass).length

	console.info(
		`\n${String(passed)}/${String(verdicts.length)} scenarios held.${count_note(verdicts)}`,
	)

	return passed === verdicts.length
}

// **What a run means for a merge, in one readable token** (joshuafolkken/kit#907). The exit code
// cannot carry this: it is `0` only when every scenario passed, so a failed run and one that
// measured nothing exit alike — and those are the two outcomes that must not be treated alike. A
// failed scenario is a rule that stopped working and blocks the merge; an inconclusive one says
// nothing about the rules, so blocking on it would park work for a problem in the harness or its
// surroundings.
//
// **It does not say *why*, and it used to.** The sentence asserted the shared budget was exhausted —
// a cause nobody had established, and the first run that printed a reason contradicted it outright:
// `API Error: Unable to connect to API (ConnectionRefused)` on every inconclusive scenario
// (joshuafolkken/kit#1001). Naming one cause in a fixed string sends every reader to check the one
// thing that may not be wrong; the per-scenario `?` line carries the reason that was actually
// observed, so the verdict points there instead of guessing.
const VERDICT_BLOCKED = 'blocked'
const VERDICT_HELD = 'held'
const VERDICT_UNMEASURED = 'unmeasured'
// **A fourth word, because "the sessions ran and told us nothing" and "the sessions never ran" are
// different things to be told** (joshuafolkken/kit#1197). Both leave the rules unmeasured and neither
// blocks the merge, so `unmeasured` was not *wrong* — it was unactionable: a reader sent to the `?`
// lines to fix the harness or the prompt found nothing wrong with either, because the fault was a
// connection. Reported under its own word, the suite says which one to look at, and a run of these
// three days running is visible as three of the same word rather than three of the general one.
const VERDICT_UNREACHABLE = 'unreachable'

type MergeVerdict =
	| typeof VERDICT_BLOCKED
	| typeof VERDICT_HELD
	| typeof VERDICT_UNMEASURED
	| typeof VERDICT_UNREACHABLE

const VERDICT_SENTENCES: Record<MergeVerdict, string> = {
	[VERDICT_BLOCKED]: 'a scenario failed; fix the rule its → line names before merging',
	[VERDICT_HELD]: 'every scenario held; nothing here blocks the merge',
	[VERDICT_UNMEASURED]:
		'not every scenario produced a measurement, so the rules were not measured; the ? line above each one says why. It does not block the merge, and it is not evidence that anything held',
	// **Says what one refused session proves, not what two of them cause.** The word is reached by a
	// single unreachable scenario while the suite only stops starting sessions at two, so a sentence
	// asserting that nothing was measured and that the rest were never started is false on the
	// one-refusal run — and both CLAUDE.md and `eval-gate.md` tell an agent to carry this sentence into
	// the completion report verbatim, which is exactly how a falsehood here would travel.
	[VERDICT_UNREACHABLE]:
		'a session could not reach the API, so not every scenario was measured; once two are refused the suite starts no more. Fix the connection and re-run. It does not block the merge, and it is not evidence that anything held',
}

// A failure outranks an inconclusive verdict: one measured violation is a fact about the rules
// however many of its neighbors said nothing.
//
// **A run of no scenarios answers `blocked`, not `unmeasured`.** `unmeasured` says the sessions ran
// and told us nothing, which does not block; a suite that found nothing to run told us nothing *and*
// spent nothing, and reading that as "carry on" is the hole `report_summary` already refuses to leave
// open one function above — a pruned install or a scenario file that failed to land would otherwise
// print a green-looking last line.
function merge_verdict(verdicts: ReadonlyArray<Verdict>): MergeVerdict {
	if (verdicts.length === 0) return VERDICT_BLOCKED

	const is_failed = verdicts.some((verdict) => !verdict.is_pass && !verdict.is_inconclusive)

	if (is_failed) return VERDICT_BLOCKED
	if (verdicts.some((verdict) => verdict.is_unreachable)) return VERDICT_UNREACHABLE
	if (verdicts.some((verdict) => verdict.is_inconclusive)) return VERDICT_UNMEASURED

	return VERDICT_HELD
}

// A run that never started is **not** an unmeasured run. The recovery step after a `blocked` verdict
// is `pnpm josh eval <name>`, and a mistyped name there would otherwise print no verdict at all —
// which the documented rule reads as `unmeasured`, and `unmeasured` does not block. So an invocation
// the suite could not act on says `blocked`: you asked for a measurement and have none
// (joshuafolkken/kit#907).
function report_not_run(): MergeVerdict {
	console.info(
		`Verdict: ${VERDICT_BLOCKED} — the suite ran nothing, so nothing was measured; fix the invocation and re-run`,
	)

	return VERDICT_BLOCKED
}

// On stdout beside the count, because the whole point is that a run says what it means for the
// merge without anybody reading the marks and deciding.
//
// Split from `report_merge_verdict` so a caller that needs the verdict *before* the line is printed
// — anything that has to say something above it — does not compute it a second time to get it
// (joshuafolkken/kit#1197).
function print_verdict(verdict: MergeVerdict): MergeVerdict {
	console.info(`Verdict: ${verdict} — ${VERDICT_SENTENCES[verdict]}`)

	return verdict
}

function report_merge_verdict(verdicts: ReadonlyArray<Verdict>): MergeVerdict {
	return print_verdict(merge_verdict(verdicts))
}

const eval_report = {
	merge_verdict,
	print_verdict,
	report_merge_verdict,
	report_not_run,
	report_summary,
	report_verdict,
	VERDICT_BLOCKED,
	VERDICT_HELD,
	VERDICT_UNMEASURED,
	VERDICT_UNREACHABLE,
}

export type { MergeVerdict }
export { eval_report }
