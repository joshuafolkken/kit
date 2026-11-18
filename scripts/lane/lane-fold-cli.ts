#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { lane_fold, type FoldOutcome, type FoldRequest } from './lane-fold'

// `josh lane:fold <N> --into <M> --reason <text>` — the command line around `lane-fold.ts`.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh lane:fold <issue-number> --into <issue-number> --reason <text>'
const ISSUE_PREFIX = /^#/u
const OPTIONS = { into: { type: 'string' }, reason: { type: 'string' } } as const

// `#12` and `12` both name issue 12; anything else is no issue.
function issue_of(value: unknown): string | undefined {
	const issue = cli_flags.string_of(value)?.trim().replace(ISSUE_PREFIX, '')

	return issue !== undefined && issue_number_shape.is_issue_number(issue) ? issue : undefined
}

function reason_of(value: unknown): string | undefined {
	const reason = cli_flags.string_of(value)?.trim()

	return reason === '' ? undefined : reason
}

function single_issue_of(positionals: ReadonlyArray<string>): string | undefined {
	const [positional, ...rest] = positionals

	return rest.length === 0 ? issue_of(positional) : undefined
}

type ParsedRequest = { [Key in keyof FoldRequest]: FoldRequest[Key] | undefined }

// An issue folded into itself is no fold.
function request_of(request: ParsedRequest): FoldRequest | undefined {
	const { issue, into, reason } = request

	if (issue === undefined || into === undefined || reason === undefined) return undefined

	return issue === into ? undefined : { issue, into, reason }
}

function parse_request(argv: ReadonlyArray<string>): FoldRequest | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined) return undefined

	return request_of({
		issue: single_issue_of(parsed.positionals),
		into: issue_of(parsed.values.into),
		reason: reason_of(parsed.values.reason),
	})
}

function describe(outcome: FoldOutcome, request: FoldRequest): string {
	const issue = session_cite.issue(request.issue)
	const into = session_cite.issue(request.into)

	if (outcome.kind === 'failed') {
		return `lane:fold ${issue} → ${into} stopped at ${outcome.step}: ${outcome.message}\nRe-run the same command to finish from there; the steps already done are not repeated.`
	}

	return [
		`withdraw: ${outcome.is_withdrawn ? 'done' : 'already done'} (stash: ${outcome.stash ?? 'none'})`,
		`note on ${into}: ${outcome.is_noted ? 'written' : 'already written'}`,
		`unblock ${into} from ${issue}: done`,
	].join('\n')
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const outcome = await lane_fold.fold(request)

	console.error(describe(outcome, request))

	return outcome.kind === 'folded' ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_fold_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_fold_cli }
