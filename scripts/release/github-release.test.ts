import { describe, expect, it, vi } from 'vitest'
import { github_release } from './github-release'

const TAG = 'v1.888.0'
const PREVIOUS_TAG = 'v0.113.0'
const TOKEN = 'test-token'
const NOT_FOUND_MESSAGE = 'HTTP 404'
const CONNECTION_ERROR = 'connection lost'
const NOTES = { name: TAG, body: '## Changes\n- One change' }
const CONFIG_PATH = '.github/release.yml'
const PUBLISH_NPM = 'publish-npm'
// kit's own settings, as `.github/workflows/publish.yml` passes them to `josh release:github`.
const KIT = {
	repository: 'joshuafolkken/kit',
	start_tag: 'v1.887.0',
	workflow: 'publish.yml',
	jobs: ['publish-github', PUBLISH_NPM, 'update-production'],
}

function note_request(tag: string, previous: string): string {
	return JSON.stringify({
		tag_name: tag,
		previous_tag_name: previous,
		configuration_file_path: CONFIG_PATH,
	})
}

function response(status: number, body: unknown): Response {
	return Response.json(body, { status })
}

function missing_response(): Response {
	return new Response(undefined, { status: 404 })
}

describe('GitHub Release notes', () => {
	it.each([PREVIOUS_TAG, 'v1.887.0'])(
		'uses the last published release %s as the explicit note baseline',
		async (previous_tag: string) => {
			const request = vi
				.fn<(_: string, __: RequestInit) => Promise<Response>>()
				.mockResolvedValueOnce(missing_response())
				.mockResolvedValueOnce(response(200, { tag_name: previous_tag }))
				.mockResolvedValueOnce(response(200, NOTES))
				.mockResolvedValueOnce(response(201, { tag_name: TAG }))

			expect(await github_release.publish(request, TOKEN, TAG, KIT)).toContain(previous_tag)
			expect(request).toHaveBeenCalledTimes(4)
			expect(request.mock.calls[0]?.[1]).not.toHaveProperty('body')
			expect(request.mock.calls[1]?.[1]).not.toHaveProperty('body')
			expect(request.mock.calls[1]).toContainEqual(expect.stringMatching(/\/releases\/latest$/u))
			expect(request.mock.calls[2]?.[1].body).toBe(
				JSON.stringify({
					tag_name: TAG,
					previous_tag_name: previous_tag,
					configuration_file_path: CONFIG_PATH,
				}),
			)
			expect(request.mock.calls[3]?.[1].body).toBe(
				JSON.stringify({
					tag_name: TAG,
					name: NOTES.name,
					body: NOTES.body,
					draft: false,
					prerelease: false,
				}),
			)
		},
	)
})

it('does not duplicate an existing release', async () => {
	const request = vi.fn().mockResolvedValue(response(200, { tag_name: TAG }))

	expect(await github_release.publish(request, TOKEN, TAG, KIT)).toBe('already-published')
	expect(request).toHaveBeenCalledTimes(1)
})

it('publishes reversed tags in version order using the prior release for notes', async () => {
	const earlier_request = vi
		.fn()
		.mockResolvedValueOnce(missing_response())
		.mockResolvedValueOnce(response(200, { tag_name: PREVIOUS_TAG }))
		.mockResolvedValueOnce(response(200, NOTES))
		.mockResolvedValueOnce(response(201, { tag_name: TAG }))
	const later_request = vi
		.fn()
		.mockResolvedValueOnce(missing_response())
		.mockResolvedValueOnce(missing_response())
		.mockResolvedValueOnce(response(200, { workflow_runs: [] }))
		.mockResolvedValueOnce(response(200, { tag_name: TAG }))
		.mockResolvedValueOnce(response(200, { name: 'v1.889.0', body: 'Changes' }))
		.mockResolvedValueOnce(response(201, { tag_name: 'v1.889.0' }))

	async function publish_earlier(): Promise<void> {
		expect(await github_release.publish(earlier_request, TOKEN, TAG, KIT)).toBe(
			`published ${TAG} from ${PREVIOUS_TAG}`,
		)
	}

	expect(
		await github_release.publish(later_request, TOKEN, 'v1.889.0', {
			...KIT,
			tags: ['v1.883.0', TAG, 'v1.889.0'],
			wait: publish_earlier,
		}),
	).toBe(`published v1.889.0 from ${TAG}`)
	expect(earlier_request.mock.calls[2]?.[1]).toHaveProperty('body', note_request(TAG, PREVIOUS_TAG))
	expect(later_request.mock.calls[4]?.[1]).toHaveProperty('body', note_request('v1.889.0', TAG))
})

it('skips a lower tag whose package publication failed', async () => {
	const request = vi
		.fn()
		.mockResolvedValueOnce(missing_response())
		.mockResolvedValueOnce(missing_response())
		.mockResolvedValueOnce(
			response(200, { workflow_runs: [{ id: 42, display_title: `Publish ${TAG}` }] }),
		)
		.mockResolvedValueOnce(
			response(200, {
				jobs: [{ name: PUBLISH_NPM, status: 'completed', conclusion: 'failure' }],
			}),
		)
		.mockResolvedValueOnce(response(200, { tag_name: PREVIOUS_TAG }))
		.mockResolvedValueOnce(response(200, { name: 'v1.889.0', body: 'Changes' }))
		.mockResolvedValueOnce(response(201, { tag_name: 'v1.889.0' }))

	expect(await github_release.publish(request, TOKEN, 'v1.889.0', { ...KIT, tags: [TAG] })).toBe(
		`published v1.889.0 from ${PREVIOUS_TAG}`,
	)
	expect(request.mock.calls[5]?.[1]).toHaveProperty('body', note_request('v1.889.0', PREVIOUS_TAG))
})

it('waits for the nearest lower tag when several newer tags exist', async () => {
	const request = vi
		.fn()
		.mockResolvedValueOnce(missing_response())
		.mockResolvedValueOnce(response(200, { tag_name: 'v1.889.0' }))
		.mockResolvedValueOnce(response(200, { name: 'v1.890.0', body: 'Changes' }))
		.mockResolvedValueOnce(response(201, { tag_name: 'v1.890.0' }))

	expect(
		await github_release.publish(request, TOKEN, 'v1.890.0', {
			...KIT,
			tags: [TAG, 'v1.889.0', 'v1.890.0'],
		}),
	).toBe('published v1.890.0 from v1.889.0')
	expect(request.mock.calls[1]?.[0]).toMatch(/\/tags\/v1\.889\.0$/u)
})

it('does not publish the later tag when waiting for the earlier release fails', async () => {
	const request = vi
		.fn()
		.mockResolvedValueOnce(missing_response())
		.mockResolvedValueOnce(missing_response())
		.mockResolvedValueOnce(response(200, { workflow_runs: [] }))
	const wait = vi.fn().mockRejectedValue(new Error(CONNECTION_ERROR))

	await expect(
		github_release.publish(request, TOKEN, 'v1.889.0', { ...KIT, tags: [TAG], wait }),
	).rejects.toThrow(CONNECTION_ERROR)
	expect(request).toHaveBeenCalledTimes(3)
})

describe('GitHub Release failures', () => {
	it.each([500, 429, 403])('does not treat HTTP %i as a missing release', async (status) => {
		const request = vi.fn().mockResolvedValue(response(status, { message: 'failed' }))

		await expect(github_release.publish(request, TOKEN, TAG, KIT)).rejects.toThrow(
			`HTTP ${String(status)}`,
		)
		expect(request).toHaveBeenCalledTimes(1)
	})

	it('stops when the latest release cannot be read', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(missing_response())
			.mockResolvedValueOnce(missing_response())

		await expect(github_release.publish(request, TOKEN, TAG, KIT)).rejects.toThrow(
			NOT_FOUND_MESSAGE,
		)
		expect(request).toHaveBeenCalledTimes(2)
	})

	it('stops when the latest release is newer than the dispatched tag', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(missing_response())
			.mockResolvedValueOnce(response(200, { tag_name: 'v1.889.0' }))

		await expect(github_release.publish(request, TOKEN, TAG, KIT)).rejects.toThrow(
			'Latest release v1.889.0 is not older than v1.888.0',
		)
		expect(request).toHaveBeenCalledTimes(2)
	})
})

it('stops on empty or malformed API data', async () => {
	const request = vi
		.fn()
		.mockResolvedValueOnce(missing_response())
		.mockResolvedValueOnce(new Response('', { status: 200 }))

	await expect(github_release.publish(request, TOKEN, TAG, KIT)).rejects.toThrow()
	expect(request).toHaveBeenCalledTimes(2)
})

it.each([new Response('{', { status: 200 }), response(200, { name: TAG, body: '' })])(
	'stops when generated notes are malformed or empty',
	async (notes_response: Response) => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(missing_response())
			.mockResolvedValueOnce(response(200, { tag_name: PREVIOUS_TAG }))
			.mockResolvedValueOnce(notes_response)

		await expect(github_release.publish(request, TOKEN, TAG, KIT)).rejects.toThrow()
		expect(request).toHaveBeenCalledTimes(3)
	},
)

it.each([500, 429])('stops when publication returns HTTP %i', async (status) => {
	const request = vi
		.fn()
		.mockResolvedValueOnce(missing_response())
		.mockResolvedValueOnce(response(200, { tag_name: PREVIOUS_TAG }))
		.mockResolvedValueOnce(response(200, NOTES))
		.mockResolvedValueOnce(response(status, { message: 'failed' }))

	await expect(github_release.publish(request, TOKEN, TAG, KIT)).rejects.toThrow(
		`HTTP ${String(status)}`,
	)
})

it('stops on a rejected or timed-out request', async () => {
	const request = vi.fn().mockRejectedValue(new Error(CONNECTION_ERROR))

	await expect(github_release.publish(request, TOKEN, TAG, KIT)).rejects.toThrow(CONNECTION_ERROR)
})

it('rejects an invalid tag before calling the API', async () => {
	const request = vi.fn()

	await expect(github_release.publish(request, TOKEN, 'main', KIT)).rejects.toThrow(
		'Invalid release tag',
	)
	expect(request).not.toHaveBeenCalled()
})
