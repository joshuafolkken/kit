import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { error_text } from '#scripts/lib/error-message'
import { timed_fetch } from '#scripts/lib/timed-fetch'
import type { z } from 'zod'

// The SonarCloud project a `josh sonar:*` command reads, shared by every command that calls the
// SonarCloud API: the host, the project key `sonar-project.properties`
// records — the file `josh init` / `josh sync` generate from the GitHub repository name — and the
// `<PR>` positional each command takes.

const SONAR_HOST = 'https://sonarcloud.io'
const PROPERTIES_FILE = 'sonar-project.properties'
const PROJECT_KEY_PREFIX = 'sonar.projectKey='
const TOKEN_VARIABLE = 'SONAR_TOKEN'
const AUTHORIZATION_HEADER = 'Authorization'

interface SonarTarget {
	project_key: string
	pull_request: string
}

type SonarRead<T> = { data: T } | { error: string }

function read_project_key(root: string): string | undefined {
	const file = path.join(root, PROPERTIES_FILE)
	if (!existsSync(file)) return undefined

	const line = readFileSync(file, 'utf8')
		.split('\n')
		.find((entry) => entry.startsWith(PROJECT_KEY_PREFIX))

	return line?.slice(PROJECT_KEY_PREFIX.length).trim()
}

function api_url(api_path: string, query: Record<string, string>): string {
	return `${SONAR_HOST}${api_path}?${new URLSearchParams(query).toString()}`
}

// A public project reads without a token; a private one needs it. CI lifts `SONAR_TOKEN` into the
// job env, so it is sent when present and the request is anonymous otherwise.
function request_init(): RequestInit {
	const token = process.env[TOKEN_VARIABLE] ?? ''

	return token === '' ? {} : { headers: [[AUTHORIZATION_HEADER, `Bearer ${token}`]] }
}

// One SonarCloud API read: the parsed body on success, or the reason the read failed — rate-limited,
// offline, a non-OK response or an unexpected shape — so a caller cannot mistake a failed read for an
// empty success.
async function fetch_json<T>(url: string, schema: z.ZodType<T>): Promise<SonarRead<T>> {
	try {
		const response = await timed_fetch(url, request_init())
		if (!response.ok) return { error: `HTTP ${String(response.status)}` }

		return { data: schema.parse(await response.json()) }
	} catch (error) {
		return { error: error_text.message_of(error) }
	}
}

// The pull request named on the command line and this repository's project key, or `undefined`
// after printing why the command cannot run — the usage line, or the missing project key.
async function resolve_target(
	argv: ReadonlyArray<string>,
	usage: string,
): Promise<SonarTarget | undefined> {
	const [pull_request] = argv

	if (pull_request === undefined || pull_request.startsWith('-')) {
		console.error(usage)

		return undefined
	}

	const project_key = read_project_key(await git_command.repository_root())

	if (project_key === undefined) {
		console.error(`no ${PROJECT_KEY_PREFIX} found in ${PROPERTIES_FILE}`)

		return undefined
	}

	return { project_key, pull_request }
}

const sonar_project = {
	api_url,
	fetch_json,
	read_project_key,
	request_init,
	resolve_target,
}

export { sonar_project }
export type { SonarRead, SonarTarget }
