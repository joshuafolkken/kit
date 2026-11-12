#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { error_text } from '#scripts/lib/error-message'
import { shell_quote } from '#scripts/lib/shell-quote'
import { split_resolution } from '#scripts/split/split-resolution'
import { z } from 'zod'
import { issue_fold_apply, type ApplyResult } from './issue-fold-apply'
import { issue_fold_existing } from './issue-fold-existing'

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const JSON_FLAG = '--json'
const APPLY_FLAG = '--apply'
const BLOCKED_FLAG = '--blocked'
const FINGERPRINT_FLAG = '--fingerprint'
const FOUND_DURING_FLAG = '--found-during'
const USAGE = `Usage: josh issue:fold-existing <assessment.json> [${JSON_FLAG} | ${APPLY_FLAG} <issue-number> [${BLOCKED_FLAG} <stopped-issue> | ${FOUND_DURING_FLAG} <split-origin>]] | ${FINGERPRINT_FLAG} <issue-number>`

const APPLY_REPORTS: Readonly<Record<ApplyResult, string>> = {
	applied: 'folded — the body was written, its priority floor applied and the re-read carries it.',
	changed: 'changed since the assessment — nothing written; read it and assess again.',
	unreadable: 'could not be read — nothing written.',
	'write-failed': 'could not be written — the fold is not complete.',
	'priority-failed':
		"was written, but applying its body's priority floor failed — the fold is not complete.",
	unverified: 'was written, but the re-read does not carry the fold — the fold is not complete.',
}

type Mode =
	| { kind: 'print'; should_json: boolean }
	| { kind: 'apply'; issue_number: string; found_during?: string }
	| { kind: 'duplicate'; issue_number: string; blocked: string }

type ApplyMode = Extract<Mode, { kind: 'apply' }>

const NO_OPTION = ''
const FLAG_VALUE_ARITY = 2
const PAIRED_ARITY = 4
const issue_number_schema = z.string().regex(issue_number_shape.ISSUE_NUMBER_PATTERN)
const paired_options_schema = z.tuple([
	z.literal(APPLY_FLAG),
	issue_number_schema,
	z.enum([BLOCKED_FLAG, FOUND_DURING_FLAG]),
	issue_number_schema,
])
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
	comment_fingerprint: z.string().trim().min(1),
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

function report_apply(issue_number: string, result: ApplyResult): void {
	const line = `Issue ${session_cite.issue(issue_number)} ${APPLY_REPORTS[result]}`

	if (result === 'applied') {
		console.info(line)
	} else {
		console.error(line)
	}
}

// joshuafolkken/kit#6630: `--found-during <N>` records the fold as lane N's split child, so the
// fold `issue:file`'s duplicate refusal points to answers the split notice too. joshuafolkken/kit#6643:
// a failed record names the same command, whose rerun takes the written fold as applied and records it.
async function record_split_fold(
	{ issue_number, found_during }: ApplyMode,
	path: string,
): Promise<number> {
	if (found_during === undefined) return SUCCESS_EXIT_CODE

	try {
		await split_resolution.record_fold({ origin: found_during, target: issue_number })
		console.info(
			`Recorded ${session_cite.issue(issue_number)} as ${session_cite.issue(found_during)}'s split child.`,
		)

		return SUCCESS_EXIT_CODE
	} catch (error) {
		console.error(error_text.message_of(error))
		console.error(
			`Rerun \`pnpm josh issue:fold-existing ${shell_quote.word(path)} ${APPLY_FLAG} ${issue_number} ${FOUND_DURING_FLAG} ${found_during}\` to record it.`,
		)

		return FAILURE_EXIT_CODE
	}
}

async function apply_fold(input: Assessment, mode: ApplyMode, path: string): Promise<number> {
	const body = folded_body(input)

	if (body === undefined) {
		console.error(`Fold: ${issue_fold_existing.decide(input)} — nothing written.`)

		return FAILURE_EXIT_CODE
	}

	const result = await issue_fold_apply.apply({
		issue_number: mode.issue_number,
		existing_body: input.existing_body,
		comment_fingerprint: input.comment_fingerprint,
		body,
	})

	report_apply(mode.issue_number, result)

	return result === 'applied' ? await record_split_fold(mode, path) : FAILURE_EXIT_CODE
}

async function read_assessment(path: string): Promise<Assessment | undefined> {
	try {
		return assessment_schema.parse(JSON.parse(await readFile(path, 'utf8')))
	} catch {
		return undefined
	}
}

async function record_duplicate(mode: Extract<Mode, { kind: 'duplicate' }>): Promise<number> {
	try {
		console.info(
			await epic_blocked_by.record({ issue: mode.blocked, prerequisite: mode.issue_number }),
		)

		return SUCCESS_EXIT_CODE
	} catch (error) {
		console.error(`Duplicate dependency could not be recorded: ${error_text.message_of(error)}`)

		return FAILURE_EXIT_CODE
	}
}

async function apply_duplicate(
	input: Assessment,
	mode: Extract<Mode, { kind: 'duplicate' }>,
): Promise<number> {
	if (issue_fold_existing.decide(input) !== 'duplicate') {
		console.error('Fold: not a confirmed duplicate — nothing written.')

		return FAILURE_EXIT_CODE
	}

	const refusal = await issue_fold_apply.check_unchanged({
		...input,
		issue_number: mode.issue_number,
	})

	if (refusal === undefined) return await record_duplicate(mode)
	console.error(APPLY_REPORTS[refusal])

	return FAILURE_EXIT_CODE
}

async function assess(path: string, mode: Mode): Promise<number> {
	const input = await read_assessment(path)

	if (input === undefined) {
		console.error('Could not read a complete assessment; no fold recommendation was made.')

		return FAILURE_EXIT_CODE
	}

	if (mode.kind === 'duplicate') return await apply_duplicate(input, mode)
	if (mode.kind === 'apply') return await apply_fold(input, mode, path)

	return print_assessment(input, mode.should_json)
}

function parse_apply([option, value]: ReadonlyArray<string>): Mode | undefined {
	if (option !== APPLY_FLAG || value === undefined) return undefined

	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(value)
		? { kind: 'apply', issue_number: value }
		: undefined
}

// `--apply <N>` paired with `--blocked <M>` (a duplicate) or `--found-during <M>` (a split fold).
function parse_paired(options: ReadonlyArray<string>): Mode | undefined {
	const parsed = paired_options_schema.safeParse(options)

	if (!parsed.success) return undefined
	const [, issue_number, flag, value] = parsed.data

	return flag === BLOCKED_FLAG
		? { kind: 'duplicate', issue_number, blocked: value }
		: { kind: 'apply', issue_number, found_during: value }
}

// No option and `--json` print; `--apply <N>` writes.
function parse_mode(options: ReadonlyArray<string>): Mode | undefined {
	if (options.length === PAIRED_ARITY) return parse_paired(options)
	if (options.length === FLAG_VALUE_ARITY) return parse_apply(options)

	return options.length <= 1 ? PRINT_MODES.get(options.join(NO_OPTION)) : undefined
}

// joshuafolkken/kit#5891: the token the assessment records as `comment_fingerprint`, read in the same
// pass as the comments, so `--apply` can refuse a thread that changed after it.
async function print_fingerprint(issue_number: string): Promise<number> {
	const fingerprint = await issue_fold_apply.comment_fingerprint(issue_number)

	if (fingerprint === undefined) {
		console.error(`Issue ${session_cite.issue(issue_number)}'s comments could not be read.`)

		return FAILURE_EXIT_CODE
	}

	console.info(fingerprint)

	return SUCCESS_EXIT_CODE
}

// `--fingerprint <N>` reads no assessment, so it stands in the assessment path's place.
function fingerprint_issue(argv: ReadonlyArray<string>): string | undefined {
	if (argv.length !== FLAG_VALUE_ARITY || argv[0] !== FINGERPRINT_FLAG) return undefined
	const value = argv[1] ?? NO_OPTION

	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(value) ? value : undefined
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const fingerprint_target = fingerprint_issue(argv)

	if (fingerprint_target !== undefined) return await print_fingerprint(fingerprint_target)
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
