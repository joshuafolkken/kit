import { setTimeout } from 'node:timers/promises'
import semver from 'semver'
import { z } from 'zod'
import { github_release_runs, type PollState, type RunSource } from './github-release-runs'

const API_ROOT = 'https://api.github.com/repos'
const LATEST_PATH = '/releases/latest'
const REPOSITORY_PATTERN = /^[\w.-]+\/[\w.-]+$/u
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/u
const REQUEST_TIMEOUT_MS = 30_000
const NOT_FOUND_STATUS = 404
const POLL_INTERVAL_MS = 30_000
const MAX_WAIT_ATTEMPTS = 120
const RELEASE_SCHEMA = z.object({ tag_name: z.string().min(1) })
const NOTES_SCHEMA = z.object({ name: z.string().min(1), body: z.string().min(1) })
type ReleaseRequest = (url: string, init: RequestInit) => Promise<Response>
type Wait = () => Promise<void>

// What differs between repositories. `start_tag` is the last tag that predates automatic releases;
// without it the latest existing release is the floor. `workflow` names the publish workflow whose
// failed run lets a lower tag be skipped, and `jobs` the jobs in it that count (empty: every job).
// `await_publish` holds the tag's own release until its run in that workflow has succeeded, for a
// release started beside the publication rather than from inside it. `release_run_workflow` names
// the workflow whose run creates a tag's release, so a lower tag left without one can be told lost.
interface ReleaseSettings {
	repository: string
	start_tag?: string | undefined
	workflow?: string | undefined
	jobs?: ReadonlyArray<string> | undefined
	await_publish?: boolean | undefined
	release_run_workflow?: string | undefined
}

interface PublishOptions extends ReleaseSettings {
	tags?: ReadonlyArray<string>
	wait?: Wait
}

interface Client extends Omit<RunSource, 'read'> {
	request: ReleaseRequest
	token: string
	url: string
}

// `fallback` answers when no tag sits between the floor and the target; without one the floor itself
// is the latest release and the answer.
interface Ladder {
	tags: ReadonlyArray<string>
	floor: string | undefined
	fallback?: () => Promise<string>
	budget: Budget
}

// One allowance shared by every wait a release makes: waiting for its own publication and then for
// lower tags' releases must end inside the job's `timeout-minutes` together, not each on its own.
interface Budget {
	wait: Wait
	remaining: number
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

function run_source(client: Client): RunSource {
	return { ...client, read: async (path) => await read_response(await api_get(client, path)) }
}

async function default_wait(): Promise<void> {
	await setTimeout(POLL_INTERVAL_MS)
}

// The lost state is read before the release: a run completes only after creating the release, so a
// run that completes between the two reads still shows its release to the second one.
async function release_state(client: Client, tag: string): Promise<PollState> {
	const is_lost = await github_release_runs.is_release_lost(run_source(client), tag)
	if (await existing_release(client, tag)) return 'ready'

	return is_lost ? 'failed' : 'pending'
}

async function poll(
	read: () => Promise<PollState>,
	budget: Budget,
	subject: string,
): Promise<boolean> {
	while (budget.remaining > 0) {
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		const state = await read()
		if (state !== 'pending') return state === 'ready'

		budget.remaining -= 1
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await budget.wait()
	}

	throw new Error(`Timed out waiting for ${subject}`)
}

async function wait_for_release(client: Client, tag: string, budget: Budget): Promise<boolean> {
	return await poll(
		async () => await release_state(client, tag),
		budget,
		`previous GitHub Release ${tag}`,
	)
}

async function wait_for_publication(client: Client, tag: string, budget: Budget): Promise<boolean> {
	const { workflow } = client
	if (workflow === undefined) throw new Error('Waiting for the publication needs RELEASE_WORKFLOW')

	return await poll(
		async () => await github_release_runs.publication_state(run_source(client), workflow, tag),
		budget,
		`Publish ${tag}`,
	)
}

async function is_publication_ready(
	client: Client,
	tag: string,
	options: PublishOptions,
	budget: Budget,
): Promise<boolean> {
	if (options.await_publish !== true) return true

	return await wait_for_publication(client, tag, budget)
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

	return (await wait_for_release(client, prior, ladder.budget))
		? prior
		: await baseline_tag(client, prior, ladder)
}

function assert_older(previous: string | undefined, tag: string): void {
	if (previous !== undefined && !semver.lt(previous, tag)) {
		throw new Error(`Latest release ${previous} is not older than ${tag}`)
	}
}

async function build_ladder(
	client: Client,
	options: PublishOptions,
	budget: Budget,
): Promise<Ladder> {
	const tags = options.tags ?? []
	const { start_tag } = options

	if (start_tag !== undefined) {
		return { tags, budget, floor: start_tag, fallback: async () => await previous_tag(client) }
	}

	return { tags, budget, floor: await latest_release(client) }
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
		release_run_workflow: settings.release_run_workflow,
	}
}

function create_budget(options: PublishOptions): Budget {
	return { wait: options.wait ?? default_wait, remaining: MAX_WAIT_ATTEMPTS }
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

	const budget = create_budget(options)

	if (!(await is_publication_ready(client, tag, options, budget))) {
		return `skipped ${tag}: Publish ${tag} did not succeed`
	}

	const previous = await baseline_tag(client, tag, await build_ladder(client, options, budget))

	assert_older(previous, tag)
	await create_release(client, tag, previous)

	return `published ${tag} from ${previous ?? 'the first commit'}`
}

const github_release = { publish }

export type { ReleaseSettings }
export { github_release }
