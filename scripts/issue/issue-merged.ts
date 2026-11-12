import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_etag_read } from '#scripts/gh/git-gh-etag-read'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { read_json_listing } from '#scripts/git/parse-json-array'
import { MEASURED_LABEL } from '#scripts/issue/issue-labels'
import { z } from 'zod'

// Whether an issue was closed by a merge, read from its REST timeline. The
// issue's own `state_reason` cannot tell: a pull request's `closes #N` and a person's "Close as
// completed" both answer `completed`. What only a merge leaves is a merged pull request referencing
// the issue, so the answer is the conjunction — closed now, as completed, and referenced by a merged
// pull request. A manual "completed" close still reads as merged when a merged pull request also
// references the issue — the one case the timeline cannot separate — and every other doubt falls to
// `false`, because a sweep deletes work on this answer.
//
// **A measurement-only issue stands in for the merge with its `measured` label**: it changes no code,
// so no pull request closes it, and `josh issue:measured` labels it before closing it. A completed
// close while the label is on is the run's own, so every sweep reading this answer agrees on it.

const CLOSED_EVENT = 'closed'
const REOPENED_EVENT = 'reopened'
const LABELED_EVENT = 'labeled'
const UNLABELED_EVENT = 'unlabeled'
const CROSS_REFERENCED_EVENT = 'cross-referenced'
const MERGED_REFERENCE = 'merged-reference'
const PER_PAGE = 100
// A close by a pull request's `closes #N` carries no reason in the timeline; a person's "Close as
// completed" carries `completed`. Any other reason — `not_planned`, `duplicate` — is not a merge, and
// neither is one GitHub adds later.
const COMPLETED_REASONS: ReadonlySet<string> = new Set(['', 'completed'])
const FIELD_SEPARATOR = '\t'
const LINE_SEPARATOR = '\n'
// One `<event>\t<state_reason>` line per closed/reopened event, and a `merged-reference` line per
// merged pull request that cross-references the issue, and a `labeled` / `unlabeled` line per change of
// the `measured` label — the kinds the answer reads.
const TIMELINE_FILTER = [
	'.[]',
	`| if .event == "${CROSS_REFERENCED_EVENT}" and .source.issue.pull_request.merged_at != null`,
	String.raw`then "${MERGED_REFERENCE}\t"`,
	`elif .event == "${CLOSED_EVENT}" or .event == "${REOPENED_EVENT}"`,
	String.raw`then "\(.event)\t\(.state_reason // "")"`,
	`elif (.event == "${LABELED_EVENT}" or .event == "${UNLABELED_EVENT}") and .label.name == "${MEASURED_LABEL}"`,
	String.raw`then "\(.event)\t"`,
	'else empty end',
].join(' ')

interface TimelineRow {
	event: string
	reason: string
}

function parse_rows(raw: string): Array<TimelineRow> {
	return raw
		.split(LINE_SEPARATOR)
		.filter((line) => line !== '')
		.map((line) => {
			const [event = '', reason = ''] = line.split(FIELD_SEPARATOR)

			return { event, reason }
		})
}

// The last `labeled` / `unlabeled` event of the `measured` label is whether it is on now.
function is_measured(rows: ReadonlyArray<TimelineRow>): boolean {
	const last = rows.findLast((row) => row.event === LABELED_EVENT || row.event === UNLABELED_EVENT)

	return last?.event === LABELED_EVENT
}

// The last closed/reopened event is the issue's current state, so a reopened issue is not merged
// even with a merged reference from an earlier attempt.
function is_merged_close(rows: ReadonlyArray<TimelineRow>): boolean {
	const last = rows.findLast((row) => row.event === CLOSED_EVENT || row.event === REOPENED_EVENT)

	if (last?.event !== CLOSED_EVENT || !COMPLETED_REASONS.has(last.reason)) return false

	return is_measured(rows) || rows.some((row) => row.event === MERGED_REFERENCE)
}

// The fields of one timeline event `TIMELINE_FILTER` reads; GitHub's other fields are dropped.
const pull_request_schema = z.object({ merged_at: z.string().nullish() })
const source_schema = z.object({
	issue: z.object({ pull_request: pull_request_schema.optional() }).optional(),
})
const event_schema = z.object({
	event: z.string().default(''),
	state_reason: z
		.string()
		.nullish()
		.transform((reason) => reason ?? ''),
	label: z.object({ name: z.string() }).optional(),
	source: source_schema.optional(),
})

type TimelineEvent = z.infer<typeof event_schema>

const STATE_EVENTS: ReadonlySet<string> = new Set([CLOSED_EVENT, REOPENED_EVENT])
const LABEL_EVENTS: ReadonlySet<string> = new Set([LABELED_EVENT, UNLABELED_EVENT])

function merged_at_of(entry: TimelineEvent): string | null | undefined {
	return entry.source?.issue?.pull_request?.merged_at
}

function is_merged_reference(entry: TimelineEvent): boolean {
	return entry.event === CROSS_REFERENCED_EVENT && typeof merged_at_of(entry) === 'string'
}

function is_measured_change(entry: TimelineEvent): boolean {
	return LABEL_EVENTS.has(entry.event) && entry.label?.name === MEASURED_LABEL
}

// The row `TIMELINE_FILTER` makes of one event, built in TypeScript for a page read as JSON.
function row_of(entry: TimelineEvent): Array<TimelineRow> {
	if (is_merged_reference(entry)) return [{ event: MERGED_REFERENCE, reason: '' }]
	if (STATE_EVENTS.has(entry.event)) return [{ event: entry.event, reason: entry.state_reason }]

	return is_measured_change(entry) ? [{ event: entry.event, reason: '' }] : []
}

// The first page goes through the ETag layer (joshuafolkken/kit#6698), so a board re-reading a closed
// child's unchanged timeline every tick costs no rate limit. The ETag covers that page only, so a full
// page — more may follow — or one that does not parse is read whole with `--paginate` and the filter.
// The rows of a first page read as JSON; `undefined` for a full page or one that does not parse.
function page_rows(raw: string): Array<TimelineRow> | undefined {
	const page = read_json_listing(raw, event_schema)

	if (page.kind !== 'read' || page.rows.length >= PER_PAGE) return undefined

	return page.rows.flatMap((entry) => row_of(entry))
}

async function read_rows(issue: string): Promise<Array<TimelineRow>> {
	const path = `${git_gh_api_path.issue_api_path(issue)}/timeline?per_page=${String(PER_PAGE)}`
	const rows = page_rows(await git_gh_etag_read.read(path))

	if (rows !== undefined) return rows

	const raw = await git_gh_exec.exec_gh_api({
		path,
		should_paginate: true,
		jq_filter: TIMELINE_FILTER,
	})

	return parse_rows(raw)
}

// `undefined` when the timeline could not be read, so a caller that keeps the answer can tell "not
// merged" from "ask again".
async function read_merge_state(issue: string): Promise<boolean | undefined> {
	try {
		return is_merged_close(await read_rows(issue))
	} catch {
		return undefined
	}
}

async function read_merged(issue: string): Promise<boolean> {
	return (await read_merge_state(issue)) ?? false
}

const issue_merged = { is_merged_close, page_rows, parse_rows, read_merge_state, read_merged }

export type { TimelineRow }
export { issue_merged }
