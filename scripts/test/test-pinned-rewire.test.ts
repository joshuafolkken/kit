import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import type { Hunk } from './test-pinned-logic'
import { test_pinned_rewire } from './test-pinned-rewire'

// joshuafolkken/kit#5235: the shape of joshuafolkken/kit#5202's `core-wait-record.ts` — an import moved
// to `lane-ledger-write` and its call renamed — is not probed, while a hunk that changes more is.

const OLD_IMPORT = "import { lane_ledger, type CoreWaitRecord } from '#scripts/lane/lane-ledger'"
const NEW_IMPORT = "import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'"
const OLD_CALL = '\tawait lane_ledger.record_core_wait(wait)'
const CONTENT = [
	"import type { CoreWaitRecord } from '#scripts/lane/lane-ledger-schema'",
	NEW_IMPORT,
	'',
	'async function to_ledger(wait: CoreWaitRecord): Promise<void> {',
	'\tawait lane_ledger_write.record_core_wait(wait)',
	'}',
	'',
	'export { to_ledger }',
	'',
].join('\n')
// The same file, its call reading two imported names instead of `wait`.
const LIMITS_CONTENT = CONTENT.replace(
	NEW_IMPORT,
	"import { lane_ledger_write, LIMIT_A, LIMIT_B } from '#scripts/lane/lane-ledger-write'",
).replace('record_core_wait(wait)', 'record_core_wait(LIMIT_B, LIMIT_A)')
const CALL_LINE = 5

function hunk(new_start: number, new_count: number, old_lines: Array<string>, file = 'a.ts'): Hunk {
	return { file, new_start, new_count, old_lines }
}

function is_rewire(probe: Hunk, content = CONTENT): boolean {
	return test_pinned_rewire.is_rewire(ts, content, probe)
}

describe('test_pinned_rewire.is_rewire on a rewire', () => {
	it('skips the hunk that moves the import to another module under a new name', () => {
		expect(is_rewire(hunk(1, 2, [OLD_IMPORT]))).toBe(true)
	})

	it('skips the hunk that renames the call to the moved import', () => {
		expect(is_rewire(hunk(CALL_LINE, 1, [OLD_CALL]))).toBe(true)
	})

	it('skips a hunk that only adds the import a renamed call reads', () => {
		expect(is_rewire(hunk(2, 1, []))).toBe(true)
	})
})

describe('test_pinned_rewire.is_rewire on a hunk that changes more', () => {
	it('keeps a hunk that moves the import but keeps its name', () => {
		const old_lines = [
			"import type { CoreWaitRecord } from '#scripts/lane/lane-ledger'",
			"import { lane_ledger_write } from '#scripts/lane/lane-ledger'",
		]

		expect(is_rewire(hunk(1, 2, old_lines))).toBe(false)
	})

	it('keeps a hunk that renames the call and changes its arguments', () => {
		expect(is_rewire(hunk(CALL_LINE, 1, ['\tawait lane_ledger.record_core_wait(wait, 1)']))).toBe(
			false,
		)
	})

	it('keeps a hunk that renames the call and swaps two imported arguments', () => {
		const old_lines = ['\tawait lane_ledger.record_core_wait(LIMIT_A, LIMIT_B)']

		expect(is_rewire(hunk(CALL_LINE, 1, old_lines), LIMITS_CONTENT)).toBe(false)
	})

	it('keeps a hunk that renames the call and changes an imported argument', () => {
		const old_lines = ['\tawait lane_ledger.record_core_wait(LIMIT_A, LIMIT_A)']

		expect(is_rewire(hunk(CALL_LINE, 1, old_lines), LIMITS_CONTENT)).toBe(false)
	})

	it('keeps a hunk that renames the call and adds a branch', () => {
		const old_lines = ['\tif (wait.ms > 0) await lane_ledger.record_core_wait(wait)']

		expect(is_rewire(hunk(CALL_LINE, 1, old_lines))).toBe(false)
	})

	it('keeps a hunk whose revert reads a global', () => {
		expect(is_rewire(hunk(CALL_LINE, 1, ['\tawait Promise.resolve(wait)']))).toBe(false)
	})

	it('keeps every hunk of a file that is not a script', () => {
		expect(is_rewire(hunk(CALL_LINE, 1, [OLD_CALL], 'a.svelte'))).toBe(false)
	})
})
