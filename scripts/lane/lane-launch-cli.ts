#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { josh_command } from '#scripts/josh/josh-run'
import { execa } from 'execa'

// `josh lane:launch <issue> [--stash <message>]` — one composite command for a `backlogrun` lane-start
// event (joshuafolkken/kit#2162). Opening one lane was four to six turns of the parent: `lane:open`,
// then — only the first lane, and only when `josh latest` had stashed — `stash:pop` and a re-install,
// then `lane:dispatch`. This collapses them into one call that returns the child's pid, or a refusal,
// the same shape `lane:dispatch` alone has.
//
// **It is a thin layer over the existing commands**, shelling out to each so their guards, refusals
// and messages are reused rather than cloned — `lane:open`'s cut-session guard and its `full` /
// `already-open` refusals, `stash:pop`'s message-matched pop, `lane:dispatch`'s in-progress claim and
// warning. Their explanations stream through to stderr; the child's pid is the one thing on stdout.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const should_forward_stderr = true
const PNPM = 'pnpm'
const ISSUE_PATTERN = /^[1-9]\d*$/u

const USAGE = 'Usage: josh lane:launch <issue-number> [--stash <message>]'

const OPTIONS = { stash: { type: 'string' } } as const

// The stash message is present only for the first lane — the caller passes `--stash` there and nowhere
// else, so "only the first lane pops and re-installs" is preserved by which invocation carries it.
interface LaunchContext {
	issue: string
	stash: string | undefined
}

function read_context(argv: ReadonlyArray<string>): LaunchContext | undefined {
	try {
		const parsed = parseArgs({
			args: [...argv],
			options: OPTIONS,
			strict: true,
			allowPositionals: true,
		})
		const [issue, ...rest] = parsed.positionals

		if (issue === undefined || rest.length > 0 || !ISSUE_PATTERN.test(issue)) return undefined

		return { issue, stash: parsed.values.stash }
	} catch {
		return undefined
	}
}

// The pop brought in the `pnpm-lock.yaml` `josh latest` rewrote, so this one lane installs a second
// time against it. Output is captured and surfaced only on failure, so the composite's stdout stays
// the child's pid alone.
async function install(directory: string): Promise<boolean> {
	const result = await execa(PNPM, ['--dir', directory, 'install', '--frozen-lockfile'], {
		reject: false,
	})

	if ((result.exitCode ?? FAILURE_EXIT_CODE) === SUCCESS_EXIT_CODE) return true

	console.error(result.stderr === '' ? result.stdout : result.stderr)

	return false
}

// The first lane pops the shared stash and re-installs against the lock it brought in; a pop that
// refused (`no-match` / `ambiguous`) stops the lane rather than dispatching onto an unprepared tree.
// A caller without `--stash` skips both, which is every lane after the first.
async function prepare(stash: string | undefined, directory: string): Promise<boolean> {
	if (stash === undefined) return true

	const popped = await josh_command.josh_run(
		['stash:pop', stash, '--dir', directory],
		should_forward_stderr,
	)

	if (popped.code !== SUCCESS_EXIT_CODE) return false

	return await install(directory)
}

async function launch(context: LaunchContext): Promise<number> {
	const opened = await josh_command.josh_run(['lane:open', context.issue], should_forward_stderr)

	if (opened.code !== SUCCESS_EXIT_CODE) return FAILURE_EXIT_CODE

	if (!(await prepare(context.stash, opened.out))) return FAILURE_EXIT_CODE

	const dispatched = await josh_command.josh_run(
		['lane:dispatch', context.issue],
		should_forward_stderr,
	)

	if (dispatched.code !== SUCCESS_EXIT_CODE) return FAILURE_EXIT_CODE

	console.info(dispatched.out)

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const context = read_context(argv)

	if (context === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await launch(context)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_launch_cli = { USAGE, install, launch, prepare, read_context, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_launch_cli }
