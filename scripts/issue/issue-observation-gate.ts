import { markdown_section } from './markdown-section'

// The issue pins both the evidence comment and every required key. Removing a task from the
// comment cannot release it. This is an explicit, evidence-backed attestation, not a stop-text guess.
const PREFIX = '<!-- josh:observation-wait'
const DECLARATION =
	/^<!-- josh:observation-wait:v1 (?<url>https:\/\/github\.com\/(?<repo>[\w.-]+\/[\w.-]+)\/issues\/[1-9]\d*#issuecomment-(?<comment>[1-9]\d*)) (?<keys>[\w-]+(?:,[\w-]+)*) -->$/u
const EVIDENCE_HEADING = '## Observation evidence'
const TASK = /^- \[(?<checked>[ xX])\] (?<key>[\w-]+): (?<description>.+)$/u
const EVIDENCE = /\[evidence\]\(https:\/\/github\.com\/[\w./#?=&%-]+\)$/u

interface ObservationSource {
	url: string
	repo: string
	comment: string
	keys: ReadonlyArray<string>
}

interface ObservationWait {
	reason: string
	url?: string | undefined
}

const records = new Map<string, string | undefined>()

function is_evidenced(task: Partial<Record<string, string>> | undefined): boolean {
	return task?.['checked']?.toLowerCase() === 'x' && EVIDENCE.test(task['description'] ?? '')
}

function declarations(body = ''): ReadonlyArray<string> {
	return markdown_section.unfenced_lines(body).filter((line) => line.trimStart().startsWith(PREFIX))
}

function source_of(line: string): ObservationSource | undefined {
	const groups = DECLARATION.exec(line.trim())?.groups
	if (groups === undefined) return undefined

	return {
		url: String(groups['url']),
		repo: String(groups['repo']),
		comment: String(groups['comment']),
		keys: String(groups['keys']).split(','),
	}
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

function reset(): void {
	records.clear()
}

const issue_observation_gate = { sources, wait_of, record, reset }

export type { ObservationSource }
export { issue_observation_gate }
