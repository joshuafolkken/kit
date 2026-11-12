import { describe, expect, it, vi, type Mock } from 'vitest'
import { z } from 'zod'
import { github_release } from './github-release'
import { github_release_notes } from './github-release-notes'

const TAG = 'v1.3000.0'
const PREVIOUS_TAG = 'v1.2116.0'
const REPOSITORY = 'joshuafolkken/kit'
const COMPARE_URL = `https://github.com/${REPOSITORY}/compare/${PREVIOUS_TAG}...${TAG}`
const SETTINGS = { repository: REPOSITORY }
const LINE = '- One change\n'
const SENT_SCHEMA = z.object({ body: z.string() })

function response(status: number, body: unknown): Response {
	return Response.json(body, { status })
}

type Request = Mock<(_: string, __: RequestInit) => Promise<Response>>

function release_request(notes_body: string, created: Response): Request {
	return vi
		.fn<(_: string, __: RequestInit) => Promise<Response>>()
		.mockResolvedValueOnce(new Response(undefined, { status: 404 }))
		.mockResolvedValueOnce(response(200, { tag_name: PREVIOUS_TAG }))
		.mockResolvedValueOnce(response(200, { name: TAG, body: notes_body }))
		.mockResolvedValueOnce(created)
}

function sent_body(request: Request): string {
	return SENT_SCHEMA.parse(JSON.parse(String(request.mock.calls[3]?.[1].body))).body
}

describe('GitHub Release notes size', () => {
	it('names the API error message beside the status of a rejected release', async () => {
		const rejection = response(422, { message: 'Validation Failed' })
		const request = release_request(LINE, rejection)

		await expect(github_release.publish(request, 'token', TAG, SETTINGS)).rejects.toThrow(
			'HTTP 422: {"message":"Validation Failed"}',
		)
	})

	it('caps an oversized body and keeps the compare link last', async () => {
		const oversized = LINE.repeat(github_release_notes.MAX_BODY_LENGTH)
		const request = release_request(oversized, response(201, { tag_name: TAG }))

		await github_release.publish(request, 'token', TAG, SETTINGS)

		const body = sent_body(request)

		expect(body.length).toBeLessThanOrEqual(github_release_notes.MAX_BODY_LENGTH)
		expect(body.endsWith(`${LINE}\n…\n\n**Full Changelog**: ${COMPARE_URL}`)).toBe(true)
	})

	it('sends a body within the limit unchanged', () => {
		expect(github_release_notes.cap_body(LINE, COMPARE_URL)).toBe(LINE)
	})

	it('links the commits of a first release', () => {
		expect(github_release_notes.changelog_url(REPOSITORY, TAG, undefined)).toBe(
			`https://github.com/${REPOSITORY}/commits/${TAG}`,
		)
	})
})
