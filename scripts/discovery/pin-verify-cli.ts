#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'

// `josh pin:verify <owner/repo> <tag> <sha>` — check that a tag resolves to the commit a SHA pin
// names, before a CodeRabbit "not matching the tag" finding is bypassed (joshuafolkken/kit#5849).
// The commits endpoint peels an annotated tag to its commit, so the one request answers both tag
// kinds. The printed line is the citation the bypass reason quotes, so nothing is retyped by hand.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh pin:verify <owner/repo> <tag> <sha>'
const FAILURE_EXIT_CODE = 1
const ARGUMENT_COUNT = 3
const OWNER_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/u
const SHA_PATTERN = /^[\da-f]{40}$/iu
// Fully qualified so a branch or a bare SHA of the same name never answers for the tag; the shorter
// `tags/<tag>` is not resolved in every repository.
const TAG_REF_PREFIX = 'refs/tags/'

type Verdict = 'match' | 'mismatch' | 'unreadable'

interface PinRequest {
	owner_repo: string
	tag: string
	sha: string
}

interface PinResult {
	verdict: Verdict
	line: string
}

function is_well_formed(request: PinRequest): boolean {
	return (
		request.tag !== '' &&
		OWNER_REPO_PATTERN.test(request.owner_repo) &&
		SHA_PATTERN.test(request.sha)
	)
}

function to_request(argv: ReadonlyArray<string>): PinRequest {
	const [owner_repo = '', tag = '', sha = ''] = argv

	return { owner_repo, tag, sha }
}

function parse(argv: ReadonlyArray<string>): PinRequest | undefined {
	if (argv.length !== ARGUMENT_COUNT) return undefined
	const request = to_request(argv)

	return is_well_formed(request) ? request : undefined
}

function subject(request: PinRequest): string {
	return `${request.owner_repo}@${request.tag}`
}

async function resolve_tag(request: PinRequest): Promise<string> {
	const reference = encodeURIComponent(`${TAG_REF_PREFIX}${request.tag}`)
	const path = git_gh_api_path.commit_api_path(reference, request.owner_repo)

	return await git_gh_exec.exec_gh_api({ path, jq_filter: '.sha' })
}

function compare(request: PinRequest, resolved: string): PinResult {
	if (resolved.toLowerCase() === request.sha.toLowerCase()) {
		return { verdict: 'match', line: `${subject(request)} resolves to ${resolved}, the pinned SHA` }
	}

	return {
		verdict: 'mismatch',
		line: `${subject(request)} resolves to ${resolved}, not the pinned ${request.sha}`,
	}
}

async function verify(request: PinRequest): Promise<PinResult> {
	try {
		return compare(request, await resolve_tag(request))
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		// gh appends the raw JSON body on later lines; the first line already names the reason.
		const [reason = message] = message.split('\n', 1)

		return { verdict: 'unreadable', line: `${subject(request)} could not be read: ${reason}` }
	}
}

// The verdict word and its line go to stdout together, so the line a bypass reason quotes carries the
// answer with it; only `match` exits zero.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const result = await verify(request)

	console.info(`${result.verdict} — pin:verify: ${result.line}`)

	return result.verdict === 'match' ? 0 : FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const pin_verify_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { pin_verify_cli }
