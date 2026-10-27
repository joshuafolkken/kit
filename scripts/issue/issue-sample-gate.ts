import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_rest } from '#scripts/gh/git-gh-issue-rest'
import { read_pull } from '#scripts/gh/git-gh-pr-read'
import { git_gh_pr_too_large } from '#scripts/gh/git-gh-pr-too-large'
import { git_closes_keyword } from '#scripts/git/git-closes-keyword'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { issue_cite } from './issue-cite'
import { issue_closing_pr } from './issue-closing-pr'
import { markdown_section } from './markdown-section'

// joshuafolkken/kit#4414: a follow-up measurement waits on samples, not on the calendar — a busy day
// collects enough merges before a dated start time, a quiet one not even after it. The body names the
// pull request whose effect it measures and how many merges the lane ledger must record after that
// pull request merged; the pickup holds the issue until then. The pull request's own merge is not a
// sample: `run:merge` records it, keyed by the issue it closes, after GitHub stamps `merged_at`.
//
// The readers that hold an issue back are synchronous and see only the body, so the one network fact
// the wait needs — when the pull request merged — is read ahead by `prime`, once per pull request per
// process, wherever bodies first arrive. A body nobody primed reads as waiting: offering it early is
// the defect this guards, and the next primed read releases it.
//
// joshuafolkken/kit#5051: a lane files its measurement follow-up before its own pull request exists —
// `josh ship` wants the deferral row first. So the condition may cite the issue instead (`CLOSING_FORMAT`),
// and `prime` resolves the merged pull request that closes it; until one exists the body waits as
// unmerged.

const BACKGROUND_HEADING = '## 背景'
const PREFIX = '- 実施可能条件:'
const CONDITION_PATTERN =
	/^#(?<cited>[1-9]\d*) (?<closing>を閉じる PR )?のマージ後 (?<count>[1-9]\d*) マージ$/u
const VALUE_FORMAT = '#<PR> のマージ後 <K> マージ'
const CLOSING_FORMAT = '#<issue> を閉じる PR のマージ後 <K> マージ'
const DECLARATION = `${PREFIX} ${VALUE_FORMAT}`
// The refusal ends in a line ready to paste (joshuafolkken/kit#5225).
const EXAMPLE = `${PREFIX} #5198 のマージ後 30 マージ`
const MALFORMED = `\`${PREFIX}\` must read \`${VALUE_FORMAT}\` or \`${CLOSING_FORMAT}\` with K at least 1\n${EXAMPLE}`

// `pull` cites the pull request itself, `issue` the issue whose closing pull request it waits on.
type Via = 'pull' | 'issue'

interface Condition {
	cited: number
	via: Via
	count: number
}

type SampleWait =
	| { kind: 'unread'; cited: number; via: Via }
	| { kind: 'unmerged'; cited: number; via: Via }
	| { kind: 'short'; cited: number; via: Via; counted: number; needed: number }

// One pull request as read: `merged_at` absent is one found unmerged, read again as it may merge since.
// `closes` is the issue its body closes, whose ledger merge is the pull request's own.
interface PullRead {
	merged_at: string | undefined
	closes: number | undefined
}

// The two fields `read_source` takes from a pull request, whichever endpoint served them.
interface PullFields {
	body?: string | null | undefined
	merged_at?: string | null | undefined
}

// `closing` reads the pull request that closes an issue; one not merged yet reads as unmerged.
interface PrimePorts {
	pull: (pr: number) => Promise<PullRead>
	closing: (issue: number) => Promise<PullRead>
	ledger_path: () => Promise<string | undefined>
}

interface LedgerState {
	path: string | undefined
}

// A cited number with no entry was never read. Keyed by `key_of`, as one number may be cited both ways.

const pull_by_key = new Map<string, PullRead>()
const ledger: LedgerState = { path: undefined }

function declared_value(body: string): string | undefined {
	const background = markdown_section.section_lines(body, BACKGROUND_HEADING).join('\n')
	const line = markdown_section
		.unfenced_lines(background)
		.map((text) => text.trim())
		.find((text) => text.startsWith(PREFIX))

	return line?.slice(PREFIX.length).trim()
}

function via_of(groups: Partial<Record<string, string>>): Via {
	return groups['closing'] === undefined ? 'pull' : 'issue'
}

// The declared condition, or `undefined` when there is none or it does not parse — a malformed one is
// refused by `issue:lint`, and holding a hand-edited one forever would lose the issue silently.
function condition_of(body = ''): Condition | undefined {
	const groups = CONDITION_PATTERN.exec(declared_value(body) ?? '')?.groups

	if (groups === undefined) return undefined

	return { cited: Number(groups['cited']), via: via_of(groups), count: Number(groups['count']) }
}

// The number the declared condition cites, or `undefined` when there is none or it does not parse.
function cited_number(body: string): number | undefined {
	return condition_of(body)?.cited
}

// The number cited by the given form only — the issue form cites an issue by design.
function cited_via(body: string, via: Via): number | undefined {
	const condition = condition_of(body)

	return condition?.via === via ? condition.cited : undefined
}

function key_of({ cited, via }: Pick<Condition, 'cited' | 'via'>): string {
	return `${via}:${String(cited)}`
}

function problems(body: string): ReadonlyArray<string> {
	const value = declared_value(body)

	return value === undefined || CONDITION_PATTERN.test(value) ? [] : [MALFORMED]
}

// joshuafolkken/kit#5241: GitHub refuses the single pull request read of a large one with 422 `too many
// files changed`, and a closing number carries no branch to read the listing row by. The issue
// endpoint serves the same pull request's body and merge time.
async function read_as_issue(pr: number): Promise<PullFields> {
	const json = await git_gh_exec.exec_gh_api({ path: git_gh_api_path.issue_api_path(String(pr)) })
	const issue = git_gh_issue_rest.parse_rest_issue(json)

	return { body: issue.body, merged_at: issue.pull_request?.merged_at }
}

async function read_fields(pr: number): Promise<PullFields> {
	try {
		return await read_pull(pr)
	} catch (error) {
		if (!git_gh_pr_too_large.is_too_many_files(error)) throw error

		return await read_as_issue(pr)
	}
}

async function read_source(pr: number): Promise<PullRead> {
	const pull = await read_fields(pr)
	const closes = git_closes_keyword.parse_closes_issue_number(pull.body ?? undefined)

	return {
		merged_at: pull.merged_at ?? undefined,
		closes: closes === undefined ? undefined : Number(closes),
	}
}

// The merged pull request closing the issue; `closes` is the issue itself, whichever pull request it is.
async function read_closing_source(issue: number): Promise<PullRead> {
	const pr = await issue_closing_pr.read_closing_number(issue)

	if (pr === undefined) return { merged_at: undefined, closes: issue }

	const { merged_at } = await read_source(pr)

	return { merged_at, closes: issue }
}

const DEFAULT_PORTS: PrimePorts = {
	pull: read_source,
	closing: read_closing_source,
	ledger_path: lane_ledger.target,
}

// A failed read stays unread, so the next prime asks again.
async function remember(condition: Condition, ports: PrimePorts): Promise<void> {
	const key = key_of(condition)
	const read = condition.via === 'pull' ? ports.pull : ports.closing

	try {
		pull_by_key.set(key, await read(condition.cited))
	} catch {
		pull_by_key.delete(key)
	}
}

function is_merge_known(condition: Condition): boolean {
	return pull_by_key.get(key_of(condition))?.merged_at !== undefined
}

function unread_of(bodies: ReadonlyArray<string | undefined>): Array<Condition> {
	const unread = bodies
		.map((body) => condition_of(body))
		.filter(
			(condition): condition is Condition => condition !== undefined && !is_merge_known(condition),
		)

	return [...new Map(unread.map((condition) => [key_of(condition), condition])).values()]
}

// Reads ahead what the bodies' conditions need. Nothing is read for bodies that declare none.
async function prime(
	bodies: ReadonlyArray<string | undefined>,
	ports: PrimePorts = DEFAULT_PORTS,
): Promise<void> {
	const unread = unread_of(bodies)

	if (unread.length === 0) return

	ledger.path = await ports.ledger_path()
	await Promise.all(
		unread.map(async (condition) => {
			await remember(condition, ports)
		}),
	)
}

function merges_after({ merged_at, closes }: PullRead & { merged_at: string }): number {
	if (ledger.path === undefined) return 0

	const since = Date.parse(merged_at)

	return lane_ledger
		.read_entries(ledger.path)
		.filter(
			(entry) =>
				entry.kind === lane_ledger.KIND.MERGE &&
				entry.issue !== closes &&
				Date.parse(entry.at) > since,
		).length
}

// What the body still waits on, or `undefined` when it declares nothing or has its samples.
function wait_of(body?: string): SampleWait | undefined {
	const condition = condition_of(body)

	if (condition === undefined) return undefined

	const { cited, via, count } = condition
	const pull = pull_by_key.get(key_of(condition))

	if (pull === undefined) return { kind: 'unread', cited, via }

	const { merged_at, closes } = pull

	if (merged_at === undefined) return { kind: 'unmerged', cited, via }

	const counted = merges_after({ merged_at, closes })

	return counted >= count ? undefined : { kind: 'short', cited, via, counted, needed: count }
}

function subject_of({ cited, via }: SampleWait): string {
	const plain = issue_cite.plain(cited)

	return via === 'pull' ? plain : `the pull request closing ${plain}`
}

// Why the body waits, for a reader that cites the issue itself.
function reason_of(wait: SampleWait): string {
	const subject = subject_of(wait)

	if (wait.kind === 'unread') return `until the merge of ${subject} is read`
	if (wait.kind === 'unmerged') return `until ${subject} merges`

	return `${String(wait.counted)}/${String(wait.needed)} merges after ${subject}`
}

function reset(): void {
	pull_by_key.clear()
	ledger.path = undefined
}

const issue_sample_gate = {
	DECLARATION,
	CLOSING_FORMAT,
	cited_number,
	cited_via,
	prime,
	problems,
	read_closing: read_closing_source,
	read_source,
	reason_of,
	reset,
	wait_of,
}

export type { PrimePorts, SampleWait }
export { issue_sample_gate }
