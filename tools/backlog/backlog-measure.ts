import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { git_utilities } from '#scripts/git/constants'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { execa } from 'execa'
import { backlog_measure_schema, type MeasureScenario } from './backlog-measure-schema'

const WORKER = fileURLToPath(new URL('backlog-measure-worker.ts', import.meta.url))
const FAILURE_EXIT = 1
const POSITIONALS_START = 2
const STATUS_FILE = 'status.json'
const GIT_BINARY = git_utilities.get_git_command_for_spawn()

function environment(root: string): NodeJS.ProcessEnv {
	const inherited = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !key.startsWith('JOSH_') && !key.startsWith('GIT_'),
		),
	)

	return {
		...inherited,
		...git_location_environment.location_free_environment(),
		NODE_OPTIONS: '',
		JOSH_STARTUP_SCOPE: '',
		JOSH_LANE_CHILD: '',
		JOSH_TEMP_ROOT: path.join(root, 'state'),
		TMPDIR: root,
		XDG_CACHE_HOME: path.join(root, 'cache'),
		JOSH_GIT_BINARY: GIT_BINARY,
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_CONFIG_GLOBAL: devNull,
		GH_REPO: undefined,
	}
}

function prepare(scenario: MeasureScenario, root: string): string {
	const cwd = path.join(root, 'checkout')

	mkdirSync(cwd, { recursive: true })
	execFileSync(GIT_BINARY, ['init', '--quiet', cwd], { cwd, env: environment(root) })
	const input = path.join(root, 'input.json')

	writeFileSync(input, JSON.stringify(scenario))
	writeFileSync(path.join(root, STATUS_FILE), JSON.stringify({ status: 'incomplete' }))

	return input
}

function arguments_of(root: string, input: string): Array<string> {
	return [
		'--permission',
		'--allow-fs-read=*',
		`--allow-fs-write=${root}`,
		'--allow-child-process',
		'--allow-worker',
		'--import',
		import.meta.resolve('tsx/esm'),
		WORKER,
		input,
		root,
	]
}

async function trial(scenario: MeasureScenario, root: string): Promise<boolean> {
	const input = prepare(scenario, root)
	const child = await execa(process.execPath, arguments_of(root, input), {
		cwd: path.join(root, 'checkout'),
		env: environment(root),
		extendEnv: false,
		reject: false,
		timeout: scenario.timeout_ms,
	})
	const status = child.exitCode === 0 ? 'completed' : 'failed'

	writeFileSync(
		path.join(root, STATUS_FILE),
		JSON.stringify({
			status,
			exit: child.exitCode,
			signal: child.signal,
			timed_out: child.timedOut,
			stderr: child.stderr,
		}),
	)

	return status === 'completed'
}

async function run(input: unknown): Promise<{ root: string; succeeded: boolean }> {
	const scenario = backlog_measure_schema.scenario_schema.parse(input)
	const root = mkdtempSync(path.join(tmpdir(), 'josh-backlog-measure-'))
	const count = scenario.mode === 'cold' ? scenario.repetitions : 1
	let is_succeeded = true

	for (let index = 0; index < count; index++) {
		const directory = path.join(root, String(index))

		mkdirSync(directory)
		// Cold attempts run serially so they do not compete for resources.
		// eslint-disable-next-line no-await-in-loop
		if (!(await trial(scenario, directory))) is_succeeded = false
	}

	return { root, succeeded: is_succeeded }
}

function set_exit(is_succeeded: boolean): void {
	if (!is_succeeded) process.exitCode = FAILURE_EXIT
}

async function main(): Promise<void> {
	if (process.argv[1] !== fileURLToPath(import.meta.url)) return
	const input: unknown = JSON.parse(readFileSync(process.argv[POSITIONALS_START] ?? '', 'utf8'))
	const result = await run(input)

	console.info(JSON.stringify(result))
	set_exit(result.succeeded)
}

await main()

const backlog_measure = { run, environment }
export { backlog_measure }
