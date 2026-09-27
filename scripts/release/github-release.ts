import semver from 'semver'
import { z } from 'zod'

const API_URL = 'https://api.github.com/repos/joshuafolkken/kit/releases'
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/u
const REQUEST_TIMEOUT_MS = 30_000
const NOT_FOUND_STATUS = 404
const RELEASE_SCHEMA = z.object({ tag_name: z.string().min(1) })
const NOTES_SCHEMA = z.object({ name: z.string().min(1), body: z.string().min(1) })

type ReleaseRequest = (url: string, init: RequestInit) => Promise<Response>

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

async function publish(request: ReleaseRequest, token: string, tag: string): Promise<string> {
	if (!TAG_PATTERN.test(tag)) throw new Error(`Invalid release tag: ${tag}`)
	if (await existing_release(request, token, tag)) return 'already-published'

	const previous = await previous_tag(request, token)

	if (!semver.lt(previous, tag)) {
		throw new Error(`Latest release ${previous} is not older than ${tag}`)
	}

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

	return `published ${tag} from ${previous}`
}

const github_release = { publish }

export { github_release }
