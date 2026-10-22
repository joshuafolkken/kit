import { readdirSync } from 'node:fs'
import path from 'node:path'
import { toolchain_inputs } from '#scripts/gate/toolchain-inputs'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { file_reader } from '#scripts/lib/read-file'
import { import_graph } from '#scripts/refactor/import-graph'
import { z } from 'zod'

// The merge-base reading `metrics-base.ts` measures, kept so a ship's retries, its gate and an
// `--accept` measure one base once rather than each time (joshuafolkken/kit#4382).
//
// **The key is the base commit and the ruler, never the commit alone.** The base tree is measured by
// this checkout's own command (`metrics-base.ts`), so a branch that changes how a total is counted
// measures the same commit differently; a commit-only key would hand it the old ruler's reading and
// let its growth through. The ruler is every source `metrics-command.ts` loads and the toolchain
// (`toolchain-inputs.ts`): the eslint configuration `metrics-code-lines.ts` counts every tree's lines
// under, and the lockfile that pins the packages it runs on. Reading them costs a fraction of a second
// against the base tree's whole measurement.
//
// **A miss is the old path, never an error**: no record, a record another account owns, or one that
// no longer parses is measured again and written back, so a cache that cannot be trusted only costs
// the time it was meant to save.

const CACHE_PREFIX = 'josh-metrics-base-'
const KEY_SEPARATOR = '\n'
const SOURCE_EXTENSION = '.ts'
const TEST_MARKER = '.test.'
const SOURCE_DIRECTORIES: ReadonlyArray<string> = ['scripts', 'tools']
const COMMAND_SCRIPT = path.join('tools', 'metrics', 'metrics-command.ts')

const approval_schema = z.tuple([z.string(), z.string()])
const record_schema = z.object({ stdout: z.string(), approvals: z.array(approval_schema) })

// What one measurement of the base left: the child's printed totals, parsed by the caller as the
// fresh measurement is, and every approval file's text by file name.
type CachedReading = z.infer<typeof record_schema>

function sources_in(root: string, directory: string): ReadonlyArray<string> {
	try {
		return readdirSync(path.join(root, directory), { recursive: true, encoding: 'utf8' })
			.filter((name) => name.endsWith(SOURCE_EXTENSION) && !name.includes(TEST_MARKER))
			.map((name) => path.join(root, directory, name))
	} catch {
		return []
	}
}

// A fixed order, so the same ruler always hashes the same.
function sorted(files: Iterable<string>): ReadonlyArray<string> {
	return [...files].toSorted((left, right) => left.localeCompare(right))
}

// The files the metrics command loads.
function ruler_files(root: string): ReadonlyArray<string> {
	const universe = SOURCE_DIRECTORIES.flatMap((directory) => sources_in(root, directory))
	const forward = import_graph.build_forward(universe, root)

	return sorted(import_graph.reachable(path.join(root, COMMAND_SCRIPT), forward))
}

function ruler_part(root: string, file: string): string {
	return `${path.relative(root, file)}${KEY_SEPARATOR}${file_reader.read_if_readable(file) ?? ''}`
}

function ruler_digest(root: string): string {
	const parts = ruler_files(root).map((file) => ruler_part(root, file))

	return stamp_file.digest([...parts, toolchain_inputs.digest(root)].join(KEY_SEPARATOR))
}

function cache_path(commit: string, root: string): string {
	return stamp_file.stamp_path(CACHE_PREFIX, `${commit}${KEY_SEPARATOR}${ruler_digest(root)}`)
}

function read(commit: string, root: string): CachedReading | undefined {
	const text = stamp_file.read_stamp_text(cache_path(commit, root))

	return text === undefined
		? undefined
		: record_schema.safeParse(json_value.parse_or_undefined(text)).data
}

// Best-effort: a record that could not be written costs the next call one measurement, never this one.
function write(commit: string, root: string, reading: CachedReading): void {
	try {
		stamp_file.replace_stamp(cache_path(commit, root), reading)
	} catch {
		// A lost record is measured again next time.
	}
}

const metrics_base_cache = { cache_path, read, ruler_files, write }

export type { CachedReading }
export { metrics_base_cache }
