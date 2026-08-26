import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { parse_json_object_safe } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import type { EpicChild } from './epic-graph'

// Reading an epic and its children from GitHub.
//
// All execution state lives on GitHub and nowhere else — no local state file. A run interrupted
// halfway is resumed by asking again, which is the whole reason `epic:next` can be the base of an
// unattended run (joshuafolkken/kit#860).

const CHILD_LIMIT = 200

const label_schema = z.object({ name: z.string() })
const blocker_schema = z.object({ number: z.number() })
// `gh issue view --json blockedBy` answers with a GraphQL connection — `{ nodes, totalCount }` —
// not a bare array. Measured against a real issue rather than assumed (joshuafolkken/kit#860).
const blocked_by_schema = z.object({ nodes: z.array(blocker_schema).default([]) }).optional()
const child_schema = z.object({
	number: z.number(),
	state: z.string(),
	labels: z.array(label_schema).default([]),
	blockedBy: blocked_by_schema,
})

const CLOSED = 'CLOSED'

// A shape surprise reads as an unreadable child rather than crashing the command: `gh`'s JSON is
// somebody else's contract, and `epic:next` is what a run asks when it needs to know where it stands.
function parse_child(raw: string): z.infer<typeof child_schema> | undefined {
	try {
		return parse_json_object_safe(raw, child_schema)
	} catch {
		return undefined
	}
}

function to_child(parsed: z.infer<typeof child_schema>, repo: string): EpicChild {
	return {
		number: parsed.number,
		repo,
		state: parsed.state.toUpperCase() === CLOSED ? CLOSED : 'OPEN',
		labels: parsed.labels.map((label) => label.name),
		blocked_by: (parsed.blockedBy?.nodes ?? []).map((blocker) => blocker.number),
	}
}

// One child's state, labels and native relations. A child that cannot be read is reported as
// missing rather than assumed closed: assuming would let an epic advance past a child nobody looked
// at.
async function fetch_child(issue_number: number, repo: string): Promise<EpicChild | undefined> {
	const raw = await git_gh_command.issue_get_state_and_relations(String(issue_number))
	if (raw === undefined) return undefined
	const parsed = parse_child(raw)
	if (parsed === undefined) return undefined

	return to_child(parsed, repo)
}

// What a batch read produced, with the children it could not read kept rather than dropped.
//
// Dropping them is not an option in either direction. An epic whose children all failed to read
// would otherwise look like an epic with no open children — "complete" — and a single unreadable
// child would vanish from the graph, so whatever it blocks would look unblocked and be run
// (joshuafolkken/kit#860).
interface FetchedChildren {
	children: ReadonlyArray<EpicChild>
	unreadable: ReadonlyArray<number>
	skipped: ReadonlyArray<number>
}

// Every child the epic's task list tracks, in the order the body lists them.
async function fetch_children(
	child_numbers: ReadonlyArray<number>,
	repo: string,
): Promise<FetchedChildren> {
	const limited = child_numbers.slice(0, CHILD_LIMIT)
	const fetched = await Promise.all(
		limited.map(async (issue_number) => await fetch_child(issue_number, repo)),
	)

	return {
		children: fetched.filter((child): child is EpicChild => child !== undefined),
		unreadable: limited.filter((_, index) => fetched[index] === undefined),
		skipped: child_numbers.slice(CHILD_LIMIT),
	}
}

interface EpicSnapshot {
	body: string | undefined
	children: ReadonlyArray<EpicChild>
	child_numbers: ReadonlyArray<number>
	unreadable: ReadonlyArray<number>
	skipped: ReadonlyArray<number>
	has_external_children: boolean
}

// The epic and its children, as one read. `has_external_children` is surfaced rather than silently
// ignored: a cross-repository child needs joshuafolkken/kit#864, and an epic that holds one is not
// fully answered by this command yet.
async function fetch_epic(epic_number: number, repo: string): Promise<EpicSnapshot> {
	const body = await git_gh_command.issue_get_body(String(epic_number))
	const child_numbers = git_epic_parse.parse_task_list_issue_numbers(body)
	const fetched = await fetch_children(child_numbers, repo)

	return {
		body,
		children: fetched.children,
		child_numbers,
		unreadable: fetched.unreadable,
		skipped: fetched.skipped,
		has_external_children: git_epic_parse.has_external_task_list_entry(body),
	}
}

const epic_fetch = {
	CHILD_LIMIT,
	fetch_child,
	fetch_children,
	fetch_epic,
}

export type { EpicSnapshot }
export { epic_fetch }
