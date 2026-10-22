import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Durations } from '#tools/test/duration-shard'
import { test_module_elapsed, type TimedModule } from '#tools/test/test-module-elapsed'
import type { Reporter, TestModule } from 'vitest/node'

// The per-file durations the CI unit shards are balanced by (joshuafolkken/kit#4467), and the
// reporter that refreshes them. **Recording is opt-in** — `JOSH_UNIT_DURATIONS=record pnpm josh
// test:unit` — so an ordinary run never rewrites a tracked file. A run merges what it measured into
// the record and drops the files that no longer exist, so a filtered run refreshes its own files only.

const RECORD_FILE = 'tools/test/unit-durations.json'
const RECORD_FLAG = 'JOSH_UNIT_DURATIONS'
const RECORD_VALUE = 'record'
const INDENT = '\t'

// Repository-relative and `/`-separated, the one key the record and the sequencer both use.
function relative_file(root: string, module_id: string): string {
	return path.relative(root, module_id).split(path.sep).join(path.posix.sep)
}

function parse(text: string): Durations {
	const parsed: unknown = JSON.parse(text)

	if (typeof parsed !== 'object' || parsed === null) return {}

	return Object.fromEntries(
		Object.entries(parsed).filter(
			(entry): entry is [string, number] => typeof entry[1] === 'number',
		),
	)
}

// A missing or unreadable record is an empty one: every file then weighs the same fallback.
function read(root: string): Durations {
	try {
		return parse(readFileSync(path.join(root, RECORD_FILE), 'utf8'))
	} catch {
		return {}
	}
}

function merge(
	existing: Durations,
	measured: Durations,
	has_file: (file: string) => boolean,
): Durations {
	const entries = Object.entries({ ...existing, ...measured })
		.filter(([file]) => has_file(file))
		.toSorted(([left], [right]) => left.localeCompare(right))

	return Object.fromEntries(entries)
}

function measured_of(modules: ReadonlyArray<TimedModule>, root: string): Durations {
	return Object.fromEntries(
		modules.map((module) => [
			relative_file(root, module.moduleId),
			test_module_elapsed.elapsed_of(module),
		]),
	)
}

function write(measured: Durations, root: string = process.cwd()): void {
	if (Object.keys(measured).length === 0) return

	const record = merge(read(root), measured, (file) => existsSync(path.join(root, file)))

	writeFileSync(path.join(root, RECORD_FILE), `${JSON.stringify(record, undefined, INDENT)}\n`)
}

// No reporter at all unless recording was asked for, so `vitest.config.ts` spreads it in. **The
// record is written as vitest exits**, after the state guard's teardown compared the working tree: a
// write at the run end would read to it as a test that mutated the tree, and fail the run.
function reporters(environment: NodeJS.ProcessEnv = process.env): Array<Reporter> {
	if (environment[RECORD_FLAG] !== RECORD_VALUE) return []

	return [
		{
			onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
				const measured = measured_of(modules, process.cwd())

				process.once('exit', () => {
					write(measured)
				})
			},
		},
	]
}

const unit_duration_record = {
	RECORD_FILE,
	RECORD_FLAG,
	RECORD_VALUE,
	measured_of,
	merge,
	parse,
	read,
	relative_file,
	reporters,
	write,
}

export { unit_duration_record }
