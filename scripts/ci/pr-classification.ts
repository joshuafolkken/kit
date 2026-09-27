import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const CLASSIFICATION_LABELS: ReadonlyArray<string> = [
	'breaking-change',
	'enhancement',
	'bugfix',
	'other-change',
	'ignore-for-release',
]
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

	const selected = labels.filter((label) => CLASSIFICATION_LABELS.includes(label.toLowerCase()))

	if (selected.length > 1) {
		return `Choose exactly one release classification; found: ${selected.join(', ')}`
	}

	if (selected.length === 1 || author.endsWith('[bot]')) return undefined

	return `Choose one release classification: ${CLASSIFICATION_LABELS.join(', ')}`
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

const pr_classification = { classification_error, check_event }

export { pr_classification }
