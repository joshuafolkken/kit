import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gate_test_fixture } from '#scripts/gate/gate-test-fixture'
import { scoped_green } from '#scripts/gate/scoped-green'
import { pre_push_related_switch } from '#scripts/hooks/pre-push-related-switch'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { review_stamps } from '#scripts/review/review-stamps'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#5067: `josh ship` pushes its sync merge ahead of the gate, whose whole suite runs
// over the same tree next, so that push asks for the related tests instead.
//
// joshuafolkken/kit#6121: `josh ship`'s push after a round-2 fix re-ran the related tests the scoped
// pair had just passed on the same tree, because the gate's record was still on the tree before the
// fix. The related run now reads `test:related`'s own record first.

interface Repo {
	tree: Record<string, string>
	status: string
}

const repository = vi.hoisted((): Repo => ({ tree: {}, status: '' }))

vi.mock('#scripts/review/review-tree', () => ({
	review_tree: { read_changed_tree: async (): Promise<Record<string, string>> => repository.tree },
}))

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		change_base_commit: async (): Promise<string> => 'a1b2c3d4',
		status: async (): Promise<string> => repository.status,
	},
}))

const run_guarded_unit = vi.hoisted(() => vi.fn(async (): Promise<number> => 0))

vi.mock('#scripts/test/test-unit-guard', () => ({ test_unit_guard: { run_guarded_unit } }))

const run_related_tests = vi.hoisted(() => vi.fn(async (): Promise<number> => 0))

vi.mock('#scripts/test/test-related', () => ({ test_related: { run_related_tests } }))

const { pre_push_unit } = await import('./pre-push-unit')

const BASE = 'a1b2c3d4'
const CHANGED_PATH = 'scripts/rules/protected-files.ts'
const CHANGED_TREE: Record<string, string> = { [CHANGED_PATH]: 'digest-one' }
const MOVED_TREE: Record<string, string> = { [CHANGED_PATH]: 'digest-two' }
const RELATED_LINE = 'running the related unit tests'
const GATE_PATH = path.join(tmpdir(), `josh-pre-push-scoped-gate-${String(process.pid)}.json`)
const TEST_PATH = path.join(tmpdir(), `josh-pre-push-scoped-test-${String(process.pid)}.json`)
const SCOPED = { test: TEST_PATH, is_unit_skipped: false }

const record_push_miss = vi.spyOn(lane_ledger_write, 'record_push_miss')

async function run_hook(): Promise<[number, string]> {
	const stdout = gate_test_fixture.capture_stdout()

	try {
		const code = await pre_push_unit.run_pre_push_unit([], GATE_PATH, SCOPED)

		return [code, stdout.text()]
	} finally {
		stdout.restore()
	}
}

function clean_up(): void {
	rmSync(GATE_PATH, { force: true })
	rmSync(TEST_PATH, { force: true })
}

beforeEach(() => {
	record_push_miss.mockResolvedValue()
	clean_up()
	repository.tree = CHANGED_TREE
	repository.status = ''
	vi.stubEnv(pre_push_unit.FORCE_ENV, '')
	vi.stubEnv(scoped_green.SWITCH_ENV_KEY, '')
	vi.stubEnv(pre_push_related_switch.SWITCH_ENV_KEY, pre_push_related_switch.SWITCH_ON)
})

afterEach(() => {
	clean_up()
	vi.unstubAllEnvs()
})

describe('a push ahead of its gate runs the related tests', () => {
	it('runs the related tests, not the whole suite, when no record covers the push', async () => {
		const [code, text] = await run_hook()

		expect(code).toBe(0)
		expect(run_related_tests).toHaveBeenCalledWith([])
		expect(run_guarded_unit).not.toHaveBeenCalled()
		expect(text).toContain(RELATED_LINE)
		expect(record_push_miss).toHaveBeenCalledWith({ scope: 'related', reason: 'no-record' })
	})

	it('still reuses a gate record that covers the push', async () => {
		review_stamps.gate_stamp.write(CHANGED_TREE, GATE_PATH, BASE)

		await run_hook()

		expect(run_related_tests).not.toHaveBeenCalled()
	})

	it('runs the whole suite when the escape hatch is set too', async () => {
		review_stamps.test_related_stamp.write(CHANGED_TREE, TEST_PATH, BASE)
		vi.stubEnv(pre_push_unit.FORCE_ENV, '1')

		await run_hook()

		expect(run_related_tests).not.toHaveBeenCalled()
		expect(run_guarded_unit).toHaveBeenCalledTimes(1)
	})
})

describe('a push ahead of its gate with test:related green on the pushed tree', () => {
	it('reuses that record instead of re-running the related tests', async () => {
		review_stamps.test_related_stamp.write(CHANGED_TREE, TEST_PATH, BASE)

		const [code, text] = await run_hook()

		expect(code).toBe(0)
		expect(run_related_tests).not.toHaveBeenCalled()
		expect(text).not.toContain(RELATED_LINE)
		expect(text).toContain('the related unit tests already passed on this tree')
		expect(record_push_miss).not.toHaveBeenCalled()
	})

	it('re-runs them when the record describes another tree', async () => {
		review_stamps.test_related_stamp.write(MOVED_TREE, TEST_PATH, BASE)

		const [, text] = await run_hook()

		expect(run_related_tests).toHaveBeenCalledWith([])
		expect(text).toContain(RELATED_LINE)
		expect(record_push_miss).toHaveBeenCalledWith({ scope: 'related', reason: 'no-record' })
	})

	it('re-runs them when the record was written on another base', async () => {
		review_stamps.test_related_stamp.write(CHANGED_TREE, TEST_PATH, 'e5f6a7b8')

		await run_hook()

		expect(run_related_tests).toHaveBeenCalledWith([])
	})

	it('re-runs them when the push does not carry the working tree', async () => {
		review_stamps.test_related_stamp.write(CHANGED_TREE, TEST_PATH, BASE)
		repository.status = ` M ${CHANGED_PATH}`

		await run_hook()

		expect(run_related_tests).toHaveBeenCalledWith([])
	})

	it('runs the whole suite, not the record, without the related switch', async () => {
		review_stamps.test_related_stamp.write(CHANGED_TREE, TEST_PATH, BASE)
		vi.stubEnv(pre_push_related_switch.SWITCH_ENV_KEY, '')

		await run_hook()

		expect(run_guarded_unit).toHaveBeenCalledTimes(1)
	})
})
