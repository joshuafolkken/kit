import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const BUGFIX = 'bugfix'
const BREAKING = 'breaking-change'
const CLASSIFICATION_LABELS = [
	BREAKING,
	'enhancement',
	BUGFIX,
	'other-change',
	'ignore-for-release',
] as const
type ReleaseClassification = (typeof CLASSIFICATION_LABELS)[number]
const CLASSIFICATION_SET: ReadonlySet<string> = new Set(CLASSIFICATION_LABELS)
const ISSUE_BUG_LABEL = 'bug'
const DECLARATION = /^- リリース分類: (.+)$/gmu
const LEGACY_LABELS: ReadonlySet<string> = new Set(['semver-major', 'semver-minor'])

const LABEL = z.object({ name: z.string() })
const USER = z.object({ login: z.string() })
const PULL_REQUEST = z.object({ user: USER, labels: z.array(LABEL) })
const EVENT = z.object({
	pull_request: PULL_REQUEST,
})

function classification_error(labels: ReadonlyArray<string>, author: string): string | undefined {
	const legacy = labels.filter((label) => LEGACY_LABELS.has(label.toLowerCase()))
	if (legacy.length > 0) return `Remove legacy release labels: ${legacy.join(', ')}`

	const selected = labels.filter((label) => CLASSIFICATION_SET.has(label.toLowerCase()))

	if (selected.length > 1) {
		return `Choose exactly one release classification; found: ${selected.join(', ')}`
	}

	if (selected.length === 1 || author.endsWith('[bot]')) return undefined

	return `Choose one release classification: ${CLASSIFICATION_LABELS.join(', ')}`
}

function is_classification(value: string): value is ReleaseClassification {
	return CLASSIFICATION_SET.has(value)
}

function issue_candidates(issue_json: string): ReadonlyArray<ReleaseClassification> {
	const issue = z
		.object({ labels: z.array(LABEL), body: z.string().nullable() })
		.parse(JSON.parse(issue_json))
	const names = issue.labels.map((label) => label.name.toLowerCase())
	const declared = [...(issue.body ?? '').matchAll(DECLARATION)].map((match) => match[1] ?? '')
	const candidates = [...names, ...declared].filter(is_classification)
	const unknown = declared.filter((value) => !is_classification(value))

	if (unknown.length > 0) throw new Error(`Unknown release classification: ${unknown.join(', ')}`)

	if (names.includes(ISSUE_BUG_LABEL) && !candidates.includes(BREAKING)) {
		candidates.push(BUGFIX)
	}

	return candidates
}

function select_issue_classification(issue_json: string): ReleaseClassification {
	const candidates = issue_candidates(issue_json)
	const selected = [...new Set(candidates)]
	const [label] = selected

	if (label === undefined || selected.length > 1) {
		throw new Error(
			`Choose one release classification before opening the PR: ${CLASSIFICATION_LABELS.join(', ')}; found: ${selected.join(', ') || 'none'}. Add "- リリース分類: <label>" to the Issue body.`,
		)
	}

	return label
}

function check_event(event_path: string): string | undefined {
	const event = EVENT.parse(JSON.parse(readFileSync(event_path, 'utf8')))

	return classification_error(
		event.pull_request.labels.map((label) => label.name),
		event.pull_request.user.login,
	)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const event_path = process.env['GITHUB_EVENT_PATH']
	if (!event_path) throw new Error('GITHUB_EVENT_PATH is required')

	const error = check_event(event_path)

	if (error) {
		console.error(`::error::${error}`)
		process.exitCode = 1
	}
}

const pr_classification = {
	classification_error,
	check_event,
	is_classification,
	select_issue_classification,
}

export { pr_classification, CLASSIFICATION_LABELS, type ReleaseClassification }
