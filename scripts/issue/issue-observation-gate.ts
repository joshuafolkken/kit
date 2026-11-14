import { lane_early_push_count } from '#scripts/lane/lane-early-push-count'
import { markdown_section } from './markdown-section'

// The issue pins both the evidence comment and every required key. Removing a task from the
// comment cannot release it. This is an explicit, evidence-backed attestation, not a stop-text guess.
const PREFIX = '<!-- josh:observation-wait'
const DECLARATION =
	/^<!-- josh:observation-wait:v1 (?<url>https:\/\/github\.com\/(?<repo>[\w.-]+\/[\w.-]+)\/issues\/[1-9]\d*#issuecomment-(?<comment>[1-9]\d*)) (?<keys>[\w-]+(?:,[\w-]+)*) -->$/u
// An optional ledger condition before the close releases the wait once the ledger holds that many
// samples (joshuafolkken/kit#7503); any metric but these is an unknown condition.
const LEDGER = / ledger:(?<metric>[\w-]+)>=(?<minimum>[1-9]\d*)(?= -->$)/u
const METRICS: ReadonlySet<string> = new Set([lane_early_push_count.MULTI_SLOT_EARLY_PUSH])
const EVIDENCE_HEADING = '## Observation evidence'
const TASK = /^- \[(?<checked>[ xX])\] (?<key>[\w-]+): (?<description>.+)$/u
const EVIDENCE = /\[evidence\]\(https:\/\/github\.com\/[\w./#?=&%-]+\)$/u

interface ObservationSource {
	url: string
	repo: string
	comment: string
	keys: ReadonlyArray<string>
	ledger?: LedgerCondition | undefined
}

interface LedgerCondition {
	metric: string
	minimum: number
}

interface ObservationWait {
	reason: string
	url?: string | undefined
}

const records = new Map<string, string | undefined>()
const samples = new Map<string, number>()

function is_evidenced(task: Partial<Record<string, string>> | undefined): boolean {
	return task?.['checked']?.toLowerCase() === 'x' && EVIDENCE.test(task['description'] ?? '')
}

function declarations(body = ''): ReadonlyArray<string> {
	return markdown_section.unfenced_lines(body).filter((line) => line.trimStart().startsWith(PREFIX))
}

function ledger_of(line: string): LedgerCondition | undefined {
	const groups = LEDGER.exec(line)?.groups
	if (groups === undefined) return undefined

	return { metric: String(groups['metric']), minimum: Number(groups['minimum']) }
}

function is_known(ledger: LedgerCondition | undefined): boolean {
	return ledger === undefined || METRICS.has(ledger.metric)
}

function source_of(line: string): ObservationSource | undefined {
	const trimmed = line.trim()
	const ledger = ledger_of(trimmed)
	if (!is_known(ledger)) return undefined
	const groups = DECLARATION.exec(trimmed.replace(LEDGER, ''))?.groups
	if (groups === undefined) return undefined

	return {
		url: String(groups['url']),
		repo: String(groups['repo']),
		comment: String(groups['comment']),
		keys: String(groups['keys']).split(','),
		ledger,
	}
}

function is_sampled(ledger: LedgerCondition | undefined): boolean {
	if (ledger === undefined) return false

	return (samples.get(ledger.metric) ?? 0) >= ledger.minimum
}

function sources(bodies: ReadonlyArray<string | undefined>): ReadonlyArray<ObservationSource> {
	return bodies.flatMap((body) => declarations(body).flatMap((line) => source_of(line) ?? []))
}

function pending(source: ObservationSource, body: string): ReadonlyArray<string> {
	const lines = markdown_section.section_lines(body, EVIDENCE_HEADING).join('\n')
	const tasks = markdown_section.unfenced_lines(lines).map((line) => TASK.exec(line)?.groups)

	return source.keys.filter((key) => {
		const matches = tasks.filter((task) => task?.['key'] === key)
		const [task] = matches

		return matches.length !== 1 || !is_evidenced(task)
	})
}

function wait_for(line: string): ObservationWait | undefined {
	const source = source_of(line)

	if (source === undefined) {
		return {
			reason: 'unknown observation condition; record a v1 evidence comment and required keys',
		}
	}

	if (is_sampled(source.ledger)) return undefined
	const body = records.get(source.url)

	if (body === undefined) {
		return { reason: `observation evidence unread: ${source.keys.join(', ')}`, url: source.url }
	}

	const missing = pending(source, body)

	return missing.length === 0
		? undefined
		: { reason: `observation evidence required: ${missing.join(', ')}`, url: source.url }
}

function wait_of(body?: string): ObservationWait | undefined {
	return declarations(body)
		.map((line) => wait_for(line))
		.find((wait) => wait !== undefined)
}

function record(url: string, body: string | undefined): void {
	records.set(url, body)
}

// The ledger's current count of a declared metric, primed with the evidence comments.
function record_sample(metric: string, count: number): void {
	samples.set(metric, count)
}

function reset(): void {
	records.clear()
	samples.clear()
}

const issue_observation_gate = { sources, wait_of, record, record_sample, reset }

export type { LedgerCondition, ObservationSource }
export { issue_observation_gate }
