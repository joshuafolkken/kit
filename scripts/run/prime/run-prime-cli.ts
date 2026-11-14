#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { backlog_drive_launch } from '#scripts/backlog/backlog-drive-launch'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { run_startup } from '#scripts/run/startup/run-startup'

// `josh run:prime` — what a backlogrun owes once per repository before its first lane opens, in one
// call (`backlogrun-lanes.md` → "Once per repository, before the first lane opens"): `main:sync`,
// `latest:if-required`, the rewritten lock file set aside on `required` for the first lane's
// `lane:launch --stash` to pop, `lane:prune` and `run:tidy`.
//
// Each step is the command itself run as a subprocess (`josh-run.ts`), so its refusal — `main:sync`
// inside a lane — stays its own. Stdout carries two lines, `latest skip|required` and
// `stash <message>|clean`; every step's own stdout goes to stderr. The first failed step stops the
// run with a non-zero exit, and the steps after it do not run.

// The message `backlog:drive`'s launch pops by, so the push and the pop cannot drift.
const STASH_MESSAGE = backlog_drive_launch.LATEST_STASH_MESSAGE
const REQUIRED_SCOPE = 'required'
const STASHED_VERDICT = 'stashed'
const CLEAN_VERDICT = 'clean'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const NEWLINE = '\n'
const ARGV_OFFSET = 2
const should_forward_stderr = true

function first_line(result: JoshResult): string {
	return result.out.split(NEWLINE)[0] ?? ''
}

// `undefined` once the step failed, its failure named on stderr.
async function step(argv: ReadonlyArray<string>): Promise<JoshResult | undefined> {
	const result = await run_startup.phase(
		`initialization ${argv[0] ?? ''}`,
		async () => await josh_command.josh_run(argv, should_forward_stderr),
		{
			edge_of: (value) => (value.code === SUCCESS_EXIT_CODE ? 'done' : 'failed'),
		},
	)

	if (result.out !== '') console.error(result.out)
	if (result.code === SUCCESS_EXIT_CODE) return result

	console.error(`run:prime: \`josh ${argv.join(' ')}\` failed — the steps after it did not run`)

	return undefined
}

async function latest(): Promise<string | undefined> {
	const result = await step(['latest:if-required'])

	if (result === undefined) return undefined

	const scope = first_line(result)

	console.info(`latest ${scope}`)

	return scope
}

// The `stash` line's value, `undefined` once the push failed. Only an update rewrote anything, so
// `skip` stashes nothing.
async function stash_line(scope: string): Promise<string | undefined> {
	if (scope !== REQUIRED_SCOPE) return CLEAN_VERDICT

	const result = await step(['stash:push', STASH_MESSAGE])

	if (result === undefined) return undefined

	return first_line(result) === STASHED_VERDICT ? STASH_MESSAGE : CLEAN_VERDICT
}

async function primed(): Promise<boolean> {
	if ((await step(['main:sync'])) === undefined) return false

	const scope = await latest()

	if (scope === undefined) return false

	const stash = await stash_line(scope)

	if (stash === undefined) return false

	console.info(`stash ${stash}`)

	return true
}

async function sweep(): Promise<number> {
	if ((await step(['lane:prune'])) === undefined) return FAILURE_EXIT_CODE

	return (await step(['run:tidy'])) === undefined ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length > 0) {
		console.error('run:prime: takes no arguments')

		return FAILURE_EXIT_CODE
	}

	return await run_startup.phase(
		'initialization',
		async () => ((await primed()) ? await sweep() : FAILURE_EXIT_CODE),
		{
			root: true,
			edge_of: (value) => (value === SUCCESS_EXIT_CODE ? 'done' : 'failed'),
		},
	)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

const run_prime_cli = { run, STASH_MESSAGE }

export { run_prime_cli }
