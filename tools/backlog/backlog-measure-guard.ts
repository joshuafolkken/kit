import child_process from 'node:child_process'
import { realpathSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import { z } from 'zod'
import type { MeasureBoundary, MeasureScenario } from './backlog-measure-schema'

const GIT_ARGUMENTS: ReadonlySet<string> = new Set([
	'["rev-parse","--show-toplevel"]',
	'["rev-parse","--git-common-dir"]',
	'["rev-parse","--git-dir"]',
	'["rev-parse","--is-inside-work-tree"]',
	'["rev-parse","--show-prefix"]',
	'["rev-parse","--absolute-git-dir","--path-format=absolute","--git-common-dir"]',
	'["status","--porcelain"]',
	'["stash","list"]',
	'["stash","list","--format=%gd%x00%gs"]',
	'["--version"]',
])
const COMMAND_PARTS = 2
const SPAWN_ARGUMENTS = z.tuple([z.string(), z.array(z.string())]).rest(z.unknown())
const OPTIONS = z.looseObject({
	cwd: z.string().default(process.cwd),
	shell: z.literal(false).default(false),
})
const SAFE_METHODS = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync'])
const BOOLEAN_FLAGS = new Set(['--paginate', '--slurp', '--include', '--silent'])
const FILTER_FLAGS = new Set(['--jq', '-q'])
const VALUE_FLAG_WIDTH = 2
const METHODS = [
	'spawn',
	'spawnSync',
	'exec',
	'execSync',
	'execFile',
	'execFileSync',
	'fork',
] as const

function is_boolean(flag: string | undefined): boolean {
	return flag !== undefined && BOOLEAN_FLAGS.has(flag)
}

function filter_at(flags: ReadonlyArray<string>, index: number): boolean {
	return FILTER_FLAGS.has(flags[index] ?? '') && flags[index + 1] !== undefined
}

function flag_width(flags: ReadonlyArray<string>, index: number): number {
	if (is_boolean(flags[index])) return 1

	return filter_at(flags, index) ? VALUE_FLAG_WIDTH : 0
}

function read_flags(flags: ReadonlyArray<string>): boolean {
	let index = 0

	while (index < flags.length) {
		const width = flag_width(flags, index)
		if (width === 0) return false
		index += width
	}

	return true
}

function api_get(args: ReadonlyArray<string>, endpoints: ReadonlyArray<string>): boolean {
	const endpoint = endpoints.find((candidate) => args.includes(candidate))
	if (endpoint === undefined) return false
	const flags = args.slice(1).filter((argument) => argument !== endpoint)

	return args[0] === 'api' && read_flags(flags)
}

function live_read(args: ReadonlyArray<string>, endpoints: ReadonlyArray<string>): boolean {
	return (args.length === 1 && args[0] === '--version') || api_get(args, endpoints)
}

function git_read(args: ReadonlyArray<string>): boolean {
	if (GIT_ARGUMENTS.has(JSON.stringify(args))) return true

	return args.length === COMMAND_PARTS + 1 && args[0] === 'config' && args[1] === '--get'
}

function inside(cwd: string, root: string): boolean {
	try {
		const actual = realpathSync(cwd)
		const boundary = realpathSync(root)

		return actual === boundary || actual.startsWith(`${boundary}${path.sep}`)
	} catch {
		return false
	}
}

function safe_options(raw_options: unknown, root: string): boolean {
	const options = OPTIONS.default({ cwd: process.cwd(), shell: false }).safeParse(raw_options)
	if (!options.success) return false

	return inside(options.data.cwd, root)
}

function binary_read(file: string, args: Array<string>, scenario: MeasureScenario): boolean {
	if (path.basename(file) === 'gh') return live_read(args, scenario.live_get)

	return path.basename(file) === 'git' && git_read(args)
}

function allowed(parameters: Array<unknown>, scenario: MeasureScenario, root: string): boolean {
	const parsed = SPAWN_ARGUMENTS.safeParse(parameters)
	if (!parsed.success) return false
	const [file, args, raw_options] = parsed.data
	if (!safe_options(raw_options, root)) return false

	return binary_read(file, args, scenario)
}

function wrapped(
	original: unknown,
	context: {
		name: string
		scenario: MeasureScenario
		root: string
		records: Array<MeasureBoundary>
	},
): (...parameters: Array<unknown>) => unknown {
	return function guarded(...parameters: Array<unknown>): unknown {
		const is_allowed =
			SAFE_METHODS.has(context.name) && allowed(parameters, context.scenario, context.root)

		context.records.push({
			attempt: '',
			source: is_allowed ? 'live' : 'denied',
			operation: JSON.stringify(parameters.slice(0, COMMAND_PARTS)),
		})

		if (!is_allowed || typeof original !== 'function') {
			throw new Error('Measurement refused an external process')
		}

		return Reflect.apply(original, child_process, parameters)
	}
}

function install(
	scenario: MeasureScenario,
	root: string,
	records: Array<MeasureBoundary>,
): () => void {
	const originals = new Map(METHODS.map((name) => [name, Reflect.get(child_process, name)]))

	for (const name of METHODS) {
		const original: unknown = originals.get(name)

		Reflect.set(child_process, name, wrapped(original, { name, scenario, root, records }))
	}

	syncBuiltinESMExports()

	return function restore(): void {
		for (const [name, original] of originals) Reflect.set(child_process, name, original)
		syncBuiltinESMExports()
	}
}

const backlog_measure_guard = { allowed, install }
export { backlog_measure_guard }
