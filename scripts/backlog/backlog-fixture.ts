import { auto_ok_fixture } from '#scripts/auto-ok/auto-ok-fixture'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { epic_schema } from '#scripts/epic/epic-index'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { listing_outcome } from '#scripts/git/git-gh-issue-list-fixture'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import type { OpenIssueData } from '#scripts/git/schemas'
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
// `error` verdict spawn a real `gh` (joshuafolkken/kit#1663). A case about the transport overrides it.
const REACHABLE_STATUS = 200

interface ChildInput {
	number: number
	state?: string
	labels?: ReadonlyArray<string>
	blocked_by?: ReadonlyArray<number>
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
}

// The shape a `number,state,labels,blockedBy` read answers with — `blockedBy` is a connection rather
// than a bare array, exactly as `epic-fetch.test.ts` records.
function gh_child(input: ChildInput): string {
	return JSON.stringify({
		number: input.number,
		state: input.state ?? 'OPEN',
		labels: (input.labels ?? []).map((name) => ({ name })),
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

function child_texts(children: ReadonlyArray<ChildInput>): Map<string, string> {
	return new Map(children.map((child) => [String(child.number), gh_child(child)]))
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

function stub_backlog(input: BacklogInput): void {
	const epics = input.epics ?? []
	const bodies = epic_bodies(epics)
	const children = child_texts(input.children ?? [])

	stub_environment()
	vi.spyOn(git_gh_command, 'issue_list_by_label_summary').mockResolvedValue(
		listing_outcome(JSON.stringify(input.opted_in ?? [])),
	)
	vi.spyOn(git_gh_command, 'issue_list_by_label').mockResolvedValue(
		listing_outcome(auto_ok_fixture.epic_listing(epics)),
	)
	vi.spyOn(git_gh_command, 'issue_get_body').mockImplementation(async (number) =>
		bodies.get(number),
	)
	vi.spyOn(git_gh_command, 'issue_get_state_and_relations').mockImplementation(async (number) =>
		children.get(number),
	)
	vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockResolvedValue([])
}

const backlog_fixture = {
	CHECKOUT_PATH,
	REACHABLE_STATUS,
	REPO,
	gh_child,
	stub_environment,
	stub_backlog,
}

export { backlog_fixture }
export type { BacklogInput, ChildInput, EpicInput }
