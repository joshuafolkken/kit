import { describe, expect, it, vi, type Mock } from 'vitest'
import { github_release } from './github-release'

type ReleaseRequest = Mock<(url: string, init: RequestInit) => Promise<Response>>

const TOKEN = 'test-token'
const REPOSITORY = 'acme/app'
const API = `https://api.github.com/repos/${REPOSITORY}`
const TAG = 'v0.107.0'
const LOWER_TAG = 'v0.106.0'
const RELEASED_TAG = 'v0.105.0'
const NOTES = { name: TAG, body: 'Changes' }
const CONFIG_PATH = '.github/release.yml'
const STILL_WAITING = 'still waiting'

function response(status: number, body: unknown): Response {
	return Response.json(body, { status })
}

function missing_response(): Response {
	return new Response(undefined, { status: 404 })
}

function release_request(...responses: Array<Response>): ReleaseRequest {
	const request: ReleaseRequest = vi.fn()
	for (const item of responses) request.mockResolvedValueOnce(item)

	return request
}

// Two lookups that answer "no release", then the notes and the created release.
function unreleased_repository_request(): ReleaseRequest {
	return release_request(
		missing_response(),
		missing_response(),
		response(200, NOTES),
		response(201, { tag_name: TAG }),
	)
}

function body_of(request: ReleaseRequest, index: number): unknown {
	return request.mock.calls[index]?.[1].body
}

describe('GitHub Release for any repository', () => {
	it('asks the API of the repository it was given', async () => {
		const request = release_request(
			missing_response(),
			response(200, { tag_name: LOWER_TAG }),
			response(200, NOTES),
			response(201, { tag_name: TAG }),
		)

		expect(await github_release.publish(request, TOKEN, TAG, { repository: REPOSITORY })).toBe(
			`published ${TAG} from ${LOWER_TAG}`,
		)
		expect(request.mock.calls.map((call) => call[0])).toEqual([
			`${API}/releases/tags/${TAG}`,
			`${API}/releases/latest`,
			`${API}/releases/generate-notes`,
			`${API}/releases`,
		])
	})

	it('rejects a repository that is not owner/name before calling the API', async () => {
		const request = release_request()

		await expect(
			github_release.publish(request, TOKEN, TAG, { repository: 'acme/app/../kit' }),
		).rejects.toThrow('Invalid repository')
		expect(request).not.toHaveBeenCalled()
	})
})

describe('baseline without a start tag in a repository with no release', () => {
	it('uses the nearest lower tag without waiting', async () => {
		const wait = vi.fn<() => Promise<void>>()
		const request = unreleased_repository_request()
		const tags = ['v0.87.0', LOWER_TAG, 'v0.98.0', TAG]

		expect(
			await github_release.publish(request, TOKEN, TAG, { repository: REPOSITORY, tags, wait }),
		).toBe(`published ${TAG} from ${LOWER_TAG}`)
		expect(wait).not.toHaveBeenCalled()
		expect(body_of(request, 2)).toBe(
			JSON.stringify({
				tag_name: TAG,
				previous_tag_name: LOWER_TAG,
				configuration_file_path: CONFIG_PATH,
			}),
		)
	})

	it('generates notes without a baseline for the first tag', async () => {
		const request = unreleased_repository_request()

		expect(
			await github_release.publish(request, TOKEN, TAG, { repository: REPOSITORY, tags: [TAG] }),
		).toBe(`published ${TAG} from the first commit`)
		expect(body_of(request, 2)).toBe(
			JSON.stringify({ tag_name: TAG, configuration_file_path: CONFIG_PATH }),
		)
	})
})

it('waits only for lower tags above the latest existing release', async () => {
	const request = release_request(
		missing_response(),
		response(200, { tag_name: RELEASED_TAG }),
		response(200, { tag_name: LOWER_TAG }),
		response(200, NOTES),
		response(201, { tag_name: TAG }),
	)
	const tags = ['v0.98.0', RELEASED_TAG, LOWER_TAG, TAG]

	expect(await github_release.publish(request, TOKEN, TAG, { repository: REPOSITORY, tags })).toBe(
		`published ${TAG} from ${LOWER_TAG}`,
	)
	expect(request.mock.calls[2]?.[0]).toBe(`${API}/releases/tags/${LOWER_TAG}`)
})

const SETTINGS = { repository: REPOSITORY, workflow: '42', tags: [RELEASED_TAG, LOWER_TAG] }

function failed_lower_tag(job_name: string, conclusion = 'failure'): ReleaseRequest {
	return release_request(
		missing_response(),
		response(200, { tag_name: RELEASED_TAG }),
		response(200, { workflow_runs: [{ id: 7, display_title: `Publish ${LOWER_TAG}` }] }),
		response(200, { jobs: [{ name: job_name, status: 'completed', conclusion }] }),
		missing_response(),
		response(200, NOTES),
		response(201, { tag_name: TAG }),
	)
}

describe('publication jobs that are waited on', () => {
	it('counts any failed job when no job names are given', async () => {
		const request = failed_lower_tag('deploy')

		expect(await github_release.publish(request, TOKEN, TAG, SETTINGS)).toBe(
			`published ${TAG} from ${RELEASED_TAG}`,
		)
		expect(request.mock.calls[2]?.[0]).toBe(`${API}/actions/workflows/42/runs?per_page=100`)
		expect(request.mock.calls[3]?.[0]).toBe(`${API}/actions/runs/7/jobs?per_page=100`)
	})

	it('ignores a failed job outside the named ones', async () => {
		const request = failed_lower_tag('lint')
		const wait = vi.fn<() => Promise<void>>().mockRejectedValue(new Error(STILL_WAITING))

		await expect(
			github_release.publish(request, TOKEN, TAG, { ...SETTINGS, jobs: ['publish-npm'], wait }),
		).rejects.toThrow(STILL_WAITING)
		expect(wait).toHaveBeenCalledOnce()
	})
})

it.each(['skipped', 'neutral'])('waits for a lower tag whose job was %s', async (conclusion) => {
	const request = failed_lower_tag('deploy', conclusion)
	const wait = vi.fn<() => Promise<void>>().mockRejectedValue(new Error(STILL_WAITING))

	await expect(github_release.publish(request, TOKEN, TAG, { ...SETTINGS, wait })).rejects.toThrow(
		STILL_WAITING,
	)
	expect(wait).toHaveBeenCalledOnce()
})

it('waits for a lower tag without reading runs when no workflow is given', async () => {
	const request = release_request(
		missing_response(),
		response(200, { tag_name: RELEASED_TAG }),
		missing_response(),
	)
	const wait = vi.fn<() => Promise<void>>().mockRejectedValue(new Error(STILL_WAITING))
	const tags = [RELEASED_TAG, LOWER_TAG]

	await expect(
		github_release.publish(request, TOKEN, TAG, { repository: REPOSITORY, tags, wait }),
	).rejects.toThrow(STILL_WAITING)
	expect(request).toHaveBeenCalledTimes(3)
})
