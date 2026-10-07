import { describe, expect, it, vi } from 'vitest'
import { github_release } from './github-release'

const TAG = 'v1.889.0'
const LOWER_TAG = 'v1.888.0'
const FLOOR = 'v1.887.0'
const TOKEN = 'test-token'
const PUBLISH_WORKFLOW = 'publish.yml'
// kit's Publish run creates its tag's release, so a finished run without one means none is coming.
const KIT = {
	repository: 'joshuafolkken/kit',
	start_tag: FLOOR,
	workflow: PUBLISH_WORKFLOW,
	jobs: ['publish-npm'],
	release_run_workflow: PUBLISH_WORKFLOW,
	tags: [LOWER_TAG],
}
const LOWER_RELEASE_RUN = `GitHub Release ${LOWER_TAG}`
// A consumer's lower tag is released by a separate `GitHub Release <tag>` run, which can still be at
// work after the tag's Publish run has finished.
const CONSUMER = {
	repository: 'acme/app',
	workflow: PUBLISH_WORKFLOW,
	await_publish: true,
	release_run_workflow: 'github-release.yml',
	tags: [LOWER_TAG],
}

function response(status: number, body: unknown): Response {
	return Response.json(body, { status })
}

function missing_response(): Response {
	return new Response(undefined, { status: 404 })
}

function runs(titles: ReadonlyArray<string>, status: string): Response {
	return response(200, {
		workflow_runs: titles.map((title, id) => ({ id, display_title: title, status })),
	})
}

function release_answers(): Array<Response> {
	return [response(200, { name: TAG, body: 'Changes' }), response(201, { tag_name: TAG })]
}

type ReleaseRequest = Parameters<typeof github_release.publish>[0]

function lost_check(publish_status: string): Array<Response> {
	return [runs([`Publish ${LOWER_TAG}`], publish_status), response(200, { jobs: [] })]
}

// Each poll reads the lower tag's Publish run before its release.
function kit_request(...answers: Array<Response>): ReleaseRequest {
	const request = vi.fn()

	for (const answer of [missing_response(), ...answers, ...release_answers()]) {
		request.mockResolvedValueOnce(answer)
	}

	return request
}

function waited_request(publish_status: string): ReleaseRequest {
	return kit_request(
		...lost_check(publish_status),
		missing_response(),
		...lost_check(publish_status),
		response(200, { tag_name: LOWER_TAG }),
	)
}

describe('a lower tag published in kit without a release', () => {
	it('is skipped once its Publish run has completed', async () => {
		const request = kit_request(
			...lost_check('completed'),
			missing_response(),
			response(200, { tag_name: FLOOR }),
		)

		expect(await github_release.publish(request, TOKEN, TAG, KIT)).toBe(
			`published ${TAG} from ${FLOOR}`,
		)
	})

	// The run completes only after creating the release, so the release read after it is not missed.
	it('is the baseline when its release appears as its Publish run completes', async () => {
		const request = kit_request(...lost_check('completed'), response(200, { tag_name: LOWER_TAG }))

		expect(await github_release.publish(request, TOKEN, TAG, KIT)).toBe(
			`published ${TAG} from ${LOWER_TAG}`,
		)
	})

	it('is waited for while its Publish run is still in progress', async () => {
		const request = waited_request('in_progress')
		const wait = vi.fn().mockResolvedValue(undefined)

		expect(await github_release.publish(request, TOKEN, TAG, { ...KIT, wait })).toBe(
			`published ${TAG} from ${LOWER_TAG}`,
		)
		expect(wait).toHaveBeenCalledTimes(1)
	})

	// A workflow file synced before the setting existed names no release run to rule the tag out.
	it('is waited for when no workflow is named as creating its release', async () => {
		const request = waited_request('completed')
		const wait = vi.fn().mockResolvedValue(undefined)
		const options = { ...KIT, release_run_workflow: undefined, wait }

		expect(await github_release.publish(request, TOKEN, TAG, options)).toBe(
			`published ${TAG} from ${LOWER_TAG}`,
		)
		expect(wait).toHaveBeenCalledTimes(1)
	})
})

function publish_successes(): Response {
	return response(200, {
		workflow_runs: [`Publish ${LOWER_TAG}`, `Publish ${TAG}`].map((title, id) => ({
			id,
			display_title: title,
			status: 'completed',
			conclusion: 'success',
		})),
	})
}

// Every Publish run has succeeded, and no release exists yet.
function consumer_answer(url: string, release_status: string, release_title: string): Response {
	if (url.endsWith('/releases/latest')) return response(200, { tag_name: FLOOR })
	if (url.includes('/tags/')) return missing_response()

	if (url.includes(`/${CONSUMER.release_run_workflow}/`)) {
		return runs([release_title], release_status)
	}

	if (url.includes(`/${PUBLISH_WORKFLOW}/`)) return publish_successes()

	return response(200, { jobs: [] })
}

// The lower tag's release appears once the run has waited.
function consumer_request(
	release_status: string,
	wait: ReturnType<typeof vi.fn>,
	release_title = LOWER_RELEASE_RUN,
): ReleaseRequest {
	const creation = release_answers()

	return vi.fn(async (url: string): Promise<Response> => {
		if (/\/(?:releases|generate-notes)$/u.test(url)) return creation.shift() ?? missing_response()

		if (url.endsWith(`/tags/${LOWER_TAG}`) && wait.mock.calls.length > 0) {
			return response(200, { tag_name: LOWER_TAG })
		}

		return consumer_answer(url, release_status, release_title)
	})
}

describe('a lower tag published in a consumer without a release', () => {
	it('is skipped once its GitHub Release run has completed', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const request = consumer_request('completed', wait)

		expect(await github_release.publish(request, TOKEN, TAG, { ...CONSUMER, wait })).toBe(
			`published ${TAG} from ${FLOOR}`,
		)
		expect(wait).not.toHaveBeenCalled()
	})

	it('is waited for while its GitHub Release run is still in progress', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const request = consumer_request('in_progress', wait)

		expect(await github_release.publish(request, TOKEN, TAG, { ...CONSUMER, wait })).toBe(
			`published ${TAG} from ${LOWER_TAG}`,
		)
		expect(wait).toHaveBeenCalledTimes(1)
	})

	// A run started before the workflow titled its runs by tag may be the one releasing this tag.
	it('is waited for while a release run without a tag in its title is in progress', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const request = consumer_request('in_progress', wait, 'GitHub Release')

		expect(await github_release.publish(request, TOKEN, TAG, { ...CONSUMER, wait })).toBe(
			`published ${TAG} from ${LOWER_TAG}`,
		)
		expect(wait).toHaveBeenCalledTimes(1)
	})

	it('is skipped while only another tag has a release run in progress', async () => {
		const wait = vi.fn().mockResolvedValue(undefined)
		const request = consumer_request('in_progress', wait, `GitHub Release ${TAG}`)

		expect(await github_release.publish(request, TOKEN, TAG, { ...CONSUMER, wait })).toBe(
			`published ${TAG} from ${FLOOR}`,
		)
		expect(wait).not.toHaveBeenCalled()
	})
})
