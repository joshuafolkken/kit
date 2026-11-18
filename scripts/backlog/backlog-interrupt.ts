import type { BusyRead } from '#scripts/epic/epic-busy'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_triage } from '#scripts/epic/epic-triage'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { open_issue_schema, type OpenIssueData } from '#scripts/git/git-schemas'
import { read_json_listing } from '#scripts/git/parse-json-array'
import {
	AUTO_OK_LABEL,
	has_label_name,
	INTERRUPT_ROUTE_LABEL,
	RUN_LANE_LABEL,
	RUN_SOLO_LABEL,
} from '#scripts/issue/issue-labels'
import { backlog_auto_triage } from './backlog-auto-triage'
import { backlog_pool } from './backlog-pool'

// The interrupt defects a run files outside the opted-in pool (joshuafolkken/kit#7860).
//
// An interrupt filed as needing a person's decision carries no `auto-ok`, so the pool never lists it: neither the
// triage nor the `run:solo` gate saw #7839 while it kept `main` red, and lanes went on launching for
// ten hours. The class read here is the one `backlog_auto_triage.lane_reason` leaves to the judgment
// — an open `route:interrupt` `bug` naming a verification-gate path. Until it is judged `run:lane` it
// is held as a running `run:solo` one, so `epic_solo`'s own rule starts nothing new; an untriaged one
// is also named for the triage judgment.
//
// A failed listing reads as no interrupt, so a transport fault never stops the backlog by itself.

const LISTING_LIMIT = 100
const LISTING_FIELDS = 'number,title,labels,createdAt,body'

function names_of(issue: OpenIssueData): ReadonlyArray<string> {
	return (issue.labels ?? []).map((label) => label.name)
}

function is_pending(issue: OpenIssueData, repo: string): boolean {
	const labels = names_of(issue)

	if (has_label_name(labels, AUTO_OK_LABEL) || has_label_name(labels, RUN_LANE_LABEL)) return false

	return backlog_auto_triage.lane_reason(backlog_pool.to_child(issue, repo)) === undefined
}

function pending_of(raw: string, repo: string): ReadonlyArray<OpenIssueData> {
	const listing = read_json_listing(raw, open_issue_schema)

	if (listing.kind !== 'read') return []

	return listing.rows.filter((issue) => is_pending(issue, repo))
}

async function read(repo: string): Promise<ReadonlyArray<OpenIssueData>> {
	const { json } = await git_gh_command.issue_list_by_label_summary(
		INTERRUPT_ROUTE_LABEL,
		LISTING_LIMIT,
		{ json_fields: LISTING_FIELDS },
	)

	return json === undefined ? [] : pending_of(json, repo)
}

// The pending interrupts the triage judgment has not labelled yet.
function untriaged(pending: ReadonlyArray<OpenIssueData>, repo: string): ReadonlyArray<EpicChild> {
	return epic_triage.untriaged(backlog_pool.to_children(pending, repo))
}

function as_solo(issue: OpenIssueData): OpenIssueData {
	if (has_label_name(names_of(issue), RUN_SOLO_LABEL)) return issue

	return { ...issue, labels: [...(issue.labels ?? []), { name: RUN_SOLO_LABEL }] }
}

// `busy` with every pending interrupt among the running `run:solo` holders. An unreadable or
// truncated read already starts nothing, so it is kept as it is.
function with_holders(busy: BusyRead, pending: ReadonlyArray<OpenIssueData>): BusyRead {
	if (pending.length === 0 || busy.kind === 'unreadable' || busy.kind === 'truncated') return busy

	const running = busy.kind === 'busy' ? busy.issues : []

	return { kind: 'busy', issues: [...running, ...pending.map((issue) => as_solo(issue))] }
}

const backlog_interrupt = { read, untriaged, with_holders }

export { backlog_interrupt }
