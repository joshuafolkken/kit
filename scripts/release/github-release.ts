import { setTimeout } from 'node:timers/promises'
import semver from 'semver'
import { z } from 'zod'

const API_URL = 'https://api.github.com/repos/joshuafolkken/kit/releases'
const WORKFLOW_RUNS_URL =
	'https://api.github.com/repos/joshuafolkken/kit/actions/workflows/publish.yml/runs?event=repository_dispatch&per_page=100'
const WORKFLOW_JOBS_URL = 'https://api.github.com/repos/joshuafolkken/kit/actions/runs'
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/u
const REQUEST_TIMEOUT_MS = 30_000
const NOT_FOUND_STATUS = 404
// Tags through v1.887.0 predate automatic GitHub Releases and must not block the first new release.
const AUTOMATION_START_TAG = 'v1.887.0'
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
const PREREQUISITES = ['publish-github', 'publish-npm', 'update-production']

type ReleaseRequest = (url: string, init: RequestInit) => Promise<Response>
type Wait = () => Promise<void>

interface PublishOptions {
	tags?: ReadonlyArray<string>
	wait?: Wait
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

async function read_response(response: Response): Promise<unknown> {
	if (!response.ok) throw new Error(`GitHub Releases API returned HTTP ${String(response.status)}`)

	return await response.json()
}

async function existing_release(
	request: ReleaseRequest,
	token: string,
	tag: string,
): Promise<boolean> {
	const response = await request(
		`${API_URL}/tags/${encodeURIComponent(tag)}`,
		request_options(token, 'GET'),
	)
	if (response.status === NOT_FOUND_STATUS) return false

	RELEASE_SCHEMA.parse(await read_response(response))

	return true
}

async function previous_tag(request: ReleaseRequest, token: string): Promise<string> {
	const response = await request(`${API_URL}/latest`, request_options(token, 'GET'))
	const release = RELEASE_SCHEMA.parse(await read_response(response))

	return release.tag_name
}

function predecessor(tags: ReadonlyArray<string>, target: string): string | undefined {
	return tags
		.filter(
			(tag) => semver.valid(tag) && semver.gt(tag, AUTOMATION_START_TAG) && semver.lt(tag, target),
		)
		.toSorted((left, right) => semver.compare(right, left))[0]
}

function is_failed_job(job: z.infer<typeof JOB_SCHEMA>): boolean {
	if (job.status !== 'completed' || job.conclusion === 'success') return false

	return PREREQUISITES.some((name) => job.name === name || job.name.startsWith(`${name} /`))
}

function publication_failed(jobs: Array<z.infer<typeof JOB_SCHEMA>>): boolean {
	return jobs.some((job) => is_failed_job(job))
}

async function failed_publication(
	request: ReleaseRequest,
	token: string,
	tag: string,
): Promise<boolean> {
	const runs_response = await request(WORKFLOW_RUNS_URL, request_options(token, 'GET'))
	const runs = RUNS_SCHEMA.parse(await read_response(runs_response)).workflow_runs
	const run = runs.find((item) => item.display_title === `Publish ${tag}`)
	if (!run) return false

	const url = `${WORKFLOW_JOBS_URL}/${String(run.id)}/jobs?per_page=100`
	const jobs_response = await request(url, request_options(token, 'GET'))

	return publication_failed(JOBS_SCHEMA.parse(await read_response(jobs_response)).jobs)
}

async function default_wait(): Promise<void> {
	await setTimeout(POLL_INTERVAL_MS)
}

async function release_state(
	request: ReleaseRequest,
	token: string,
	tag: string,
): Promise<'ready' | 'failed' | 'pending'> {
	if (await existing_release(request, token, tag)) return 'ready'
	if (await failed_publication(request, token, tag)) return 'failed'

	return 'pending'
}

async function wait_for_release(
	request: ReleaseRequest,
	token: string,
	tag: string,
	wait: Wait,
): Promise<boolean> {
	for (let attempt = 0; attempt < MAX_WAIT_ATTEMPTS; attempt += 1) {
		const state = await release_state(request, token, tag)
		if (state !== 'pending') return state === 'ready'

		await wait()
	}

	throw new Error(`Timed out waiting for previous GitHub Release ${tag}`)
}

async function baseline_tag(
	request: ReleaseRequest,
	token: string,
	tag: string,
	options: PublishOptions,
): Promise<string> {
	const prior = predecessor(options.tags ?? [], tag)
	if (!prior) return await previous_tag(request, token)

	if (!(await wait_for_release(request, token, prior, options.wait ?? default_wait))) {
		return await baseline_tag(request, token, prior, options)
	}

	return prior
}

async function generate_notes(
	request: ReleaseRequest,
	token: string,
	tag: string,
	previous: string,
): Promise<z.infer<typeof NOTES_SCHEMA>> {
	const response = await request(
		`${API_URL}/generate-notes`,
		request_options(token, 'POST', {
			tag_name: tag,
			previous_tag_name: previous,
			configuration_file_path: '.github/release.yml',
		}),
	)

	return NOTES_SCHEMA.parse(await read_response(response))
}

async function create_release(
	request: ReleaseRequest,
	token: string,
	tag: string,
	previous: string,
): Promise<void> {
	const notes = await generate_notes(request, token, tag, previous)
	const response = await request(
		API_URL,
		request_options(token, 'POST', {
			tag_name: tag,
			name: notes.name,
			body: notes.body,
			draft: false,
			prerelease: false,
		}),
	)

	RELEASE_SCHEMA.parse(await read_response(response))
}

async function publish(
	request: ReleaseRequest,
	token: string,
	tag: string,
	options: PublishOptions = {},
): Promise<string> {
	if (!TAG_PATTERN.test(tag)) throw new Error(`Invalid release tag: ${tag}`)
	if (await existing_release(request, token, tag)) return 'already-published'

	const previous = await baseline_tag(request, token, tag, options)

	if (!semver.lt(previous, tag)) {
		throw new Error(`Latest release ${previous} is not older than ${tag}`)
	}

	await create_release(request, token, tag, previous)

	return `published ${tag} from ${previous}`
}

const github_release = { publish }

export { github_release }
