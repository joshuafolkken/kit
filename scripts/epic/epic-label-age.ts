import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_etag_read } from '#scripts/gh/git-gh-etag-read'
import { IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { json_value } from '#scripts/lib/json-value'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { z } from 'zod'

// How long each lane holder has carried `in-progress`. The stale-label rule
// in `backlogrun-progress.md` is applied by age, and until this read the age was a hand-written
// `gh api …/timeline` query a parent ran per holder. `epic:next` now prints it beside each holder, so
// the number the rule is applied against is the one the scheduler already showed.
//
// **Read only in `epic:next`'s offer, and only when it names holders.** A timeline read per holder is
// a request per lane, so the listing polled by `run:progress` / `backlog:next` does not pay it.

// Matches the `Stale \`in-progress\`` row of the table in `backlogrun-progress.md`.
const STALE_MINUTES = 90
const TIMELINE_PAGE = 100

const LABELED_EVENT = 'labeled'
const UNPARSED_TIMELINE_MESSAGE = 'timeline did not parse'

const label_schema = z.object({ name: z.string() })

const timeline_schema = z.array(
	z.object({
		event: z.string().nullish(),
		created_at: z.string().nullish(),
		label: label_schema.nullish(),
	}),
)

type TimelineEvent = z.infer<typeof timeline_schema>[number]

// The newest time the label was applied. `absent` is a timeline holding no such event — the label is
// older than what the timeline keeps — and `unread` is a timeline that could not be read at all. Kept
// apart because only the first is a reason to call the label stale.
type LabeledAt = { kind: 'at'; at: string } | { kind: 'absent' } | { kind: 'unread' }

function parse_events(raw: string): Array<unknown> {
	const events = json_value.parse_array(raw)

	if (events === undefined) throw new Error(UNPARSED_TIMELINE_MESSAGE)

	return events
}

// The timeline in one page while it fits in one, sent with the previous process's ETag: `epic:next`
// offers every minute, and a holder's timeline rarely moves between offers (joshuafolkken/kit#6636).
async function read_timeline(path: string): Promise<Array<unknown>> {
	return parse_events(await git_gh_etag_read.read_listing(path, TIMELINE_PAGE))
}

function is_in_progress_labeling(event: TimelineEvent): boolean {
	return event.event === LABELED_EVENT && event.label?.name.toLowerCase() === IN_PROGRESS_LABEL
}

async function read_labeled_at(issue: number, repo: string): Promise<LabeledAt> {
	try {
		const path = `${git_gh_api_path.issue_api_path(String(issue), repo)}/timeline?per_page=${String(TIMELINE_PAGE)}`
		const events = timeline_schema.parse(await read_timeline(path))
		const at = events.findLast((event) => is_in_progress_labeling(event))?.created_at

		return typeof at === 'string' ? { kind: 'at', at } : { kind: 'absent' }
	} catch {
		return { kind: 'unread' }
	}
}

function minutes_since(at: string, now: Date): number {
	return Math.floor((now.getTime() - Date.parse(at)) / MS_PER_MINUTE)
}

// Whether the label is past the window. An unread timeline is never stale: nothing is known about it.
function is_stale(labeled_at: LabeledAt, now: Date): boolean {
	if (labeled_at.kind === 'unread') return false
	if (labeled_at.kind === 'absent') return true

	return minutes_since(labeled_at.at, now) > STALE_MINUTES
}

function age_text(labeled_at: LabeledAt, now: Date): string {
	if (labeled_at.kind === 'unread') return 'label age unread'
	if (labeled_at.kind === 'absent') return `${IN_PROGRESS_LABEL} older than the timeline — stale`

	const stale = is_stale(labeled_at, now) ? ' — stale' : ''

	return `${IN_PROGRESS_LABEL} for ${String(minutes_since(labeled_at.at, now))} min${stale}`
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
	is_stale,
	age_text,
	read_ages,
}

export type { LabeledAt }
export { epic_label_age }
