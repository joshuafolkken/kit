#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_chain } from './run-chain'

// `josh run:chain <N>` — `main:merge`, `review:selfcheck`, `check:related` and `run:review` in one call
// (`run-chain.ts`). `--from <stage>` resumes at a stage after a stop the run settled; `--unpinned-ok
// "<reason>"` goes to `run:review` as given.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh run:chain <N> [--from <stage>] [--unpinned-ok "<reason>"]'
const OPTIONS = {
	from: { type: 'string' },
	'unpinned-ok': { type: 'string' },
} as const

interface ChainArguments {
	issue: string
	from?: string
	unpinned_ok: ReadonlyArray<string>
}

function arguments_from(
	issue: string | undefined,
	from: string | undefined,
	reason: string | undefined,
): ChainArguments | undefined {
	if (issue === undefined) return undefined

	return {
		issue,
		...(from !== undefined && { from }),
		unpinned_ok: reason === undefined ? [] : ['--unpinned-ok', reason],
	}
}

function parse(argv: ReadonlyArray<string>): ChainArguments | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined) return undefined

	const { values, positionals } = parsed

	return arguments_from(
		issue_number_shape.single_of(positionals),
		values.from,
		values['unpinned-ok'],
	)
}

function refuse(message: string): number {
	console.error(message)

	return FAILURE_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = parse(argv)

	if (parsed === undefined) return refuse(USAGE)
	const all = run_chain.main_line_stages(parsed.unpinned_ok)
	const stages = run_chain.stages_from(all, parsed.from)

	if (stages === undefined) return refuse(`no stage ${String(parsed.from)}\n${USAGE}`)
	const stop = await run_chain.run_stages(stages, parsed.issue, (text) => {
		console.info(text)
	})

	if (stop !== undefined) return refuse(run_chain.stop_report(stop, parsed.issue))
	console.info(run_chain.done_report(stages, parsed.issue))

	return run_chain.SUCCESS_EXIT_CODE
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

const run_chain_cli = { USAGE, run }

export { run_chain_cli }
