import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_measured_close } from '#scripts/issue/issue-measured-close'
import {
	measure_declaration,
	type MeasureDeclaration,
	type MeasureVerdict,
} from '#scripts/issue/measure-declaration'
import { trusted_measure, type CommandRun, type TrustedBody } from '#scripts/issue/trusted-measure'
import { session_language } from '#scripts/josh/session-language'
import { lane_value_missing } from '#scripts/lane/lane-value-missing'
import { error_text } from '#scripts/lib/error-message'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// joshuafolkken/kit#4621: the drive runs a due issue's measurement declaration (`measure-declaration.ts`)
// before it opens a lane. A value within the bound closes the issue the way `issue:measured` does — the
// result comment, the `measured` label, the close and the epic's progress — and puts a `measured` event
// on the stream, so no lane is spent. A `lane:value` that failed for want of a sample
// (`lane-value-missing.ts`) is a sample condition not yet met (joshuafolkken/kit#6503): the result is
// commented and the issue waits, since a lane can measure nothing either. Anything else — no
// declaration, an untrusted body, a value out of bound, any other failed command, output that is not
// one number — launches the lane as before; where a command ran, its result is commented first, so the
// child starts from the measurement, not a re-run.

const FENCE = '```'

// A drive's verdict: the declaration's own, or no sample to judge yet.
type DriveVerdict = MeasureVerdict | { kind: 'unsampled' }

// The result comment's prose, one table per session language. `sample condition not met` stays in
// English in both: the docs and the `sample-wait` event name the comment by it.
interface ReportWords {
	lead: string
	declaration: string
	value: string
	verdict: string
	verdicts: Readonly<Record<DriveVerdict['kind'], string>>
}

const ENGLISH_REPORT_WORDS: ReportWords = {
	lead: '`backlog:drive` ran the measurement declaration.',
	declaration: 'Declaration',
	value: 'Value',
	verdict: 'Verdict',
	verdicts: {
		pass: 'within the bound, so the issue is closed without a lane.',
		fail: 'out of the bound, so the issue goes to a lane.',
		unreadable: 'no value could be read from the output, so the issue goes to a lane.',
		unsampled:
			'sample condition not met — no sample to read yet, so the issue waits without a lane.',
	},
}

const JAPANESE_REPORT_WORDS: ReportWords = {
	lead: '`backlog:drive` が計測宣言を実行しました。',
	declaration: '宣言',
	value: '値',
	verdict: '判定',
	verdicts: {
		pass: '範囲内のため、レーンを使わずに Issue を閉じます。',
		fail: '範囲外のため、Issue をレーンに渡します。',
		unreadable: '出力から値を読めなかったため、Issue をレーンに渡します。',
		unsampled:
			'sample condition not met — 読む標本がまだ無いため、レーンを使わずに Issue を待たせます。',
	},
}

function report_words(): ReportWords {
	const { lang } = session_language.resolve_session_lang()

	return session_language.is_japanese(lang) ? JAPANESE_REPORT_WORDS : ENGLISH_REPORT_WORDS
}

// What the drive does with the issue: closed by its declaration, waiting for a sample, or its lane.
type MeasureOutcome = 'closed' | 'wait' | 'launch'

interface Measurement {
	declaration: MeasureDeclaration
	run: CommandRun
	verdict: DriveVerdict
}

function verdict_of(declaration: MeasureDeclaration, run: CommandRun): DriveVerdict {
	if (run.kind === 'ok') return measure_declaration.judge(declaration, run.output)

	return lane_value_missing.is_unsampled(run.message)
		? { kind: 'unsampled' }
		: { kind: 'unreadable' }
}

function measured(declaration: MeasureDeclaration, source: TrustedBody): Measurement {
	const run = trusted_measure.run_command(declaration.command, source)

	return { declaration, run, verdict: verdict_of(declaration, run) }
}

async function declared(issue: string): Promise<Measurement | undefined> {
	// The REST memo also serves split assessment (10-second TTL, invalidated by writes).
	// An unverified body may only skip execution; it never authorizes a command.
	const body = await git_gh_command.issue_get_body(issue)

	if (body !== undefined && measure_declaration.parse(body) === undefined) return undefined

	const read = await trusted_measure.read_trusted_body(issue)

	if (read.kind === 'refused') return undefined

	const declaration = measure_declaration.parse(read.body)

	return declaration === undefined ? undefined : measured(declaration, read)
}

function value_words(verdict: DriveVerdict): string {
	return 'value' in verdict ? String(verdict.value) : verdict.kind
}

// The result comment: the declaration, the value read, what follows and the command's own output.
// The prose follows the session language; the declaration, value and output are data.
function report(measurement: Measurement): string {
	const { declaration, run, verdict } = measurement
	const words = report_words()

	return [
		words.lead,
		'',
		`- ${words.declaration}: ${measure_declaration.format(declaration)}`,
		`- ${words.value}: ${value_words(verdict)}`,
		`- ${words.verdict}: ${words.verdicts[verdict.kind]}`,
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
			`${issue_cite.plain_for('program', issue)} measured by backlog:drive: ${value} ${bound}`,
		)
	}

	return is_closed
}

// A wait goes on the stream, so a reader with only the stream keeps the issue out of the offer too.
async function waited(issue: string): Promise<MeasureOutcome> {
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.SAMPLE_WAIT,
		`${issue_cite.plain_for('program', issue)} waiting: sample condition not met`,
	)

	return 'wait'
}

// The result left on the issue itself, which the child reads with its comments. A comment that cannot
// be posted changes nothing: a lane re-runs the declaration, and a wait re-measures on the next drive.
async function hand_over(issue: string, measurement: Measurement): Promise<MeasureOutcome> {
	try {
		await git_gh_command.issue_comment(issue, report(measurement))
	} catch (error) {
		console.error(`Measurement result not posted: ${error_text.message_of(error)}`)
	}

	return measurement.verdict.kind === 'unsampled' ? await waited(issue) : 'launch'
}

// What the drive does with the issue by its declaration; `launch` opens its lane.
async function outcome(issue: string): Promise<MeasureOutcome> {
	const measurement = await declared(issue)

	if (measurement === undefined) return 'launch'
	if (measurement.verdict.kind !== 'pass') return await hand_over(issue, measurement)

	return (await close_passed(issue, measurement)) ? 'closed' : 'launch'
}

const backlog_measure_close = { outcome }

export type { MeasureOutcome }
export { backlog_measure_close }
