import { describe, expect, it, vi } from 'vitest'
import { github_release } from './github-release'

const TAG = 'v1.888.0'
const PREVIOUS_TAG = 'v0.113.0'
const TOKEN = 'test-token'
const NOT_FOUND_MESSAGE = 'HTTP 404'
const CONNECTION_ERROR = 'connection lost'
const NOTES = { name: TAG, body: '## Changes\n- One change' }

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

			expect(await github_release.publish(request, TOKEN, TAG)).toContain(previous_tag)
			expect(request).toHaveBeenCalledTimes(4)
			expect(request.mock.calls[0]?.[1]).not.toHaveProperty('body')
			expect(request.mock.calls[1]?.[1]).not.toHaveProperty('body')
			expect(request.mock.calls[1]).toContainEqual(expect.stringMatching(/\/releases\/latest$/u))
			expect(request.mock.calls[2]?.[1].body).toBe(
				JSON.stringify({
					tag_name: TAG,
					previous_tag_name: previous_tag,
					configuration_file_path: '.github/release.yml',
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

	expect(await github_release.publish(request, TOKEN, TAG)).toBe('already-published')
	expect(request).toHaveBeenCalledTimes(1)
})

describe('GitHub Release failures', () => {
	it.each([500, 429, 403])('does not treat HTTP %i as a missing release', async (status) => {
		const request = vi.fn().mockResolvedValue(response(status, { message: 'failed' }))

		await expect(github_release.publish(request, TOKEN, TAG)).rejects.toThrow(
			`HTTP ${String(status)}`,
		)
		expect(request).toHaveBeenCalledTimes(1)
	})

	it('stops when the latest release cannot be read', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(missing_response())
			.mockResolvedValueOnce(missing_response())

		await expect(github_release.publish(request, TOKEN, TAG)).rejects.toThrow(NOT_FOUND_MESSAGE)
		expect(request).toHaveBeenCalledTimes(2)
	})

	it('stops when the latest release is newer than the dispatched tag', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(missing_response())
			.mockResolvedValueOnce(response(200, { tag_name: 'v1.889.0' }))

		await expect(github_release.publish(request, TOKEN, TAG)).rejects.toThrow(
			'Latest release v1.889.0 is not older than v1.888.0',
		)
		expect(request).toHaveBeenCalledTimes(2)
	})

	it('stops on empty or malformed API data', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(missing_response())
			.mockResolvedValueOnce(new Response('', { status: 200 }))

		await expect(github_release.publish(request, TOKEN, TAG)).rejects.toThrow()
		expect(request).toHaveBeenCalledTimes(2)
	})
})

it.each([new Response('{', { status: 200 }), response(200, { name: TAG, body: '' })])(
	'stops when generated notes are malformed or empty',
	async (notes_response: Response) => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(missing_response())
			.mockResolvedValueOnce(response(200, { tag_name: PREVIOUS_TAG }))
			.mockResolvedValueOnce(notes_response)

		await expect(github_release.publish(request, TOKEN, TAG)).rejects.toThrow()
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

	await expect(github_release.publish(request, TOKEN, TAG)).rejects.toThrow(
		`HTTP ${String(status)}`,
	)
})

it('stops on a rejected or timed-out request', async () => {
	const request = vi.fn().mockRejectedValue(new Error(CONNECTION_ERROR))

	await expect(github_release.publish(request, TOKEN, TAG)).rejects.toThrow(CONNECTION_ERROR)
})

it('rejects an invalid tag before calling the API', async () => {
	const request = vi.fn()

	await expect(github_release.publish(request, TOKEN, 'main')).rejects.toThrow(
		'Invalid release tag',
	)
	expect(request).not.toHaveBeenCalled()
})
