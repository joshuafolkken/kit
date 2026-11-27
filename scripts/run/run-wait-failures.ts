// The test files a bounded check's log already shows failed, for `josh wait`'s `pending` answer
// (joshuafolkken/kit#9108): a failure the full run settled early reaches the lane child at its next
// wait, not at the run's end, and the child need not write its own search of vitest's notation. The
// summary only adds a line — whether to stop and fix or wait for the full count stays the child's.
//
// vitest's default reporter, written to a file, prints per finished file
// ` ❯ |pure| scripts/a.test.ts (5 tests | 1 failed)` and its duration, a `×` line per failed test under it (the
// test's name, never the file's), and at the end ` FAIL  |pure| scripts/a.test.ts > describe > test`.

// A per-file line: one space, the state glyph, the optional project tag, the file, its test count.
const FILE_LINE = /^ [✓×❯↓] (?:\|[^|]+\| )?(\S+) \(\d+ tests?/u
// `K failed` on a file whose tests ran; `(0 test)` under `❯` / `×` on one that failed to collect,
// which prints no `×` line and no count until the closing ` FAIL ` block.
const FAILED_COUNT = /\| \d+ failed\)|^ [❯×] .*\(0 tests?\)/u
const FAILED_TEST = /^\s+× /u
const FAIL_LINE = /^ FAIL {2}(?:\|[^|]+\| )?(\S+)/u
// A `×` line read before any per-file line: the failure is real though its file is not named yet.
const UNNAMED_FILE = '(file not named yet)'
const NAMES_SHOWN = 5

function failed_header(line: string): string | undefined {
	return FAILED_COUNT.test(line) ? FILE_LINE.exec(line)?.[1] : undefined
}

// The file a line reports failed: a `×` test belongs to the per-file line above it.
function failed_file_of(line: string, current: string): string | undefined {
	if (FAILED_TEST.test(line)) return current

	return FAIL_LINE.exec(line)?.[1] ?? failed_header(line)
}

// Each failed file once, in the order the log first names it.
function failed_files(log: string): Array<string> {
	const files = new Set<string>()
	let current = UNNAMED_FILE

	for (const line of log.split('\n')) {
		current = FILE_LINE.exec(line)?.[1] ?? current
		const failed = failed_file_of(line, current)

		if (failed !== undefined) files.add(failed)
	}

	return [...files]
}

// One line naming the failed files, `undefined` when the log shows none so `pending` reads as before.
function summary_of(log: string): string | undefined {
	const files = failed_files(log)

	if (files.length === 0) return undefined
	const hidden = files.length - NAMES_SHOWN
	const more = hidden > 0 ? `, and ${String(hidden)} more` : ''

	return `failed so far: ${String(files.length)} test file(s) — ${files.slice(0, NAMES_SHOWN).join(', ')}${more} (stop and fix them, or wait for the full run)`
}

const run_wait_failures = { NAMES_SHOWN, UNNAMED_FILE, failed_files, summary_of }

export { run_wait_failures }
