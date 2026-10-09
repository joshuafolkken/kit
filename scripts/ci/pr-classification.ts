import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import {
	BREAKING_CHANGE_LABEL as BREAKING,
	BUGFIX_LABEL as BUGFIX,
	RELEASE_CLASSIFICATION_NAMES as CLASSIFICATION_LABELS,
	ENHANCEMENT_LABEL,
	type ReleaseClassification,
} from '#scripts/issue/issue-labels'
import { error_text } from '#scripts/lib/error-message'
import { z } from 'zod'

const CLASSIFICATION_SET: ReadonlySet<string> = new Set(CLASSIFICATION_LABELS)
const ISSUE_BUG_LABEL = 'bug'
// The line an Issue body declares its release classification with. A body written by a script
// (`josh propagate`'s upgrade issue) builds it with `declaration`, so the writer and this parser share
// one format.
const DECLARATION_PREFIX = '- リリース分類: '
const DECLARATION = new RegExp(`^${DECLARATION_PREFIX}(.+)$`, 'gmu')
const LEGACY_LABELS: ReadonlySet<string> = new Set(['semver-major', 'semver-minor'])

const LABEL = z.object({ name: z.string() })
const USER = z.object({ login: z.string() })
const PULL_REQUEST = z.object({ number: z.number(), user: USER })
const EVENT = z.object({
	pull_request: PULL_REQUEST,
	repository: z.object({ full_name: z.string() }),
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

function declaration(label: ReleaseClassification): string {
	return `${DECLARATION_PREFIX}${label}`
}

function is_classification(value: string): value is ReleaseClassification {
	return CLASSIFICATION_SET.has(value)
}

function release_candidates(
	candidates: ReadonlyArray<ReleaseClassification>,
): ReadonlyArray<ReleaseClassification> {
	if (!candidates.includes(BREAKING)) return candidates

	return candidates.filter((candidate) => candidate !== ENHANCEMENT_LABEL)
}

function issue_candidates(issue_json: string): ReadonlyArray<ReleaseClassification> {
	const issue = z
		.object({ labels: z.array(LABEL), body: z.string().nullable() })
		.parse(JSON.parse(issue_json))
	const names = issue.labels.map((label) => label.name.toLowerCase())
	const declared = [...(issue.body ?? '').matchAll(DECLARATION)].map((match) => match[1] ?? '')
	const candidates = [...release_candidates([...names, ...declared].filter(is_classification))]
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
			`Choose one release classification before opening the PR: ${CLASSIFICATION_LABELS.join(', ')}; found: ${selected.join(', ') || 'none'}. Add "${DECLARATION_PREFIX}<label>" to the Issue body.`,
		)
	}

	return label
}

// The labels as they stand when the check runs, not as the event carried them. `josh pr` opens the
// pull request and labels it in a second call, so the `opened` event carries none; judged from the
// payload, that run fails, and when it lands in the newer check suite GitHub keeps its red result —
// a rerun replays the same payload and fails again.
function fetch_current_labels(repository: string, pull_number: number): ReadonlyArray<string> {
	const path = `repos/${repository}/issues/${String(pull_number)}/labels`

	try {
		const names = git_gh_exec.exec_gh_api_sync({ path, jq_filter: '.[].name' })

		return names.split('\n').filter((name) => name !== '')
	} catch (error) {
		const detail = error_text.message_of(error)

		throw new Error(`Could not read the pull request labels: ${detail}`, { cause: error })
	}
}

function check_event(
	event_path: string,
	read_labels: typeof fetch_current_labels = fetch_current_labels,
): string | undefined {
	const event = EVENT.parse(JSON.parse(readFileSync(event_path, 'utf8')))
	const labels = read_labels(event.repository.full_name, event.pull_request.number)

	return classification_error(labels, event.pull_request.user.login)
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
	fetch_current_labels,
	declaration,
	is_classification,
	select_issue_classification,
}

export { pr_classification }
export {
	RELEASE_CLASSIFICATION_NAMES as CLASSIFICATION_LABELS,
	type ReleaseClassification,
} from '#scripts/issue/issue-labels'
