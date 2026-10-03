import { setTimeout } from 'node:timers/promises'
import semver from 'semver'
import { z } from 'zod'

const API_ROOT = 'https://api.github.com/repos'
const LATEST_PATH = '/releases/latest'
const REPOSITORY_PATTERN = /^[\w.-]+\/[\w.-]+$/u
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/u
const REQUEST_TIMEOUT_MS = 30_000
const NOT_FOUND_STATUS = 404
// A job skipped by its `if:` (or neutral) belongs to a run that succeeded; counting it would skip a
// lower tag whose release is still on its way.
const FAILED_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure'])
const POLL_INTERVAL_MS = 30_000
const MAX_WAIT_ATTEMPTS = 120
const RELEASE_SCHEMA = z.object({ tag_name: z.string().min(1) })
const NOTES_SCHEMA = z.object({ name: z.string().min(1), body: z.string().min(1) })
const RUN_SCHEMA = z.object({ id: z.number(), display_title: z.string() })
const JOB_SCHEMA = z.object({
	name: z.string(),
	status: z.string(),
	conclusion: z.string().nullable(),
})
const RUNS_SCHEMA = z.object({ workflow_runs: z.array(RUN_SCHEMA) })
const JOBS_SCHEMA = z.object({ jobs: z.array(JOB_SCHEMA) })

type ReleaseRequest = (url: string, init: RequestInit) => Promise<Response>
type Wait = () => Promise<void>

// What differs between repositories. `start_tag` is the last tag that predates automatic releases;
// without it the latest existing release is the floor. `workflow` names the publish workflow whose
// failed run lets a lower tag be skipped, and `jobs` the jobs in it that count (empty: every job).
interface ReleaseSettings {
	repository: string
	start_tag?: string | undefined
	workflow?: string | undefined
	jobs?: ReadonlyArray<string> | undefined
}

interface PublishOptions extends ReleaseSettings {
	tags?: ReadonlyArray<string>
	wait?: Wait
}

interface Client {
	request: ReleaseRequest
	token: string
	url: string
	workflow: string | undefined
	jobs: ReadonlyArray<string>
}

// `fallback` answers when no tag sits between the floor and the target; without one the floor itself
// is the latest release and the answer.
interface Ladder {
	tags: ReadonlyArray<string>
	floor: string | undefined
	fallback?: () => Promise<string>
	wait: Wait
}

function request_options(token: string, method: string, body?: object): RequestInit {
	return {
		method,
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${token}`,
			'X-GitHub-Api-Version': '2022-11-28',
		},
		...(body !== undefined && { body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	}
}

async function api_get(client: Client, path: string): Promise<Response> {
	return await client.request(`${client.url}${path}`, request_options(client.token, 'GET'))
}

async function api_post(client: Client, path: string, body: object): Promise<Response> {
	return await client.request(`${client.url}${path}`, request_options(client.token, 'POST', body))
}

async function read_response(response: Response): Promise<unknown> {
	if (!response.ok) throw new Error(`GitHub Releases API returned HTTP ${String(response.status)}`)

	return await response.json()
}

async function existing_release(client: Client, tag: string): Promise<boolean> {
	const response = await api_get(client, `/releases/tags/${encodeURIComponent(tag)}`)
	if (response.status === NOT_FOUND_STATUS) return false

	RELEASE_SCHEMA.parse(await read_response(response))

	return true
}

async function previous_tag(client: Client): Promise<string> {
	const response = await api_get(client, LATEST_PATH)

	return RELEASE_SCHEMA.parse(await read_response(response)).tag_name
}

async function latest_release(client: Client): Promise<string | undefined> {
	const response = await api_get(client, LATEST_PATH)
	if (response.status === NOT_FOUND_STATUS) return undefined

	return RELEASE_SCHEMA.parse(await read_response(response)).tag_name
}

function predecessor(
	tags: ReadonlyArray<string>,
	target: string,
	floor: string | undefined,
): string | undefined {
	return tags
		.filter(
			(tag) =>
				semver.valid(tag) &&
				(floor === undefined || semver.gt(tag, floor)) &&
				semver.lt(tag, target),
		)
		.toSorted((left, right) => semver.compare(right, left))[0]
}

function is_failed_job(job: z.infer<typeof JOB_SCHEMA>, names: ReadonlyArray<string>): boolean {
	if (job.status !== 'completed' || !FAILED_CONCLUSIONS.has(job.conclusion ?? '')) return false
	if (names.length === 0) return true

	return names.some((name) => job.name === name || job.name.startsWith(`${name} /`))
}

async function failed_publication(client: Client, tag: string): Promise<boolean> {
	if (client.workflow === undefined) return false

	const workflow = encodeURIComponent(client.workflow)
	const runs_response = await api_get(client, `/actions/workflows/${workflow}/runs?per_page=100`)
	const runs = RUNS_SCHEMA.parse(await read_response(runs_response)).workflow_runs
	const run = runs.find((item) => item.display_title === `Publish ${tag}`)
	if (!run) return false

	const jobs_response = await api_get(client, `/actions/runs/${String(run.id)}/jobs?per_page=100`)
	const { jobs } = JOBS_SCHEMA.parse(await read_response(jobs_response))

	return jobs.some((job) => is_failed_job(job, client.jobs))
}

async function default_wait(): Promise<void> {
	await setTimeout(POLL_INTERVAL_MS)
}

async function release_state(client: Client, tag: string): Promise<'ready' | 'failed' | 'pending'> {
	if (await existing_release(client, tag)) return 'ready'
	if (await failed_publication(client, tag)) return 'failed'

	return 'pending'
}

async function wait_for_release(client: Client, tag: string, wait: Wait): Promise<boolean> {
	for (let attempt = 0; attempt < MAX_WAIT_ATTEMPTS; attempt += 1) {
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		const state = await release_state(client, tag)
		if (state !== 'pending') return state === 'ready'

		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await wait()
	}

	throw new Error(`Timed out waiting for previous GitHub Release ${tag}`)
}

async function ladder_end(ladder: Ladder): Promise<string | undefined> {
	return ladder.fallback ? await ladder.fallback() : ladder.floor
}

// With no floor the repository has no release at all, so no lower tag will ever gain one: the
// nearest lower tag is the baseline as it stands, and none means notes without a baseline.
async function baseline_tag(
	client: Client,
	tag: string,
	ladder: Ladder,
): Promise<string | undefined> {
	const prior = predecessor(ladder.tags, tag, ladder.floor)
	if (ladder.floor === undefined) return prior
	if (!prior) return await ladder_end(ladder)

	return (await wait_for_release(client, prior, ladder.wait))
		? prior
		: await baseline_tag(client, prior, ladder)
}

function assert_older(previous: string | undefined, tag: string): void {
	if (previous !== undefined && !semver.lt(previous, tag)) {
		throw new Error(`Latest release ${previous} is not older than ${tag}`)
	}
}

async function build_ladder(client: Client, options: PublishOptions): Promise<Ladder> {
	const tags = options.tags ?? []
	const wait = options.wait ?? default_wait
	const { start_tag } = options

	if (start_tag !== undefined) {
		return { tags, wait, floor: start_tag, fallback: async () => await previous_tag(client) }
	}

	return { tags, wait, floor: await latest_release(client) }
}

async function generate_notes(
	client: Client,
	tag: string,
	previous: string | undefined,
): Promise<z.infer<typeof NOTES_SCHEMA>> {
	const response = await api_post(client, '/releases/generate-notes', {
		tag_name: tag,
		...(previous !== undefined && { previous_tag_name: previous }),
		configuration_file_path: '.github/release.yml',
	})

	return NOTES_SCHEMA.parse(await read_response(response))
}

async function create_release(
	client: Client,
	tag: string,
	previous: string | undefined,
): Promise<void> {
	const notes = await generate_notes(client, tag, previous)
	const response = await api_post(client, '/releases', {
		tag_name: tag,
		name: notes.name,
		body: notes.body,
		draft: false,
		prerelease: false,
	})

	RELEASE_SCHEMA.parse(await read_response(response))
}

function create_client(request: ReleaseRequest, token: string, settings: ReleaseSettings): Client {
	if (!REPOSITORY_PATTERN.test(settings.repository)) {
		throw new Error(`Invalid repository: ${settings.repository}`)
	}

	return {
		request,
		token,
		url: `${API_ROOT}/${settings.repository}`,
		workflow: settings.workflow,
		jobs: settings.jobs ?? [],
	}
}

async function publish(
	request: ReleaseRequest,
	token: string,
	tag: string,
	options: PublishOptions,
): Promise<string> {
	if (!TAG_PATTERN.test(tag)) throw new Error(`Invalid release tag: ${tag}`)

	const client = create_client(request, token, options)
	if (await existing_release(client, tag)) return 'already-published'

	const previous = await baseline_tag(client, tag, await build_ladder(client, options))

	assert_older(previous, tag)
	await create_release(client, tag, previous)

	return `published ${tag} from ${previous ?? 'the first commit'}`
}

const github_release = { publish }

export type { ReleaseSettings }
export { github_release }
