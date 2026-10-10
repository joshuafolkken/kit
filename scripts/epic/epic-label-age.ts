import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'

// How long each lane holder has carried `in-progress`. The stale-label rule
// in `backlogrun-progress.md` is applied by age, and until this read the age was a hand-written
// `gh api …/timeline` query a parent ran per holder. `epic:next` now prints it beside each holder, so
// the number the rule is applied against is the one the scheduler already showed.
//
// **Read only in `epic:next`'s offer, and only when it names holders.** A timeline read per holder is
// a request per lane, so the listing polled by `run:progress` / `backlog:next` does not pay it.

// Matches the `Stale \`in-progress\`` row of the table in `backlogrun-progress.md`.
const STALE_MINUTES = 90
const MS_PER_MINUTE = 60_000
const TIMELINE_PAGE = 100

const LABELED_FILTER = `.[] | select(.event == "labeled" and (.label.name | ascii_downcase) == "${IN_PROGRESS_LABEL}") | .created_at`

// The newest time the label was applied. `absent` is a timeline holding no such event — the label is
// older than what the timeline keeps — and `unread` is a timeline that could not be read at all. Kept
// apart because only the first is a reason to call the label stale.
type LabeledAt = { kind: 'at'; at: string } | { kind: 'absent' } | { kind: 'unread' }

async function read_labeled_at(issue: number, repo: string): Promise<LabeledAt> {
	try {
		const raw = await git_gh_exec.exec_gh_api({
			path: `${git_gh_api_path.issue_api_path(String(issue), repo)}/timeline?per_page=${String(TIMELINE_PAGE)}`,
			should_paginate: true,
			jq_filter: LABELED_FILTER,
		})
		const at = raw.split('\n').findLast((line) => line.trim() !== '')

		return at === undefined ? { kind: 'absent' } : { kind: 'at', at }
	} catch {
		return { kind: 'unread' }
	}
}

function age_text(labeled_at: LabeledAt, now: Date): string {
	if (labeled_at.kind === 'unread') return 'label age unread'
	if (labeled_at.kind === 'absent') return `${IN_PROGRESS_LABEL} older than the timeline — stale`

	const minutes = Math.floor((now.getTime() - Date.parse(labeled_at.at)) / MS_PER_MINUTE)
	const stale = minutes > STALE_MINUTES ? ' — stale' : ''

	return `${IN_PROGRESS_LABEL} for ${String(minutes)} min${stale}`
}

async function read_ages(
	issues: ReadonlyArray<number>,
	repo: string,
	now: Date,
): Promise<ReadonlyMap<number, string>> {
	const ages = await Promise.all(
		issues.map(async (issue) => {
			const labeled_at = await read_labeled_at(issue, repo)

			return [issue, age_text(labeled_at, now)] as const
		}),
	)

	return new Map(ages)
}

const epic_label_age = {
	STALE_MINUTES,
	read_labeled_at,
	age_text,
	read_ages,
}

export type { LabeledAt }
export { epic_label_age }
