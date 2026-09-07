#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { review_attest } from './review-attest'
import { review_brief } from './review-brief'
import { review_checkout, type ReviewCheckout } from './review-checkout'
import { review_level } from './review-level'
import { review_stamps } from './review-stamps'
import { review_tree } from './review-tree'

// `josh review:brief` — print the whole `/code-review` invocation, not just the level
// (joshuafolkken/kit#1241).
//
// `josh review:level` still answers the level and is unchanged; this command reuses it rather than
// deciding again, so the two can never disagree. What it adds is everything else the forked review
// agent cannot find out for itself: whether the gate has passed **or is running** on this tree
// (joshuafolkken/kit#1242 — the two are started together, so "still running" is the usual answer at
// this point), how this project runs its unit tests, and — on round 2 — which files the first
// round's fixes touched.

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

// **Printed on stderr, because stdout is the `/code-review` invocation and nothing else.** A kept
// record is not an error, but it is the one thing a second round-1 invocation has to be told: the
// delta it is about to be measured against was taken earlier than this call, and silence there is
// what made the retake invisible in the first place.
const KEPT_NOTE_PREFIX = 'Round-1 snapshot: kept the record taken at'

function kept_note(taken_at: string): string {
	return `${KEPT_NOTE_PREFIX} ${taken_at} rather than retaking it — the fix delta is measured from there, so everything changed since is reviewed rather than assumed away. Check that timestamp: a record left behind by an earlier run measures the delta from further back, which widens the round rather than narrowing it (joshuafolkken/kit#1441).`
}

// The snapshot is taken on round 1 only, and it is taken **before** the review reports, so the
// digests describe the implementation as the first round read it. Taking it again on round 2 would
// overwrite the very record the delta is measured against.
//
// **It is written once per run and never retaken** (joshuafolkken/kit#1441). Overwriting on every
// round-1 invocation put a wrong `skip` one command away: run a bare `josh review:brief` after round
// 1's fixes are in and the record is retaken against the fixed tree, the fix delta reads empty, and
// `josh review:round2 --round-1-closed` fires arm A on unreviewed fix code. Keeping the record the
// run already has removes that path outright — a second round-1 invocation reads it and leaves it
// alone, so every later reading of the delta is measured from before the fixes.
//
// **The record's lifetime is one run, and `josh followup` is what ends it** (`review-stamps.ts` →
// `clear_round_one`). That is the whole of "is this a new run or the same one", answered by the event
// that ends a run rather than by a proxy for it — and the two proxies considered were both rejected
// for pointing the wrong way when they are wrong. A record left behind by a run that never reached
// `followup` is measured from further back, so the next run's delta is **wider**: it costs a round 2
// rather than skipping one, which is the direction every uncertainty here has to fall.
//
// The write is swallowed for the same reason the gate's is: the brief has already been printed and
// is correct, so a temp-directory problem must not turn it into a non-zero exit. What a missing
// snapshot costs is a round 2 that reviews the whole change — wider, never narrower.
function record_round_one(round: number, tree: Record<string, string>, target?: string): void {
	if (round !== FIRST_ROUND) return

	try {
		const recorded = review_stamps.round_one_stamp.read(target)

		if (recorded !== undefined) {
			console.error(kept_note(recorded.taken_at))

			return
		}

		review_stamps.round_one_stamp.write(tree, target)
	} catch {
		/* no record widens the next round rather than narrowing it */
	}
}

// **Recorded before it is printed, and the write is not swallowed** (joshuafolkken/kit#1522). The
// nonce the brief prints is a contract the run enforces later; a brief that printed one it had
// failed to record would hand the review a command that cannot succeed and the run a check that
// answers `not-required` — the guard gone, silently, which is the shape this whole record exists to
// remove.
async function open_contract(): Promise<{ checkout: ReviewCheckout; nonce: string }> {
	const checkout = await review_checkout.read_checkout()

	// Keyed on the root git just answered with, never on `process.cwd()`: the check made before the
	// merge asks git the same question, and the two hash different keys the moment one of them runs
	// from a subdirectory — a mismatch that would drop the guard with nothing printed.
	return { checkout, nonce: review_attest.record_target(checkout, checkout.root) }
}

async function compose_brief(
	round: number,
	paths: ReadonlyArray<string>,
	tree: Record<string, string>,
): Promise<string> {
	const stamps = {
		gate: review_stamps.gate_stamp.read(),
		in_flight: review_stamps.in_flight_stamp.read(),
		round_one: review_stamps.round_one_stamp.read(),
	}

	return review_brief.compose({
		level: review_level.level_for(paths),
		round,
		tree,
		stamps,
		// Resolved here rather than printed as a `$(…)` the forked agent would expand: a subshell that
		// fails expands to nothing, and the bare `git diff` left behind lists only the unstaged working
		// tree — a review silently narrowed to a fraction of the change (joshuafolkken/kit#1527).
		base: await git_command.change_base(),
		...(await open_contract()),
	})
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

	console.info(await compose_brief(round, paths, tree))
	record_round_one(round, tree)

	return 0
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const review_brief_cli = {
	FIRST_ROUND,
	KEPT_NOTE_PREFIX,
	kept_note,
	main,
	parse_round,
	record_round_one,
	run,
	USAGE,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { review_brief_cli }
