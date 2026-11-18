import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { test_related_caller } from './test-related-caller'
import { test_related_record, type RunInput, type RunResult } from './test-related-record'

// joshuafolkken/kit#7965: the tree a run started on, how it ended and who started it, on its row.

const ROOT = '/repository'
const CHANGE = 'scripts/own.ts'
const FAILED_TEST = 'scripts/own.test.ts'
const BASE = 'abc123'
const { CALLER_ENVIRONMENT, MANUAL } = test_related_caller

const INPUT: RunInput = {
	scope: { mode: 'related', files: [`${ROOT}/${CHANGE}`], reason: '1 related file(s)' },
	root: ROOT,
	changed: [CHANGE],
	synced: [],
	since_map: [],
}

const TREE = { files: { [CHANGE]: 'digest-1' }, base: BASE }

function record_with(
	input: Partial<RunInput>,
	result: Partial<RunResult>,
): ReturnType<typeof test_related_record.record_of> {
	return test_related_record.record_of(
		{ ...INPUT, ...input },
		{ elapsed_ms: 0, test_files: undefined, ...result },
	)
}

describe('test_related_record.record_of — the tree key', () => {
	it('keys the changed-file map the run started on, beside its base', () => {
		const record = record_with({ tree: TREE }, {})

		expect(record.tree).toMatch(/^[\da-f]+$/u)
		expect(record.base).toBe(BASE)
	})

	it('keys one map alike and a moved file apart', () => {
		const same = record_with({ tree: { ...TREE } }, {}).tree
		const moved = record_with({ tree: { ...TREE, files: { [CHANGE]: 'digest-2' } } }, {}).tree

		expect(record_with({ tree: TREE }, {}).tree).toBe(same)
		expect(moved).not.toBe(same)
	})

	it('writes no key where the run read no tree', () => {
		const record = record_with({}, {})

		expect(record).not.toHaveProperty('tree')
		expect(record).not.toHaveProperty('base')
	})
})

describe('test_related_record.record_of — how the run ended', () => {
	it('writes a green run with its exit code and no failed files', () => {
		const record = record_with({ tree: TREE }, { exit_code: 0, failed: [] })

		expect(record.exit_code).toBe(0)
		expect(record).not.toHaveProperty('failed')
	})

	it('writes a red run with its exit code and the files it failed on', () => {
		const record = record_with({}, { exit_code: 1, failed: [FAILED_TEST] })

		expect(record).toMatchObject({ exit_code: 1, failed: [FAILED_TEST] })
	})

	it('writes no exit code where the run reported none', () => {
		expect(record_with({}, {})).not.toHaveProperty('exit_code')
	})

	it('leaves the test file count out when vitest reported none', () => {
		expect(record_with({}, { test_files: undefined })).not.toHaveProperty('test_files')
	})
})

describe('test_related_record.record_of — who started the run', () => {
	let saved: string | undefined

	beforeEach(() => {
		saved = process.env[CALLER_ENVIRONMENT]
		Reflect.deleteProperty(process.env, CALLER_ENVIRONMENT)
	})

	afterEach(() => {
		if (saved === undefined) Reflect.deleteProperty(process.env, CALLER_ENVIRONMENT)
		else process.env[CALLER_ENVIRONMENT] = saved
	})

	it('writes a run nobody named as manual', () => {
		expect(record_with({}, {}).caller).toBe(MANUAL)
	})

	it('writes the caller its environment names', () => {
		process.env[CALLER_ENVIRONMENT] = 'ship gate'
		expect(record_with({}, {}).caller).toBe('ship gate')
	})
})
