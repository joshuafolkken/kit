#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { change_base } from '#scripts/git/change-base'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { path_decision } from '#scripts/josh/path-decision'
import { review_code_tree } from './review-code-tree'
import { review_reviewed_tree } from './review-reviewed-tree'
import { review_round_one_blobs } from './review-round-one-blobs'
import { review_round2, type RoundTwoAnswer } from './review-round2'
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
const USAGE = 'Usage: josh review:round2 [--round-1-closed] [--json]'
const FAILURE_EXIT_CODE = 1

// The one input no command can read for itself, so the caller states it: every round-1 High/Medium
// finding closed, by a fix in this working tree or as a verified false positive, and none was filed
// or deferred. Spelled out rather than shortened to `--closed`, because a flag whose meaning has to
// be recalled is one that gets passed on the wrong run.
const CLOSED_FLAG = '--round-1-closed'
const KNOWN_FLAGS: ReadonlyArray<string> = [CLOSED_FLAG, path_decision.JSON_FLAG]

interface Options {
	is_round_one_closed: boolean
	is_json: boolean
}

// `undefined` on anything unrecognized rather than a default, through the contract
// `path_decision.has_unknown_flag` states once for every mechanically-decided command: a misspelled
// `--round1-closed` that silently answered `required` would be harmless, but a parser that guesses
// is what makes the difference a matter of which flag was fumbled.
function parse_options(argv: ReadonlyArray<string>): Options | undefined {
	if (path_decision.has_unknown_flag(argv, KNOWN_FLAGS)) return undefined

	return {
		is_round_one_closed: argv.includes(CLOSED_FLAG),
		is_json: argv.includes(path_decision.JSON_FLAG),
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

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const options = parse_options(argv)

	if (options === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	// The commit the tree below is a diff against, so the snapshot can be refused when it was taken
	// against a different one — and the resolved commit rather than `git_command.change_base`, whose
	// fallback is a ref name that moves and would compare equal to itself. Read through a merge in
	// progress, as the changed tree below is.
	const base = await change_base.resolved_through_merge()
	// No paths argument: `read_changed_tree` reads them itself, from the one definition of "changed"
	// `josh review:level` and `josh review:brief` all decide from. Passing our own reading would be a
	// second definition, which is the drift that module exists to prevent.
	const tree = await review_tree.read_changed_tree()
	const decision = review_round2.decide({
		base,
		carried_delta: carried_reader(base, tree),
		comment_only: await read_comment_only(base),
		is_round_one_closed: options.is_round_one_closed,
		snapshot: review_stamps.round_one_stamp.read(),
		tree,
	})

	print(decision, options.is_json)

	return 0
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const review_round2_cli = {
	CLOSED_FLAG,
	carried_reader,
	parse_options,
	print,
	read_comment_only,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { review_round2_cli }
