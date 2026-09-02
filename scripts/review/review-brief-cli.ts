#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { changed_paths } from '#scripts/git/changed-paths'
import { review_brief } from './review-brief'
import { review_level } from './review-level'
import { review_stamps } from './review-stamps'
import { review_tree } from './review-tree'

// `josh review:brief` — print the whole `/code-review` invocation, not just the level
// (joshuafolkken/kit#1241).
//
// `josh review:level` still answers the level and is unchanged; this command reuses it rather than
// deciding again, so the two can never disagree. What it adds is everything else the forked review
// agent cannot find out for itself: whether the gate has passed on this tree, how this project runs
// its unit tests, and — on round 2 — which files the first round's fixes touched.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh review:brief [--round <1|2>]'
const ROUND_FLAG = '--round'
const FIRST_ROUND = 1
const FAILURE_EXIT_CODE = 1
// The flag and its value; anything else is a usage error rather than a round.
const ROUND_ARGUMENT_COUNT = 2
const VALID_ROUNDS: ReadonlySet<number> = new Set([FIRST_ROUND, review_brief.SECOND_ROUND])

// `Number` rather than a parse: `--round 2x` must be a usage error, and a parse would read it as 2.
// A missing value gives `NaN`, which no valid round equals.
function parse_round_value(raw: string | undefined): number | undefined {
	const round = Number(raw)

	return VALID_ROUNDS.has(round) ? round : undefined
}

// `undefined` on anything unrecognized rather than a default: a misspelled flag that silently
// reviewed the whole diff would hand round 2 the scope the command exists to narrow.
function parse_round(argv: ReadonlyArray<string>): number | undefined {
	if (argv.length === 0) return FIRST_ROUND
	if (argv.length !== ROUND_ARGUMENT_COUNT || argv[0] !== ROUND_FLAG) return undefined

	return parse_round_value(argv[1])
}

// The snapshot is taken on round 1 only, and it is taken **before** the review reports, so the
// digests describe the implementation as the first round read it. Taking it again on round 2 would
// overwrite the very record the delta is measured against.
//
// The write is swallowed for the same reason the gate's is: the brief has already been printed and
// is correct, so a temp-directory problem must not turn it into a non-zero exit. What a missing
// snapshot costs is a round 2 that reviews the whole change — wider, never narrower.
function record_round_one(round: number, tree: Record<string, string>): void {
	if (round !== FIRST_ROUND) return

	try {
		review_stamps.round_one_stamp.write(tree)
	} catch {
		/* no record widens the next round rather than narrowing it */
	}
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const round = parse_round(argv)

	if (round === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	// One reading, used for both halves. Read twice, the level could describe a different change from
	// the digests printed beside it — and it would cost four git spawns to do so.
	const paths = await changed_paths.read_changed_paths(false)
	const tree = await review_tree.read_changed_tree(paths)
	const stamps = {
		gate: review_stamps.gate_stamp.read(),
		round_one: review_stamps.round_one_stamp.read(),
	}

	console.info(review_brief.compose({ level: review_level.level_for(paths), round, tree, stamps }))
	record_round_one(round, tree)

	return 0
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const review_brief_cli = { FIRST_ROUND, main, parse_round, run, USAGE }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { review_brief_cli }
