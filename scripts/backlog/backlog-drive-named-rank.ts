import { git_gh_command } from '#scripts/gh/git-gh-command'
import { open_issue_schema } from '#scripts/git/git-schemas'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { git_next_issues, type RankedIssue } from '#scripts/issue/git-next-issues'
import { issue_rank } from '#scripts/issue/issue-rank'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_invocation } from '#scripts/run/run-invocation'

interface Read {
	issue: string
	ranked: RankedIssue
}

const RANK_FIELDS = 'labels,body'
const ranked_schema = open_issue_schema.pick({ labels: true, body: true })
// An issue whose labels and body could not be read keeps every key at its zero, so it ranks as an
// unlabelled issue and stays in the order it was added among its equals.
const UNREAD: RankedIssue = {}
const NEUTRAL = issue_rank.dependency_ranks([])('')

function parsed(json: string): RankedIssue {
	try {
		return parse_json_object_or_undefined(json, ranked_schema) ?? UNREAD
	} catch {
		return UNREAD
	}
}

async function read_ranked(issue: string): Promise<Read> {
	const result = await git_gh_command.issue_view_json_classified(issue, RANK_FIELDS)

	return { issue, ranked: result.kind === 'read' ? parsed(result.json) : UNREAD }
}

// One chunk of additions in the pool's order (`git_next_issues.rank_row`, `issue_rank.rank`), stable
// on ties so equal issues keep the order they were added. A lone issue has nothing to pass, so it is
// not read. The additions are not part of one listing, so no dependency between them is ranked.
async function ranked_chunk(issues: ReadonlyArray<string>): Promise<Array<string>> {
	if (issues.length <= 1) return [...issues]
	const reads = await Promise.all(issues.map(async (issue) => await read_ranked(issue)))

	return issue_rank
		.rank(reads, (read) => git_next_issues.rank_row(read.ranked, NEUTRAL))
		.map((read) => read.issue)
}

function addition_sets(carry: RunCarry): { ahead: Set<string>; behind: Set<string> } {
	const declared = new Set(run_invocation.issue_numbers(carry.invocation))
	const added = carry.added ?? []
	const ahead = added.filter((entry) => entry.is_priority)
	const behind = added.filter((entry) => !entry.is_priority && !declared.has(entry.issue))

	return {
		ahead: new Set(ahead.map((entry) => String(entry.issue))),
		behind: new Set(behind.map((entry) => String(entry.issue))),
	}
}

// joshuafolkken/kit#9002: the issues `run:add` handed the run are offered in the pool's priority
// order, each chunk on its own — the ones ahead of the queue among themselves, the `--no-priority`
// ones behind it among themselves. The declared issues keep the typed order between them
// (`backlog-drive-named-launch.ts`), and so does the chunk each issue sits in (`run_carry_added.ordered`).
async function ranked(issues: ReadonlyArray<string>, carry: RunCarry): Promise<Array<string>> {
	const { ahead, behind } = addition_sets(carry)
	const declared = issues.filter((issue) => !ahead.has(issue) && !behind.has(issue))
	const [first, last] = await Promise.all([
		ranked_chunk(issues.filter((issue) => ahead.has(issue))),
		ranked_chunk(issues.filter((issue) => behind.has(issue))),
	])

	return [...first, ...declared, ...last]
}

export const backlog_drive_named_rank = { ranked }
