#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { change_base } from '#scripts/git/change-base'
import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { path_decision } from '#scripts/josh/path-decision'
import { review_code_tree } from './review-code-tree'
import { review_reviewed_tree } from './review-reviewed-tree'
import { review_round_one_blobs } from './review-round-one-blobs'
import { review_round_one_closure } from './review-round-one-closure'
import { review_round2, type RoundTwoAnswer } from './review-round2'
import { review_round2_skip_comment } from './review-round2-skip-comment'
import { review_stamps } from './review-stamps'
import { review_tree } from './review-tree'

// `josh review:round2` — say whether the second review round is due.
//
// A command rather than a paragraph in `prompts/review.md`, for the reason `josh review:level` is a
// command: a rule an agent applies from memory is a rule an agent can talk
// itself out of, and this one is argued against every time it is reached, because the round it asks
// for costs a forked agent and a few minutes. The question and the evidence behind the answer are in
// `review-round2.ts`; everything here is the invocation.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh review:round2 [--record <N>] [--json]'
const FAILURE_EXIT_CODE = 1

// **Round 1's closure is read from the ledger, not asserted** (joshuafolkken/kit#5286): the flag that
// once stated it is refused with the one line that names what replaced it.
const RETIRED_CLOSED_FLAG = '--round-1-closed'
const RETIRED_CLOSED_LINE =
	'--round-1-closed is retired: review:round2 reads round 1’s closure from the dispositions `review:record` keeps in the ledger — record each finding as `fixed <spec>` or `false-positive <spec>`, and pass --record <N> to name the issue.'
const RECORD_FLAG = '--record'
// The flag and its issue number.
const RECORD_ARGUMENT_COUNT = 2
const KNOWN_FLAGS: ReadonlyArray<string> = [path_decision.JSON_FLAG]

interface Options {
	is_json: boolean
	// The issue `--record` names — whose ledger lines are read and where a skip is commented.
	record: number | undefined
}

function without_record(argv: ReadonlyArray<string>): ReadonlyArray<string> | undefined {
	const index = argv.indexOf(RECORD_FLAG)

	if (index === -1) return argv

	const value = argv[index + 1] ?? ''

	return issue_number_shape.is_issue_number(value)
		? argv.toSpliced(index, RECORD_ARGUMENT_COUNT)
		: undefined
}

// `undefined` on anything unrecognized rather than a default, through the contract
// `path_decision.has_unknown_flag` states once for every mechanically-decided command: a parser that
// guesses is what makes the answer a matter of which flag was fumbled.
function parse_options(argv: ReadonlyArray<string>): Options | undefined {
	const rest = without_record(argv)

	if (rest === undefined || path_decision.has_unknown_flag(rest, KNOWN_FLAGS)) return undefined

	const index = argv.indexOf(RECORD_FLAG)

	return {
		is_json: rest.includes(path_decision.JSON_FLAG),
		record: index === -1 ? undefined : Number(argv[index + 1]),
	}
}

// The issue whose ledger lines decide round 1's closure: `--record`'s, else the branch's.
async function issue_of(options: Options): Promise<number | undefined> {
	return options.record ?? git_branch.issue_from_branch(await git_command.branch())
}

async function report_record(issue: number, answer: RoundTwoAnswer): Promise<void> {
	const recorded = await review_round2_skip_comment.record(issue, answer)

	if (recorded === 'posted' || recorded === 'present') {
		console.error(`${review_round2_skip_comment.HEADING}: ${recorded} on issue ${String(issue)}`)
	} else if (recorded !== 'not-skipped') {
		console.error(`${review_round2_skip_comment.HEADING}: not recorded (${recorded})`)
	}
}

// Only the paths the code record covers are re-read, so a run without one parses nothing. **A file a
// recorded High cites is never comment-only** (joshuafolkken/kit#4941): `josh ship` reuses round 1 once
// that file's fix moved (`review-reviewed-tree.ts`), so a fix written in comments alone is still this
// round's to verify.
async function read_comment_only(base: string | undefined): Promise<ReadonlyArray<string>> {
	const snapshot = review_stamps.round_one_code_stamp.read()
	const paths = Object.keys(snapshot?.files ?? {})
	const tree = await review_code_tree.read(paths)
	const unmoved = review_round_one_blobs.unmoved({ from: snapshot?.base, to: base, paths })
	const cited = new Set(review_reviewed_tree.high_cited())

	return review_code_tree
		.comment_only(snapshot, tree, base, unmoved)
		.filter((path) => !cited.has(path))
}

// The carry over every path changed now, not only round 1's: a file the fix added after the merge is
// in no round-1 record and has to be named all the same.
function carried_reader(
	base: string | undefined,
	tree: Record<string, string>,
): (snapshot: FileMapStamp) => ReadonlyArray<string> | undefined {
	return (snapshot) =>
		review_round_one_blobs.carried_delta({
			blobs: snapshot.blobs,
			from: snapshot.base,
			to: base,
			paths: Object.keys(tree),
		})
}

// `--json` carries the reason code as well, the field `josh ship` records in the lane ledger.
function print(answer: RoundTwoAnswer, is_json: boolean): void {
	if (is_json) {
		console.info(review_round2.to_json(answer))

		return
	}

	path_decision.print_decision(review_round2.JSON_KEY, answer.verdict, answer.reason, is_json)
}

function refusal_of(argv: ReadonlyArray<string>): string {
	return argv.includes(RETIRED_CLOSED_FLAG) ? RETIRED_CLOSED_LINE : USAGE
}

async function decide_here(options: Options): Promise<RoundTwoAnswer> {
	const closure = await review_round_one_closure.read(await issue_of(options))
	// The commit the tree below is a diff against, so the snapshot can be refused when it was taken
	// against a different one — and the resolved commit rather than `git_command.change_base`, whose
	// fallback is a ref name that moves and would compare equal to itself. Read through a merge in
	// progress, as the changed tree below is.
	const base = await change_base.resolved_through_merge()
	// No paths argument: `read_changed_tree` reads them itself, from the one definition of "changed"
	// `josh review:level` and `josh review:brief` all decide from. Passing our own reading would be a
	// second definition, which is the drift that module exists to prevent.
	const tree = await review_tree.read_changed_tree()

	return review_round2.decide({
		base,
		carried_delta: carried_reader(base, tree),
		comment_only: await read_comment_only(base),
		is_round_one_closed: closure.is_closed,
		open_reason: closure.reason,
		snapshot: review_stamps.round_one_stamp.read(),
		tree,
	})
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const options = parse_options(argv)

	if (options === undefined) {
		console.error(refusal_of(argv))

		return FAILURE_EXIT_CODE
	}

	const decision = await decide_here(options)

	print(decision, options.is_json)

	if (options.record !== undefined) await report_record(options.record, decision)

	return 0
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const review_round2_cli = {
	carried_reader,
	parse_options,
	print,
	read_comment_only,
	RECORD_FLAG,
	RETIRED_CLOSED_FLAG,
	RETIRED_CLOSED_LINE,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { review_round2_cli }
