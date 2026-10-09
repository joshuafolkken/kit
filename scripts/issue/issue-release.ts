import { DEPTH_0_LABEL, RELEASE_LABEL } from './issue-labels'

// The decisions behind `josh issue:release`, kept apart from the command
// that reads the network so each is a pure answer a test can pin. An Issue whose change reaches a
// consumer only once published is linked to the repository's release Issue, which it blocks until it
// merges.

interface ListingRow {
	number: number
}

function is_listing_row(value: unknown): value is ListingRow {
	if (typeof value !== 'object' || value === null) return false

	return Number.isSafeInteger(Reflect.get(value, 'number'))
}

// The open release Issue a listing of `release`-labelled Issues names, or `undefined` when it names
// none or is unreadable. One release publishes every merge since the last, so a repository holds one
// release Issue at a time; were a person to open a second, the oldest is the one the next release
// closes, so it is the one every new blocker joins.
function open_release_of(json: string): number | undefined {
	try {
		const parsed: unknown = JSON.parse(json)
		const rows = Array.isArray(parsed) ? parsed.filter((row) => is_listing_row(row)) : []

		return rows.length === 0 ? undefined : Math.min(...rows.map((row) => row.number))
	} catch {
		return undefined
	}
}

function title_of(repo: string): string {
	return `Release ${repo} (next version)`
}

// Plain English with no classification declaration: the Issue is not filed through `issue:file`, and
// its labels are `RELEASE_LABELS` rather than read off the body.
function body_of(repo: string): string {
	return [
		`Tracks the next release of ${repo}.`,
		'',
		'Every Issue this one is blocked by changes something a consumer can use only once it is published. Once they have merged, a person runs `pnpm josh release` in the primary checkout.',
		'',
		'Close this Issue once that release is published: the next blocker files a new one, so an open release Issue names only unreleased work.',
		'',
		'`auto-ok` is never applied to this Issue by a run; a person may apply it.',
		'',
	].join('\n')
}

// The release label and a depth: the subject of a release is what a consumer touches.
// Never `auto-ok`.
const RELEASE_LABELS: ReadonlyArray<string> = [RELEASE_LABEL, DEPTH_0_LABEL]

const issue_release = { RELEASE_LABELS, open_release_of, title_of, body_of }

export { issue_release }
