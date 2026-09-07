#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { review_attest, type AttestVerdict } from './review-attest'
import { review_checkout } from './review-checkout'

// `josh review:attest` — the two halves of the checkout contract `josh review:brief` opens
// (joshuafolkken/kit#1522).
//
// **`josh review:attest <nonce>` is run by the review**, from the checkout it actually read. It
// compares that checkout against the one the brief described and exits non-zero when they differ, so
// a mistargeted review is told so at the moment it would otherwise start reporting findings about
// somebody else's code.
//
// **`josh review:attest --check` is run by the run**, before it acts on the review's verdict and
// again by `josh followup --merge` before it merges. It fails on a missing attestation exactly as it
// fails on a mismatched one: the defect this command exists for produced *no* signal, so treating
// silence as a pass would leave the hole open in the one shape it actually takes.

const ARGV_OFFSET = 2
const CHECK_FLAG = '--check'
const USAGE = 'Usage: josh review:attest <nonce> | josh review:attest --check'
const FAILURE_EXIT_CODE = 1
const NONCE_PATTERN = /^[0-9a-f]{8,64}$/u

const NOT_REQUIRED_LINE =
	'No review target is recorded for this checkout, so there is nothing to attest.'

const UNKNOWN_NONCE_LINE =
	'No review target is recorded under that nonce. It belongs to another machine, or the brief that printed it has expired — ask the run for a fresh `pnpm josh review:brief`.'

function attested_line(verdict: AttestVerdict): string {
	return `Attested: the review read the checkout it was briefed on.\n${verdict.expected === undefined ? '' : review_checkout.describe_checkout(verdict.expected)}`
}

// The checkout is read here rather than passed in, and that is the whole mechanism: a fork that ran
// this command somewhere else reports *that* place, because git answers about the process's own
// working directory. Values handed in on the command line would only ever agree with themselves.
async function run_attest(nonce: string): Promise<number> {
	const verdict = review_attest.attest(nonce, await review_checkout.read_checkout())

	if (verdict.status === 'ok') {
		console.info(attested_line(verdict))

		return 0
	}

	const message =
		verdict.expected === undefined ? UNKNOWN_NONCE_LINE : review_attest.refusal_message(verdict)

	console.error(message)

	return FAILURE_EXIT_CODE
}

// **`check_here`, not `check`** — the pointer is keyed on the repository root, and `check`'s default
// is `PROJECT_ROOT`, which is `process.cwd()`. Run from a subdirectory, or from the session checkout
// rather than the lane's, the two hash different keys: no pointer is found, the command prints "no
// review target is recorded" and exits 0. That is a pass in the one state this command exists to
// catch, and it is the gate the documents tell a run to consult before counting a review round.
async function run_check(): Promise<number> {
	const verdict = await review_attest.check_here()

	if (verdict.status === 'not-required') {
		console.info(NOT_REQUIRED_LINE)

		return 0
	}

	if (verdict.status === 'ok') {
		console.info(attested_line(verdict))

		return 0
	}

	console.error(review_attest.refusal_message(verdict))

	return FAILURE_EXIT_CODE
}

// Anything unrecognized is a usage error rather than a default. A misspelled flag that fell through
// to `--check` would report a pass that nobody asked for, which is the direction this whole command
// exists to close off.
function usage(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const [first] = argv

	if (first === undefined || argv.length !== 1) return usage()
	if (first === CHECK_FLAG) return await run_check()
	if (NONCE_PATTERN.test(first)) return await run_attest(first)

	return usage()
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const review_attest_cli = {
	CHECK_FLAG,
	main,
	NOT_REQUIRED_LINE,
	run,
	run_check,
	UNKNOWN_NONCE_LINE,
	USAGE,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { review_attest_cli }
