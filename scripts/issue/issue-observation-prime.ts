import { gh_author_association } from '#scripts/gh/gh-author-association'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { parse_json } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import { issue_observation_gate, type ObservationSource } from './issue-observation-gate'

const comment_schema = z.object({
	...gh_author_association.author_fields_schema,
	body: z.string(),
	html_url: z.string(),
})

type ReadSource = (source: ObservationSource) => Promise<string | undefined>

async function read(source: ObservationSource): Promise<string | undefined> {
	const path = `${git_gh_api_path.issues_api_path(source.repo)}/comments/${source.comment}`
	const raw = await git_gh_exec.exec_gh_api({ path })
	const comment = parse_json.parse_json_object_or_undefined(raw, comment_schema)
	if (comment === undefined || comment.html_url !== source.url) return undefined
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

// Re-read even a satisfied comment: a later correction or failed read must withhold the next offer.
async function prime(
	bodies: ReadonlyArray<string | undefined>,
	read_source: ReadSource = read,
): Promise<void> {
	const sources = issue_observation_gate.sources(bodies)
	const unique = new Map(sources.map((source) => [source.url, source]))

	await Promise.all(
		[...unique.values()].map(async (source) => {
			await remember(source, read_source)
		}),
	)
}

const issue_observation_prime = { prime }

export { issue_observation_prime }
