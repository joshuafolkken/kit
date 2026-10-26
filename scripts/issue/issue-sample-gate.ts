import { read_pull } from '#scripts/gh/git-gh-pr-read'
import { git_closes_keyword } from '#scripts/git/git-closes-keyword'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { issue_cite } from './issue-cite'
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

const BACKGROUND_HEADING = '## 背景'
const PREFIX = '- 実施可能条件:'
const CONDITION_PATTERN = /^#(?<pr>[1-9]\d*) のマージ後 (?<count>[1-9]\d*) マージ$/u
const VALUE_FORMAT = '#<PR> のマージ後 <K> マージ'
const DECLARATION = `${PREFIX} ${VALUE_FORMAT}`
const MALFORMED = `\`${PREFIX}\` must read \`${VALUE_FORMAT}\` with K at least 1`

interface Condition {
	pr: number
	count: number
}

type SampleWait =
	| { kind: 'unread'; pr: number }
	| { kind: 'unmerged'; pr: number }
	| { kind: 'short'; pr: number; counted: number; needed: number }

// One pull request as read: `merged_at` absent is one found unmerged, read again as it may merge since.
// `closes` is the issue its body closes, whose ledger merge is the pull request's own.
interface PullRead {
	merged_at: string | undefined
	closes: number | undefined
}

interface PrimePorts {
	pull: (pr: number) => Promise<PullRead>
	ledger_path: () => Promise<string | undefined>
}

interface LedgerState {
	path: string | undefined
}

// A pull request with no entry was never read.

const pull_by_number = new Map<number, PullRead>()
const ledger: LedgerState = { path: undefined }

function declared_value(body: string): string | undefined {
	const background = markdown_section.section_lines(body, BACKGROUND_HEADING).join('\n')
	const line = markdown_section
		.unfenced_lines(background)
		.map((text) => text.trim())
		.find((text) => text.startsWith(PREFIX))

	return line?.slice(PREFIX.length).trim()
}

// The declared condition, or `undefined` when there is none or it does not parse — a malformed one is
// refused by `issue:lint`, and holding a hand-edited one forever would lose the issue silently.
function condition_of(body = ''): Condition | undefined {
	const groups = CONDITION_PATTERN.exec(declared_value(body) ?? '')?.groups

	if (groups === undefined) return undefined

	return { pr: Number(groups['pr']), count: Number(groups['count']) }
}

// The number the declared condition cites, or `undefined` when there is none or it does not parse.
function cited_number(body: string): number | undefined {
	return condition_of(body)?.pr
}

function problems(body: string): ReadonlyArray<string> {
	const value = declared_value(body)

	return value === undefined || CONDITION_PATTERN.test(value) ? [] : [MALFORMED]
}

async function read_source(pr: number): Promise<PullRead> {
	const pull = await read_pull(pr)
	const closes = git_closes_keyword.parse_closes_issue_number(pull.body ?? undefined)

	return {
		merged_at: pull.merged_at ?? undefined,
		closes: closes === undefined ? undefined : Number(closes),
	}
}

const DEFAULT_PORTS: PrimePorts = { pull: read_source, ledger_path: lane_ledger.target }

// A failed read stays unread, so the next prime asks again.
async function remember(pr: number, ports: PrimePorts): Promise<void> {
	try {
		pull_by_number.set(pr, await ports.pull(pr))
	} catch {
		pull_by_number.delete(pr)
	}
}

function is_merge_known(pr: number): boolean {
	return pull_by_number.get(pr)?.merged_at !== undefined
}

// Reads ahead what the bodies' conditions need. Nothing is read for bodies that declare none.
async function prime(
	bodies: ReadonlyArray<string | undefined>,
	ports: PrimePorts = DEFAULT_PORTS,
): Promise<void> {
	const unread = bodies
		.map((body) => condition_of(body)?.pr)
		.filter((pr): pr is number => pr !== undefined && !is_merge_known(pr))

	if (unread.length === 0) return

	ledger.path = await ports.ledger_path()
	await Promise.all(
		[...new Set(unread)].map(async (pr) => {
			await remember(pr, ports)
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

	const { pr, count } = condition
	const pull = pull_by_number.get(pr)

	if (pull === undefined) return { kind: 'unread', pr }

	const { merged_at, closes } = pull

	if (merged_at === undefined) return { kind: 'unmerged', pr }

	const counted = merges_after({ merged_at, closes })

	return counted >= count ? undefined : { kind: 'short', pr, counted, needed: count }
}

// Why the body waits, for a reader that cites the issue itself.
function reason_of(wait: SampleWait): string {
	const pr = issue_cite.plain(wait.pr)

	if (wait.kind === 'unread') return `until the merge of ${pr} is read`
	if (wait.kind === 'unmerged') return `until ${pr} merges`

	return `${String(wait.counted)}/${String(wait.needed)} merges after ${pr}`
}

function reset(): void {
	pull_by_number.clear()
	ledger.path = undefined
}

const issue_sample_gate = {
	DECLARATION,
	cited_number,
	prime,
	problems,
	read_source,
	reason_of,
	reset,
	wait_of,
}

export type { PrimePorts, SampleWait }
export { issue_sample_gate }
