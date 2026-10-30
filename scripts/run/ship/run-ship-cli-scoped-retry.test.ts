import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { metrics_totals } from '#scripts/gate/metrics-totals'
import { scoped_green } from '#scripts/gate/scoped-green'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { review_stamps } from '#scripts/review/review-stamps'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_body_draft } from './run-ship-body-draft'
import { run_ship_cli } from './run-ship-cli'
import { run_ship_conflict_probe } from './run-ship-conflict-probe'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_handover } from './run-ship-handover'
import { run_ship_pre_detach_timed } from './run-ship-pre-detach-timed'
import { run_ship_preflight } from './run-ship-preflight'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_recorded_fixture } from './run-ship-recorded-fixture'
import { run_ship_scoped } from './run-ship-scoped'
import { run_ship_synced_scope } from './run-ship-synced-scope'

// Exercise the CLI and the real scoped pair with isolated, real green records. Only the command
// runner and external ship stages are stubbed; no check writes a record for the surrounding checkout.
const OK = 0
const FAILED = 1
const TITLE = 'Validate review fixes before ship #5472'
const SOURCE = 'scripts/review-fix.test.ts'
const FAILURE = `${SOURCE}:9: too many statements`
const BASE = 'base-a'
const { LINT_SCRIPT, TEST_SCRIPT } = scoped_green
const read_missing = scoped_green.missing_scripts
const current = { directory: '', digest: 'before', is_lint_red: true }
const calls: Array<string> = []

function tree(): GateTree {
	return { files: { [SOURCE]: current.digest }, base: BASE }
}

function sources(): { lint: string; test: string; is_unit_skipped: boolean } {
	return {
		lint: path.join(current.directory, 'lint.json'),
		test: path.join(current.directory, 'test.json'),
		is_unit_skipped: false,
	}
}

async function command(args: ReadonlyArray<string>): Promise<JoshResult> {
	const script = args.join(' ')

	calls.push(script)
	if (script === LINT_SCRIPT && current.is_lint_red) return { code: FAILED, out: FAILURE }
	const stamp =
		script === LINT_SCRIPT ? review_stamps.lint_related_stamp : review_stamps.test_related_stamp
	const target = script === LINT_SCRIPT ? sources().lint : sources().test

	await scoped_green.record_if_green(stamp, { before: tree(), exit_code: OK, target })

	return { code: OK, out: '' }
}

async function preflight(): Promise<JoshResult & { preconditions?: ReadonlyArray<string> }> {
	const result = await run_ship_scoped.scoped_pair()

	return result.code === OK ? result : { ...result, preconditions: ['scoped'] }
}

function stub_scoped(): void {
	vi.spyOn(gate_tree, 'read_gate_tree').mockImplementation(async () => tree())
	vi.spyOn(metrics_totals, 'rerecord').mockResolvedValue(false)
	vi.spyOn(run_ship_synced_scope, 'settle').mockResolvedValue(undefined)
	vi.spyOn(scoped_green, 'missing_scripts').mockImplementation((files, base) => {
		return read_missing(files, base, sources())
	})
	vi.spyOn(josh_command, 'josh_run').mockImplementation(command)
	vi.spyOn(run_ship_preflight, 'stage').mockImplementation(preflight)
}

function stub_ship(): void {
	vi.spyOn(run_ship_body_draft, 'with_draft').mockImplementation(async (args) => args)
	vi.spyOn(run_ship_probe, 'record_target').mockResolvedValue(undefined)
	vi.spyOn(run_ship_probe, 'read_state').mockResolvedValue({
		is_committed: false,
		is_pushed: false,
		is_merged: false,
	})
	vi.spyOn(run_ship_handover, 'watch').mockResolvedValue(async () => false)
	vi.spyOn(run_ship_conflict_probe, 'probe').mockImplementation(async () => {
		calls.push('conflict')

		return undefined
	})
	vi.spyOn(run_ship_pre_detach_timed, 'checks').mockImplementation(async () => {
		calls.push('pinned')

		return { code: OK, out: 'passed' }
	})
	vi.spyOn(run_ship_detach, 'detach').mockImplementation(async () => {
		calls.push('detach')

		return { verdict: 'launched', note: 'supervisor' }
	})
}

beforeEach(() => {
	current.directory = mkdtempSync(path.join(tmpdir(), 'ship-scoped-retry-'))
	current.digest = 'before'
	current.is_lint_red = true
	calls.length = 0
	stub_scoped()
	stub_ship()
})

beforeEach(() => {
	vi.spyOn(lane_ledger_write, 'record_stop').mockResolvedValue()
	vi.spyOn(lane_ledger_write, 'record_stage').mockResolvedValue()
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
	run_ship_recorded_fixture.isolate()
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(current.directory, { recursive: true, force: true })
})

async function ship(): Promise<number> {
	return await run_ship_cli.run([TITLE, '--detach', '--review'])
}

describe('ship command boundary — review fix validation and retry', () => {
	it('returns the lint target and reason before any costly stage, then ships the fixed tree', async () => {
		expect(await ship()).toBe(FAILED)
		expect(calls).toStrictEqual([LINT_SCRIPT])
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining(FAILURE))
		current.is_lint_red = false
		current.digest = 'fixed'

		expect(await ship()).toBe(OK)
		expect(calls).toStrictEqual([
			LINT_SCRIPT,
			LINT_SCRIPT,
			TEST_SCRIPT,
			'conflict',
			'pinned',
			'detach',
		])
	})

	it('reuses successful identical inputs on retry and invalidates them after an edit', async () => {
		current.is_lint_red = false
		vi.mocked(run_ship_pre_detach_timed.checks).mockResolvedValueOnce({
			code: FAILED,
			out: 'pinned probe failed',
			preconditions: ['unpinned'],
		})
		expect(await ship()).toBe(FAILED)
		calls.length = 0

		expect(await ship()).toBe(OK)
		expect(calls).toStrictEqual(['conflict', 'pinned', 'detach'])
		current.digest = 'after'
		calls.length = 0

		expect(await ship()).toBe(OK)
		expect(calls).toStrictEqual([LINT_SCRIPT, TEST_SCRIPT, 'conflict', 'pinned', 'detach'])
	})
})
