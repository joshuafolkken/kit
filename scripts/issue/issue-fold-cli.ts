#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { git_command } from '#scripts/git/git-command'
import { path_decision } from '#scripts/josh/path-decision'
import { split_assess, type SplitVerdict } from '#scripts/split/split-assess'
import { issue_fold, type FoldVerdict } from './issue-fold'

// `josh issue:fold "<title>" "<title>" …` — before a run files a second finding, answer whether the
// findings this session holds fold into one Issue (joshuafolkken/kit#2213).
//
// It is the filing-time counterpart to `split:assess`: the size half is that command's own verdict,
// called rather than recomputed (the counting and the guide live in `split-assess.ts`), and
// separability stays the judgement it is at the entry — presumed here, and overridden with
// `--not-separable` when the findings are really one deliverable. The verdict logic is in
// `issue-fold.ts`; everything here is the invocation.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh issue:fold "<title>" "<title>" … [--not-separable] [--json]'
const JSON_KEY = 'fold'
const FAILURE_EXIT_CODE = 1

const REASONS: Record<FoldVerdict, string> = {
	fold: 'fold — file one Issue covering these findings; the split guide is not cleared, so they are one Issue however separable',
	separate:
		'separate — file these apart; they are separable and their combined size clears the split guide',
	'no-fold-needed': 'no fold needed — a single candidate is filed on its own',
}

interface FoldArguments {
	titles: Array<string>
	is_separable: boolean
	is_json: boolean
}

function parse_arguments(argv: ReadonlyArray<string>): FoldArguments {
	const { values, positionals } = parseArgs({
		args: [...argv],
		options: { json: { type: 'boolean' }, 'not-separable': { type: 'boolean' } },
		allowPositionals: true,
	})

	return {
		titles: positionals,
		is_separable: values['not-separable'] !== true,
		is_json: values.json === true,
	}
}

// An unknown flag makes `parseArgs` throw. Caught so the answer is the usage line rather than a stack
// trace, on a command whose output a workflow reads.
function read_arguments(argv: ReadonlyArray<string>): FoldArguments | undefined {
	try {
		return parse_arguments(argv)
	} catch {
		return undefined
	}
}

// The size half, single-sourced from `split:assess` (joshuafolkken/kit#2183): the same counting, the
// same guide. A diff that cannot be read — no base, not a checkout — measures as empty, which
// `split_assess` reads as `single`, so an unanswerable size folds rather than tipping to `separate`.
async function size_verdict(): Promise<SplitVerdict> {
	try {
		return split_assess.assess(await git_command.diff_main_numstat()).verdict
	} catch {
		return split_assess.SINGLE_VERDICT
	}
}

// The size question is only asked once there is something to fold; a lone candidate is answered
// without measuring anything.
async function size_for(args: FoldArguments): Promise<SplitVerdict> {
	if (args.titles.length < issue_fold.MIN_CANDIDATES) return split_assess.SINGLE_VERDICT

	return await size_verdict()
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const args = read_arguments(argv)

	if (args === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const size = await size_for(args)
	const verdict = issue_fold.fold_verdict(args.titles.length, args.is_separable, size)

	path_decision.print_decision(JSON_KEY, verdict, REASONS[verdict], args.is_json)

	return 0
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_fold_cli = { JSON_KEY, USAGE, REASONS, read_arguments, size_verdict, run, main }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_fold_cli }
