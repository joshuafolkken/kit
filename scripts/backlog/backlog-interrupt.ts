import type { BusyRead } from '#scripts/epic/epic-busy'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { epic_solo, type SoloGate } from '#scripts/epic/epic-solo'
import { epic_triage } from '#scripts/epic/epic-triage'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { open_issue_schema, type OpenIssueData } from '#scripts/git/git-schemas'
import { read_json_listing } from '#scripts/git/parse-json-array'
import { issue_cite } from '#scripts/issue/issue-cite'
import {
	AUTO_OK_LABEL,
	has_label_name,
	INTERRUPT_ROUTE_LABEL,
	RUN_LANE_LABEL,
} from '#scripts/issue/issue-labels'
import { issue_citation } from '#scripts/rules/issue-citation'
import { backlog_auto_triage } from './backlog-auto-triage'
import { backlog_pool } from './backlog-pool'

// The interrupt defects a run files outside the opted-in pool (joshuafolkken/kit#7860).
//
// An interrupt filed as needing a person's decision carries no `auto-ok`, so the pool never lists it: neither the
// triage nor the `run:solo` gate saw #7839 while it kept `main` red, and lanes went on launching for
// ten hours. The class read here is the one `backlog_auto_triage.lane_reason` leaves to the judgment
// — an open `route:interrupt` `bug` naming a verification-gate path. Until it is judged `run:lane`,
// opted in or closed, both offer paths start nothing new and say it awaits a person's decision
// (`hold`); an untriaged one is also named for the triage judgment.
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
	const { json } = await git_gh_command.issue_list_by_label_in_repo(
		INTERRUPT_ROUTE_LABEL,
		LISTING_LIMIT,
		repo,
		{ json_fields: LISTING_FIELDS },
	)

	return json === undefined ? [] : pending_of(json, repo)
}

// The pending interrupts the triage judgment has not labelled yet.
function untriaged(pending: ReadonlyArray<OpenIssueData>, repo: string): ReadonlyArray<EpicChild> {
	return epic_triage.untriaged(backlog_pool.to_children(pending, repo))
}

// The hold notice's words, so `backlog:offer` tells this wait from any other (`DECISION_CAUSE`).
const DECISION_MARK = 'awaits a decision on the verification path in'
const DECISION_CAUSE = 'decision'

function decision_message(pending: ReadonlyArray<OpenIssueData>, repo: string): string {
	const numbers = pending.map((issue) => issue_cite.plain_for('linked', issue.number)).join(', ')

	return issue_citation.linkify(
		`Interrupt ${numbers} ${DECISION_MARK} ${repo}; nothing new starts until each is labelled \`${RUN_LANE_LABEL}\`, given \`${AUTO_OK_LABEL}\`, or closed.`,
		repo,
	)
}

// Whether `text` — what an offer printed on stderr — says a pending interrupt held the candidates.
function is_decision_wait(text: string): boolean {
	return text.includes(DECISION_MARK)
}

// Every candidate of `repo` withheld while an interrupt awaits its decision; `undefined` when none
// does. Nobody runs a pending interrupt, so it is not read as a running `run:solo` holder.
function hold(
	result: EpicNextResult,
	busy: BusyRead,
	pending: ReadonlyArray<OpenIssueData>,
	repo: string,
): SoloGate | undefined {
	if (pending.length === 0) return undefined

	const notice = decision_message(pending, repo)

	return epic_solo.gate(result, busy, repo, (children) => ({
		offered: [],
		withheld: [...children],
		notice,
	}))
}

const backlog_interrupt = {
	DECISION_CAUSE,
	decision_message,
	hold,
	is_decision_wait,
	read,
	untriaged,
}

export { backlog_interrupt }
