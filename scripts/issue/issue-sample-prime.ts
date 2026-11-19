import { statSync } from 'node:fs'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_rest } from '#scripts/gh/git-gh-issue-rest'
import { read_pull_by_etag } from '#scripts/gh/git-gh-pr-read'
import { git_gh_pr_too_large } from '#scripts/gh/git-gh-pr-too-large'
import { git_closes_keyword } from '#scripts/git/git-closes-keyword'
import { lane_ledger, type MergeEntry } from '#scripts/lane/lane-ledger'
import { issue_closing_pr } from './issue-closing-pr'
import { issue_observation_prime } from './issue-observation-prime'
import {
	issue_sample_gate,
	type Condition,
	type MergeSample,
	type MergesSince,
	type PullRead,
} from './issue-sample-gate'

// The reads `issue_sample_gate` waits on, made ahead where bodies first arrive (joshuafolkken/kit#4414):
// when the cited pull request merged, and the merges the lane ledger recorded. Kept apart from the
// gate so that only the primers reach the ledger's reader (joshuafolkken/kit#5220).

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
		return await read_pull_by_etag(pr)
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

// The windows read while the ledger kept one stamp, by their start; a new stamp drops them all.
interface WindowCache {
	stamp: string | undefined
	readonly by_since: Map<number, ReadonlyArray<MergeSample>>
}

// The ledger file's identity and size; `undefined` when it is absent.
function stamp_of(path: string): string | undefined {
	const stat = statSync(path, { throwIfNoEntry: false })

	return stat === undefined
		? undefined
		: `${String(stat.ino)}:${String(stat.size)}:${String(stat.mtimeMs)}`
}

function read_window(path: string, since_ms: number): ReadonlyArray<MergeSample> {
	return lane_ledger
		.read_since(path, since_ms)
		.entries.filter((entry): entry is MergeEntry => entry.kind === lane_ledger.KIND.MERGE)
}

function cached_window(
	path: string,
	cache: WindowCache,
	since_ms: number,
): ReadonlyArray<MergeSample> {
	const kept = cache.by_since.get(since_ms)

	if (kept !== undefined) return kept

	const merges = read_window(path, since_ms)

	cache.by_since.set(since_ms, merges)

	return merges
}

// joshuafolkken/kit#8057: the ledger's merges at or after `since_ms`, read from its tail on each
// judgement so a merge recorded since the prime counts; the whole ledger is never read. A window is read
// again only once the ledger changes, as the board judges each waiting issue on every redraw. An absent
// ledger records none.
function merges_of(path: string | undefined): MergesSince {
	const cache: WindowCache = { stamp: undefined, by_since: new Map() }

	return function merges(since_ms: number): ReadonlyArray<MergeSample> {
		const stamp = path === undefined ? undefined : stamp_of(path)

		if (path === undefined || stamp === undefined) return []
		if (stamp !== cache.stamp) cache.by_since.clear()
		cache.stamp = stamp

		return cached_window(path, cache, since_ms)
	}
}

// A failed read stays unread, so the next prime asks again.
async function remember(condition: Condition, ports: PrimePorts): Promise<void> {
	const read = condition.via === 'pull' ? ports.pull : ports.closing

	try {
		issue_sample_gate.record(condition, await read(condition.cited))
	} catch {
		issue_sample_gate.record(condition, undefined)
	}
}

// Reads ahead what the bodies' conditions need. Nothing is read for bodies that declare none.
async function prime(
	bodies: ReadonlyArray<string | undefined>,
	ports: PrimePorts = DEFAULT_PORTS,
): Promise<void> {
	await issue_observation_prime.prime(bodies)
	const unread = issue_sample_gate.unread_of(bodies)

	if (unread.length === 0) return

	issue_sample_gate.use_merges(merges_of(await ports.ledger_path()))
	await Promise.all(
		unread.map(async (condition) => {
			await remember(condition, ports)
		}),
	)
}

const issue_sample_prime = {
	prime,
	read_closing: read_closing_source,
	read_source,
}

export type { PrimePorts }
export { issue_sample_prime }
