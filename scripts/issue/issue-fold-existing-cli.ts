#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { z } from 'zod'
import { issue_fold_apply, type ApplyResult } from './issue-fold-apply'
import { issue_fold_existing } from './issue-fold-existing'

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const JSON_FLAG = '--json'
const APPLY_FLAG = '--apply'
const USAGE = `Usage: josh issue:fold-existing <assessment.json> [${JSON_FLAG} | ${APPLY_FLAG} <issue-number>]`

const APPLY_REPORTS: Readonly<Record<ApplyResult, string>> = {
	applied: 'folded — the body was written, its priority floor applied and the re-read carries it.',
	changed: 'changed since the assessment — nothing written; read it and assess again.',
	unreadable: 'could not be read — nothing written.',
	'write-failed': 'could not be written — the fold is not complete.',
	'priority-failed':
		"was written, but applying its body's priority floor failed — the fold is not complete.",
	unverified: 'was written, but the re-read does not carry the fold — the fold is not complete.',
}

type Mode = { kind: 'print'; should_json: boolean } | { kind: 'apply'; issue_number: string }

const NO_OPTION = ''
const APPLY_ARITY = 2
const PRINT_MODES: ReadonlyMap<string, Mode> = new Map([
	[NO_OPTION, { kind: 'print', should_json: false }],
	[JSON_FLAG, { kind: 'print', should_json: true }],
])

const assessment_schema = z.object({
	content: z.enum(['duplicate', 'compatible', 'separate', 'unknown']),
	is_open: z.boolean().optional(),
	is_unstarted: z.boolean().optional(),
	has_pull_request: z.boolean().optional(),
	has_complete_read: z.boolean(),
	has_dependency_conflict: z.boolean().optional(),
	is_separable: z.boolean().optional(),
	size_verdict: z.enum(['split', 'single']).optional(),
	existing_body: z.string(),
	draft_body: z.string().trim().min(1),
	verification: z.string().trim().min(1),
})

type Assessment = z.infer<typeof assessment_schema>

function folded_body(input: Assessment): string | undefined {
	if (issue_fold_existing.decide(input) !== 'fold') return undefined

	return issue_fold_existing.append_requirements(
		input.existing_body,
		input.draft_body,
		input.verification,
	)
}

function print_assessment(input: Assessment, should_json: boolean): number {
	const verdict = issue_fold_existing.decide(input)
	const body = folded_body(input)

	if (should_json) {
		console.info(JSON.stringify({ verdict, body }))

		return SUCCESS_EXIT_CODE
	}

	console.info(`Fold: ${verdict}`)
	if (body !== undefined) console.info(body)

	return SUCCESS_EXIT_CODE
}

async function apply_fold(input: Assessment, issue_number: string): Promise<number> {
	const body = folded_body(input)

	if (body === undefined) {
		console.error(`Fold: ${issue_fold_existing.decide(input)} — nothing written.`)

		return FAILURE_EXIT_CODE
	}

	const result = await issue_fold_apply.apply({
		issue_number,
		existing_body: input.existing_body,
		body,
	})
	const line = `Issue ${session_cite.issue(issue_number)} ${APPLY_REPORTS[result]}`

	if (result === 'applied') {
		console.info(line)
	} else {
		console.error(line)
	}

	return result === 'applied' ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

async function read_assessment(path: string): Promise<Assessment | undefined> {
	try {
		return assessment_schema.parse(JSON.parse(await readFile(path, 'utf8')))
	} catch {
		return undefined
	}
}

async function assess(path: string, mode: Mode): Promise<number> {
	const input = await read_assessment(path)

	if (input === undefined) {
		console.error('Could not read a complete assessment; no fold recommendation was made.')

		return FAILURE_EXIT_CODE
	}

	if (mode.kind === 'apply') return await apply_fold(input, mode.issue_number)

	return print_assessment(input, mode.should_json)
}

function parse_apply([option, value]: ReadonlyArray<string>): Mode | undefined {
	if (option !== APPLY_FLAG || value === undefined) return undefined

	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(value)
		? { kind: 'apply', issue_number: value }
		: undefined
}

// No option and `--json` print; `--apply <N>` writes.
function parse_mode(options: ReadonlyArray<string>): Mode | undefined {
	if (options.length === APPLY_ARITY) return parse_apply(options)

	return options.length <= 1 ? PRINT_MODES.get(options.join(NO_OPTION)) : undefined
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const [path, ...options] = argv
	const mode = parse_mode(options)

	if (path !== undefined && mode !== undefined) return await assess(path, mode)

	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_fold_existing_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_fold_existing_cli }
