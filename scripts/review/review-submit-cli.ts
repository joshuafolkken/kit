#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_session_broker } from '#scripts/lane/lane-session-broker'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { review_attest, type ReviewSlot } from './review-attest'

// `josh review:submit` — the one write path for a ship reviewer's findings (joshuafolkken/kit#4799).
// The reviewer pipes its findings here on stdin, and this command writes them to the slot's findings
// file under the same key the supervisor reads it by (`run-ship-reviewer.ts`), so no path is ever
// copied out of a prompt. A line outside the `review:record` grammar is refused before anything is
// written, while the reviewer can still fix it.
//
// **A clean review is said with `--none`, never with empty stdin**: a reviewer that forgot the pipe,
// or ran on a terminal, sends nothing, and reading that as clean would lose every finding it had.

const ARGV_OFFSET = 2
const INTERACTION_FLAG = '--interaction'
const NONE_FLAG = '--none'
const FLAGS: ReadonlySet<string> = new Set([INTERACTION_FLAG, NONE_FLAG])
const USAGE =
	'Usage: josh review:submit [--interaction] < findings | josh review:submit [--interaction] --none'
const EMPTY_NOTE = `nothing written — no findings on stdin; a review with none passes ${NONE_FLAG}`
const NONE_WITH_FINDINGS_NOTE = `nothing written — ${NONE_FLAG} was passed with findings on stdin`
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

interface Submission {
	slot: ReviewSlot
	is_none: boolean
}

function submission_of(argv: ReadonlyArray<string>): Submission | undefined {
	const is_valid = argv.every((flag) => FLAGS.has(flag)) && new Set(argv).size === argv.length

	if (!is_valid) return undefined

	const { CODE, INTERACTION } = review_attest.REVIEW_SLOT

	return {
		slot: argv.includes(INTERACTION_FLAG) ? INTERACTION : CODE,
		is_none: argv.includes(NONE_FLAG),
	}
}

function grammar_refusal(findings: string): string | undefined {
	const verdict = run_ship_review.read_verdict(findings)

	return verdict.kind === run_ship_review.VERDICT.INVALID
		? `nothing written — ${verdict.note}`
		: undefined
}

// The refusal for stdin that does not match the flags, or for a line outside the grammar.
function refusal_of(submission: Submission, findings: string): string | undefined {
	const is_empty = findings.trim() === ''

	if (submission.is_none) return is_empty ? undefined : NONE_WITH_FINDINGS_NOTE

	return is_empty ? EMPTY_NOTE : grammar_refusal(findings)
}

function write(submission: Submission, findings: string): string {
	const { slot, is_none } = submission
	const target = lane_session_broker.review_paths(PROJECT_ROOT, slot).findings

	stamp_file.write_text_stamp(target, is_none ? '' : findings)

	return is_none
		? `the ${slot} review is submitted with no findings.`
		: `the ${slot} review's findings are submitted.`
}

function run(argv: ReadonlyArray<string>, findings: string): number {
	const submission = submission_of(argv)
	const refusal = submission === undefined ? USAGE : refusal_of(submission, findings)

	if (submission === undefined || refusal !== undefined) {
		console.error(refusal)

		return FAILURE_EXIT_CODE
	}

	console.info(write(submission, findings))

	return SUCCESS_EXIT_CODE
}

async function main(): Promise<void> {
	const findings = process.stdin.isTTY ? '' : await text(process.stdin)

	process.exitCode = run(process.argv.slice(ARGV_OFFSET), findings)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

const review_submit_cli = { EMPTY_NOTE, USAGE, run }

export { review_submit_cli }
