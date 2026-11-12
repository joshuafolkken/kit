// The laps `josh git` writes under the ship's commit (joshuafolkken/kit#5831): its own steps, and each
// git hook its commit and push run, so a contended commit's minutes are named by what waited. A hook is
// timed where josh dispatches it, and records only under a lap scope a parent handed down
// (`run-ship-lap.ts` → `environment`); the lap module is loaded for a hook alone.

const GIT_STEP = {
	PREFLIGHT: 'preflight',
	STAGING: 'staging',
	ISSUE: 'issue',
	TEST_RED: 'test red',
	COMMIT: 'commit',
	PUSH: 'push',
	PR: 'pr',
} as const
const HOOK_CATEGORY = 'Git hooks'
const LINT_COMMAND = 'pre-commit-lint'
const RESERVED_COMMAND = 'reserved-run'
const RESERVED_SEPARATOR = '--'
const JOSH_PREFIX = 'pnpm josh '

// The command `reserved-run` held cores for, `pnpm install` or `audit`.
function reserved_step(args: ReadonlyArray<string>): string {
	const wrapped = args.slice(args.indexOf(RESERVED_SEPARATOR) + 1).join(' ')

	return wrapped.startsWith(JOSH_PREFIX) ? wrapped.slice(JOSH_PREFIX.length) : wrapped
}

// The name a hook's lap is written under: the linter `pre-commit-lint` ran, the command `reserved-run`
// held cores for, else the hook's own command.
function step_of(command: string, args: ReadonlyArray<string>): string {
	if (command === LINT_COMMAND) return args[0] ?? command
	if (command === RESERVED_COMMAND) return reserved_step(args)

	return command
}

async function timed_command(
	command: string,
	category: string | undefined,
	args: ReadonlyArray<string>,
	run: () => Promise<number>,
): Promise<number> {
	if (category !== HOOK_CATEGORY) return await run()
	const { run_ship_lap } = await import('#scripts/run/ship/run-ship-lap')

	return await run_ship_lap.timed(
		step_of(command, args),
		async () => {
			// The hook's own lap holds the scope, so the processes it starts — the unit suite among them —
			// do not inherit it and time their own steps under it a second time.
			process.env[run_ship_lap.ENVIRONMENT_KEY] = ''

			return await run()
		},
		{ startup: false },
	)
}

const hook_lap = { GIT_STEP, step_of, timed_command }

export { hook_lap }
