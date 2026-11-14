import { gh_author_association } from '#scripts/gh/gh-author-association'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { parse_json } from '#scripts/git/parse-json-array'
import { lane_early_push_count } from '#scripts/lane/lane-early-push-count'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { z } from 'zod'
import { issue_observation_gate, type ObservationSource } from './issue-observation-gate'

const comment_schema = z.object({
	...gh_author_association.author_fields_schema,
	body: z.string(),
	html_url: z.string(),
})

type ReadSource = (source: ObservationSource) => Promise<string | undefined>
type ReadLedger = () => Promise<ReadonlyArray<LedgerEntry>>

// A checkout with no ledger (outside a repository, or a test run) has no samples.
async function read_ledger(): Promise<ReadonlyArray<LedgerEntry>> {
	const path = await lane_ledger.target()

	return path === undefined ? [] : lane_ledger.read_entries(path)
}

async function read(source: ObservationSource): Promise<string | undefined> {
	const path = `${git_gh_api_path.issues_api_path(source.repo)}/comments/${source.comment}`
	const raw = await git_gh_exec.exec_gh_api({ path })
	const comment = parse_json.parse_json_object_or_undefined(raw, comment_schema)
	if (comment?.html_url !== source.url) return undefined
	const author = { ...gh_author_association.author_of(comment), repo: source.repo }

	return (await gh_author_association.is_trusted(author)) ? comment.body : undefined
}

async function remember(source: ObservationSource, read_source: ReadSource): Promise<void> {
	try {
		issue_observation_gate.record(source.url, await read_source(source))
	} catch {
		issue_observation_gate.record(source.url, undefined)
	}
}

// Only a declaration naming a ledger condition reads the ledger; a failed read counts nothing.
async function sample(
	sources: ReadonlyArray<ObservationSource>,
	read_entries: ReadLedger,
): Promise<void> {
	if (sources.every((source) => source.ledger === undefined)) return
	let entries: ReadonlyArray<LedgerEntry> = []

	try {
		entries = await read_entries()
	} catch {
		// An unreadable ledger holds no sample.
	}

	issue_observation_gate.record_sample(
		lane_early_push_count.MULTI_SLOT_EARLY_PUSH,
		lane_early_push_count.multi_slot_pushed(entries),
	)
}

// Re-read even a satisfied comment: a later correction or failed read must withhold the next offer.
async function prime(
	bodies: ReadonlyArray<string | undefined>,
	read_source: ReadSource = read,
	read_entries: ReadLedger = read_ledger,
): Promise<void> {
	const sources = issue_observation_gate.sources(bodies)
	const unique = new Map(sources.map((source) => [source.url, source]))

	await Promise.all([
		sample(sources, read_entries),
		...[...unique.values()].map(async (source) => {
			await remember(source, read_source)
		}),
	])
}

const issue_observation_prime = { prime }

export { issue_observation_prime }
