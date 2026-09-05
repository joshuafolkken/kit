import { time_github, type GhReader, type PullSearch } from './time-github'

// The pull-request listing the GitHub-side timing tests read, written once rather than in each test
// file (joshuafolkken/kit#1292).
//
// `time-github.ts` walks the listing and `time-pull-index.ts` answers a batch of issues from that
// same walk, so both suites need the same fixtures: a row, a page, a full page that forces the walk
// on, and a reader that answers from a script while recording what was asked for. Restating them
// beside each suite would be the clone `CLAUDE.md` prohibits, in the one place where a drift would
// make the two suites disagree about what the listing looks like.

const { PAGE_SIZE } = time_github

const CREATED = '2026-09-03T08:57:20Z'
const MERGED = '2026-09-03T09:00:32Z'
const SHA = 'abc123'

interface RawPull {
	number: number
	created_at: string
	merged_at: string
	updated_at: string
	head: { ref: string; sha: string }
}

// `updated_at` defaults to the merge instant, which is what GitHub sends for a pull request nothing
// has touched since it merged. A fixture that wants the awkward case — merged long ago, commented
// on today — says so by passing both.
function raw_pull(
	pull_number: number,
	branch: string,
	merged_at: string = MERGED,
	updated_at: string = merged_at,
): RawPull {
	return {
		number: pull_number,
		created_at: CREATED,
		merged_at,
		updated_at,
		head: { ref: branch, sha: SHA },
	}
}

// An open pull request carries a JSON `null`, which is what GitHub sends and what the schema's
// `nullish` exists for. Written as text rather than as a `null` literal so the fixture states the
// wire format.
function raw_json(pull_number: number, branch: string, merged_at: string): string {
	return `{"number":${String(pull_number)},"created_at":"${CREATED}","merged_at":"${merged_at}","updated_at":"${merged_at}","head":{"ref":"${branch}","sha":"${SHA}"}}`
}

// A reader that answers each requested path from a fixed script, and records what was asked for. The
// whole point of injecting it is that the paging, the cap and the parsing are provable without a
// network — a test that has to reach GitHub to prove the pagination stops is a test nobody runs.
function reader(pages: ReadonlyArray<ReadonlyArray<RawPull>>, asked: Array<string> = []): GhReader {
	return async (request_path: string) => {
		asked.push(request_path)

		// Anchored on the separator: `per_page=100` sits in front of `page=` in the same query string,
		// and an unanchored match reads the page size as the page number. A positional capture rather
		// than a named one, because a named group is read through an index signature that the type
		// check wants bracketed and the lint's dot-notation rule rewrites back.
		const found = /[&?]page=(\d+)/u.exec(request_path)?.[1]
		const index = found === undefined ? 0 : Number(found) - 1

		return JSON.stringify(pages[index] ?? [])
	}
}

function body_reader(body: string): GhReader {
	return async () => body
}

async function refuse(): Promise<string> {
	throw new Error('gh: 403')
}

// A row on a branch no test asks about, so a page of them never answers anything and the walk has to
// read on.
function other_pull(index: number): RawPull {
	const branch = `9${String(index)}-other`

	return raw_pull(index + 1, branch)
}

const PAGE_INDICES = Array.from({ length: PAGE_SIZE }, (_, index) => index)

function filled_page(): Array<RawPull> {
	return PAGE_INDICES.map((index) => other_pull(index))
}

// The three answers that are not a pull request, written once because several cases assert one of
// them in full — a partial assertion would pass against the wrong one of the three, which is the
// distinction `time-github.ts` exists to keep.
const EXHAUSTED_SEARCH: PullSearch = { pull: undefined, is_exhausted: true, is_failed: false }
const CAPPED_SEARCH: PullSearch = { pull: undefined, is_exhausted: false, is_failed: false }

// The listing reads among everything a `GhReader` was asked for. Two suites assert on the count —
// the batch pages it once for every child, and a child handed its result must page it not at all —
// so which paths count as the listing is one statement rather than one per suite.
// **The pull-request *listing*, and not everything sitting under `pulls`.** A pull request's own
// commit listing is `pulls/<number>/commits` (joshuafolkken/kit#1384) and its file listing is
// `pulls/<number>/files` (joshuafolkken/kit#1387), so a filter on the word alone counts both — and the
// suites that assert the listing was paged exactly once would read requests that never touched it.
const SUB_LISTINGS = ['/commits', '/files']

function pulls_asked(asked: ReadonlyArray<string>): Array<string> {
	return asked.filter(
		(request_path) =>
			request_path.includes('pulls') &&
			SUB_LISTINGS.every((listing) => !request_path.includes(listing)),
	)
}

const time_pull_fixture = {
	CREATED,
	MERGED,
	SHA,
	PAGE_INDICES,
	EXHAUSTED_SEARCH,
	CAPPED_SEARCH,
	raw_pull,
	raw_json,
	reader,
	body_reader,
	refuse,
	other_pull,
	filled_page,
	pulls_asked,
}

export type { RawPull }
export { time_pull_fixture }
