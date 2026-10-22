import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { MEASURED_LABEL } from '#scripts/issue/issue-labels'

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
const MERGED_REFERENCE = 'merged-reference'
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
	'| if .event == "cross-referenced" and .source.issue.pull_request.merged_at != null',
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

// `undefined` when the timeline could not be read, so a caller that keeps the answer can tell "not
// merged" from "ask again".
async function read_merge_state(issue: string): Promise<boolean | undefined> {
	try {
		const raw = await git_gh_exec.exec_gh_api({
			path: `${git_gh_api_path.issue_api_path(issue)}/timeline?per_page=100`,
			should_paginate: true,
			jq_filter: TIMELINE_FILTER,
		})

		return is_merged_close(parse_rows(raw))
	} catch {
		return undefined
	}
}

async function read_merged(issue: string): Promise<boolean> {
	return (await read_merge_state(issue)) ?? false
}

const issue_merged = { is_merged_close, parse_rows, read_merge_state, read_merged }

export type { TimelineRow }
export { issue_merged }
