import type { Verdict } from './eval-judge'

// What a run prints. A passing line says only that the rule held; a failing one says which
// expectation broke and why that expectation is the rule — the sentence the scenario author wrote,
// not a restatement of the tool name. Reading a red run should tell you which prose to change.

const PASS_MARK = '✔'
const FAIL_MARK = '✘'
const INCONCLUSIVE_MARK = '?'
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

function report_verdict(verdict: Verdict): void {
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
	const inconclusive = verdicts.filter((verdict) => verdict.is_inconclusive).length
	const note = inconclusive === 0 ? '' : ` (${String(inconclusive)} inconclusive)`

	console.info(`\n${String(passed)}/${String(verdicts.length)} scenarios held.${note}`)

	return passed === verdicts.length
}

const eval_report = { report_summary, report_verdict }

export { eval_report }
