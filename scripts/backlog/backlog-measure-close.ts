import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_measured_close } from '#scripts/issue/issue-measured-close'
import {
	measure_declaration,
	type MeasureDeclaration,
	type MeasureVerdict,
} from '#scripts/issue/measure-declaration'
import { trusted_measure, type CommandRun } from '#scripts/issue/trusted-measure'
import { error_text } from '#scripts/lib/error-message'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// joshuafolkken/kit#4621: the drive runs a due issue's measurement declaration (`measure-declaration.ts`)
// before it opens a lane. A value within the bound closes the issue the way `issue:measured` does — the
// result comment, the `measured` label, the close and the epic's progress — and puts a `measured` event
// on the stream, so no lane is spent. Anything else — no declaration, an untrusted body, a value out of
// bound, a failed command, output that is not one number — launches the lane as before; where a
// command ran, its result is commented first, so the child starts from the measurement, not a re-run.

const FENCE = '```'
const VERDICT_WORDS: Readonly<Record<MeasureVerdict['kind'], string>> = {
	pass: 'within the bound, so the issue is closed without a lane.',
	fail: 'out of the bound, so the issue goes to a lane.',
	unreadable: 'no value could be read from the output, so the issue goes to a lane.',
}

interface Measurement {
	declaration: MeasureDeclaration
	run: CommandRun
	verdict: MeasureVerdict
}

async function declared(issue: string): Promise<MeasureDeclaration | undefined> {
	const read = await trusted_measure.read_trusted_body(issue)

	return read.kind === 'trusted' ? measure_declaration.parse(read.body) : undefined
}

function measured(declaration: MeasureDeclaration): Measurement {
	const run = trusted_measure.run_command(declaration.command)
	const verdict: MeasureVerdict =
		run.kind === 'ok' ? measure_declaration.judge(declaration, run.output) : { kind: 'unreadable' }

	return { declaration, run, verdict }
}

function value_words(verdict: MeasureVerdict): string {
	return verdict.kind === 'unreadable' ? 'unreadable' : String(verdict.value)
}

// The result comment: the declaration, the value read, what follows and the command's own output.
// Script-emitted, so English (`run-merge.ts` → `park_comment`).
function report(measurement: Measurement): string {
	const { declaration, run, verdict } = measurement

	return [
		'`backlog:drive` ran the measurement declaration.',
		'',
		`- Declaration: ${measure_declaration.format(declaration)}`,
		`- Value: ${value_words(verdict)}`,
		`- Verdict: ${VERDICT_WORDS[verdict.kind]}`,
		'',
		FENCE,
		trusted_measure.text_of(run),
		FENCE,
	].join('\n')
}

async function close_passed(issue: string, measurement: Measurement): Promise<boolean> {
	const is_closed = await issue_measured_close.close(issue, report(measurement))
	const value = value_words(measurement.verdict)
	const bound = `${measurement.declaration.operator} ${String(measurement.declaration.threshold)}`

	if (is_closed) {
		await run_event_stream_emit.emit(
			run_event_stream.EVENT_KIND.MEASURED,
			`${issue_cite.plain(issue)} measured by backlog:drive: ${value} ${bound}`,
		)
	}

	return is_closed
}

// The result handed to the lane on the issue itself, which the child reads with its comments. A comment
// that cannot be posted still launches the lane: the child re-runs the declaration.
async function hand_over(issue: string, measurement: Measurement): Promise<false> {
	try {
		await git_gh_command.issue_comment(issue, report(measurement))
	} catch (error) {
		console.error(`Measurement result not posted: ${error_text.message_of(error)}`)
	}

	return false
}

// Whether the drive closed the issue by its declaration; `false` launches its lane.
async function closed(issue: string): Promise<boolean> {
	const declaration = await declared(issue)

	if (declaration === undefined) return false

	const measurement = measured(declaration)

	return measurement.verdict.kind === 'pass'
		? await close_passed(issue, measurement)
		: await hand_over(issue, measurement)
}

const backlog_measure_close = { closed }

export { backlog_measure_close }
