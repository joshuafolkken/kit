import { auto_ok_fixture } from '#scripts/auto-ok/auto-ok-fixture'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { epic_schema } from '#scripts/epic/epic-index'
import { epic_solo_stale } from '#scripts/epic/epic-solo-stale'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { listing_outcome } from '#scripts/gh/git-gh-issue-list-fixture'
import type { IssueRead } from '#scripts/gh/git-gh-issue-read'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { defect_rate, type DefectRate } from '#scripts/issue/defect-rate'
import { defect_rate_cli } from '#scripts/issue/defect-rate-cli'
import { issue_cite } from '#scripts/issue/issue-cite'
import { RUN_LANE_LABEL, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { lane_await } from '#scripts/lane/lane-await'
import { vi } from 'vitest'

// One description of a backlog, stubbed across every read `josh backlog:next` makes.
//
// The command asks GitHub five different questions — the opted-in listing, the epic listing, each
// epic's body, each child's state, and this repository's name — and a case that stubbed them one at
// a time would say more about the stubbing than about the answer. Describing the backlog once and
// deriving all five keeps a case readable and keeps the epic body and the epic listing from
// disagreeing about the same epic.

const REPO = 'joshuafolkken/kit'
const CHECKOUT_PATH = '/checkouts/kit'

// GitHub answering normally, which is the sixth question the command asks — and the only one that is
// asked of the network rather than of a stub, so leaving it out would let a case that reaches the
// `error` verdict spawn a real `gh`. A case about the transport overrides it.
const REACHABLE_STATUS = 200

interface ChildInput {
	number: number
	state?: string
	labels?: ReadonlyArray<string>
	blocked_by?: ReadonlyArray<number>
	// The body the defect priority classifies the child by.
	body?: string
}

interface EpicInput {
	number: number
	children: ReadonlyArray<number>
	// Task-list rows naming a child in another repository, written `owner/repo#N`. They are not part
	// of the bare-number task list, so the epic index does not see them — which is what GitHub's own
	// reading does too.
	external?: ReadonlyArray<string>
}

interface BacklogInput {
	// The rows the `auto-ok` listing answers with — an epic root among them is what opts its children in.
	opted_in?: ReadonlyArray<OpenIssueData>
	// The open epics, whatever their labels: this is the listing that says which issues an epic tracks.
	epics?: ReadonlyArray<EpicInput>
	// The children a fetch can read. One left out is a child that could not be read.
	children?: ReadonlyArray<ChildInput>
	// The measured defect rate. Left out, the rate is at the baseline, so the order is the graph's own.
	defect_rate?: DefectRate
	// A measurement that could not be read at all.
	is_rate_unreadable?: boolean
	// The repository's open `in-progress` issues, which the `run:solo` gate reads on a `run` answer.
	// Left out, nothing is running.
	in_progress?: ReadonlyArray<OpenIssueData>
	// The `in-progress` holders no process is running for, each with a lane on this machine — a stale
	// label. Left out, every holder is running.
	stale?: ReadonlyArray<number>
	// The issues left without `run:solo` or `run:lane`. Every other child and
	// opted-in row is given `run:lane` unless it carries `run:solo`, so a case about something else is
	// not answered `triage`.
	untriaged?: ReadonlyArray<number>
}

const AT_BASELINE: DefectRate = {
	days: defect_rate.DEFAULT_WINDOW_DAYS,
	since: '2026-09-09',
	defects: 73,
	enhancements: 100,
	is_capped: false,
}

// The labels an issue is read with: `run:lane` added where the case left it judged.
function triaged_labels(
	number: number,
	labels: ReadonlyArray<string>,
	untriaged: ReadonlyArray<number>,
): ReadonlyArray<string> {
	if (untriaged.includes(number) || labels.includes(RUN_SOLO_LABEL)) return labels

	return [...labels, RUN_LANE_LABEL]
}

function triaged_row(row: OpenIssueData, untriaged: ReadonlyArray<number>): OpenIssueData {
	const names = triaged_labels(
		row.number,
		(row.labels ?? []).map((label) => label.name),
		untriaged,
	)

	return { ...row, labels: names.map((name) => ({ name })) }
}

// The shape a `number,state,labels,blockedBy` read answers with — `blockedBy` is a connection rather
// than a bare array, exactly as `epic-fetch.test.ts` records.
function child_labels(
	input: ChildInput,
	untriaged: ReadonlyArray<number>,
): ReadonlyArray<{ name: string }> {
	return triaged_labels(input.number, input.labels ?? [], untriaged).map((name) => ({ name }))
}

function gh_child(input: ChildInput, untriaged: ReadonlyArray<number> = []): string {
	return JSON.stringify({
		number: input.number,
		state: input.state ?? 'OPEN',
		labels: child_labels(input, untriaged),
		blockedBy: {
			nodes: (input.blocked_by ?? []).map((number) => ({ number })),
			totalCount: (input.blocked_by ?? []).length,
		},
	})
}

// The epic bodies, read back out of the listing the fixture already built, so a body a case reads
// through `issue_get_body` and the task list the epic index parses are the same text.
function epic_bodies(epics: ReadonlyArray<EpicInput>): Map<string, string> {
	const rows = parse_json_array_or_undefined(auto_ok_fixture.epic_listing(epics), epic_schema) ?? []

	const external = new Map(epics.map((epic) => [epic.number, epic.external ?? []]))

	return new Map(
		rows.map((row) => [
			String(row.number),
			[row.body ?? '', ...(external.get(row.number) ?? []).map((row_text) => `- [ ] ${row_text}`)]
				.filter((line) => line !== '')
				.join('\n'),
		]),
	)
}

// A child the fixture has text for, or a read that failed permanently — the two states the
// unclassified read expressed as a string and `undefined`. A case that wants
// the transport failure builds its own `unreachable` read instead.
function to_child_read(json: string | undefined): IssueRead {
	if (json === undefined) return { kind: 'unreadable', reason: 'rejected', status: 403 }

	return { kind: 'read', json }
}

function child_texts(
	children: ReadonlyArray<ChildInput>,
	untriaged: ReadonlyArray<number>,
): Map<string, string> {
	return new Map(children.map((child) => [String(child.number), gh_child(child, untriaged)]))
}

// Where this checkout is, who it is, and that GitHub is answering — the three the backlog itself
// says nothing about.
function stub_environment(): void {
	// The checkout map `epic_report` fills `RepoCandidates.path` from. Stubbed with a real entry so a
	// case can tell "this repository has no checkout here" — which would be a misreport — apart from
	// the map simply being empty.
	vi.spyOn(repo_discovery, 'discover_repositories').mockReturnValue(
		new Map([[REPO, CHECKOUT_PATH]]),
	)
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	vi.spyOn(git_gh_exec, 'exec_gh_api_status').mockResolvedValue(REACHABLE_STATUS)
}

// The two reads the defect priority adds: the rate, and each candidate's body.
function stub_defect_priority(input: BacklogInput): void {
	const bodies = new Map((input.children ?? []).map((child) => [String(child.number), child.body]))
	const measured =
		input.is_rate_unreadable === true ? undefined : (input.defect_rate ?? AT_BASELINE)

	vi.spyOn(defect_rate_cli, 'measure_window').mockResolvedValue(measured)
	vi.spyOn(git_gh_command, 'issue_get_body').mockImplementation(async (number) =>
		bodies.get(number),
	)
}

// The three label listings: the opted-in rows, the epics, and the `in-progress` holders the
// `run:solo` gate reads.
function stub_listings(input: BacklogInput, epics: ReadonlyArray<EpicInput>): void {
	const untriaged = input.untriaged ?? []
	const rows = (input.opted_in ?? []).map((row) => triaged_row(row, untriaged))

	vi.spyOn(git_gh_command, 'issue_list_by_label_summary').mockResolvedValue(
		listing_outcome(JSON.stringify(rows)),
	)
	vi.spyOn(git_gh_command, 'issue_list_by_label').mockResolvedValue(
		listing_outcome(auto_ok_fixture.epic_listing(epics)),
	)
	vi.spyOn(git_gh_command, 'issue_list_by_label_in_repo').mockResolvedValue(
		listing_outcome(JSON.stringify(input.in_progress ?? [])),
	)

	const stale = new Set((input.stale ?? []).map(String))

	vi.spyOn(lane_await, 'is_process_running_default').mockImplementation(
		(child) => !stale.has(child),
	)
	vi.spyOn(epic_solo_stale.io, 'local_lanes').mockResolvedValue(stale)
	vi.spyOn(epic_solo_stale.io, 'settle').mockResolvedValue()
}

function stub_backlog(input: BacklogInput): void {
	const epics = input.epics ?? []
	const bodies = epic_bodies(epics)
	const children = child_texts(input.children ?? [], input.untriaged ?? [])

	stub_environment()
	stub_listings(input, epics)
	// The classified reads. An epic the fixture has no body for is a body that
	// is simply absent, which is what it always meant here; a child it has no text for is a read that
	// failed for a reason asking again will not change, which is what an absent payload meant.
	vi.spyOn(git_gh_command, 'issue_get_body_classified').mockImplementation(async (number) => ({
		kind: 'read',
		text: bodies.get(number),
	}))
	vi.spyOn(git_gh_command, 'issue_get_state_and_relations_classified').mockImplementation(
		async (number) => to_child_read(children.get(number)),
	)
	vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockResolvedValue([])
	stub_defect_priority(input)
}

// How a plan row names this repository's issue, so a case asserts the citation
// through `issue_cite` rather than restating the link's shape.
function cite(number: number, title?: string): string {
	return issue_cite.reference(REPO, String(number), title)
}

const backlog_fixture = {
	AT_BASELINE,
	REPO,
	cite,
	stub_backlog,
}

export { backlog_fixture }
export type { BacklogInput, ChildInput, EpicInput }
