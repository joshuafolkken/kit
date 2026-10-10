import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const missing_mock = vi.hoisted(() => vi.fn<() => Array<string>>())
const reusable_mock = vi.hoisted(() => vi.fn<() => object | undefined>())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/gate/gate-tree', () => ({
	gate_tree: { read_gate_tree: vi.fn(async () => ({ files: {}, base: 'base' })) },
}))
vi.mock('#scripts/gate/scoped-green', () => ({ scoped_green: { missing_scripts: missing_mock } }))
vi.mock('#scripts/gate/gate-skip', () => ({ gate_skip: { reusable_green_gate: reusable_mock } }))

const { run_ship_scoped } = await import('./run-ship-scoped')

// joshuafolkken/kit#2946: the scoped pair the preflight, the review rounds and the gate stage all meet
// rather than stop on — only the checks with no green record for this tree run.

const OK = 0
const LINT = 'lint:related'
const TEST = 'test:related'
const FAILED = 1

function commands(): ReadonlyArray<string> {
	return josh_run_mock.mock.calls.map((call) => (call[0] as ReadonlyArray<string>).join(' '))
}

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	missing_mock.mockReset().mockReturnValue([])
})

describe('run_ship_scoped.scoped_pair', () => {
	it('runs nothing when both checks are already green on this tree', async () => {
		expect(await run_ship_scoped.scoped_pair()).toStrictEqual({ code: OK, out: '' })
		expect(commands()).toStrictEqual([])
	})

	it('runs only the checks not yet green, then passes', async () => {
		missing_mock.mockReturnValue([LINT, TEST])

		expect(await run_ship_scoped.scoped_pair()).toStrictEqual({ code: OK, out: '' })
		expect(commands()).toStrictEqual([LINT, TEST])
	})

	it('stops at the first red check', async () => {
		missing_mock.mockReturnValue([LINT, TEST])
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'lint red' })

		expect(await run_ship_scoped.scoped_pair()).toStrictEqual({ code: FAILED, out: 'lint red' })
		expect(commands()).toStrictEqual([LINT])
	})
})

describe('run_ship_scoped.scoped_gate', () => {
	it('runs the missing scoped checks and then josh gate, forwarding stderr', async () => {
		missing_mock.mockReturnValue([LINT])

		expect(await run_ship_scoped.scoped_gate()).toStrictEqual({ code: OK, out: '' })
		expect(commands()).toStrictEqual([LINT, 'gate'])
		expect(josh_run_mock).toHaveBeenLastCalledWith(['gate'], true)
	})

	it('stops before josh gate when the scoped pair fails', async () => {
		missing_mock.mockReturnValue([LINT])
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'lint red' })

		expect(await run_ship_scoped.scoped_gate()).toStrictEqual({ code: FAILED, out: 'lint red' })
		expect(commands()).toStrictEqual([LINT])
	})
})

// joshuafolkken/kit#3643: the gate's own reuse test decides whether a gate stage only reused a record.
describe('run_ship_scoped.is_gate_green', () => {
	it('is green when the gate holds a reusable record for this tree', async () => {
		reusable_mock.mockReturnValue({})

		expect(await run_ship_scoped.is_gate_green()).toBe(true)
		expect(reusable_mock).toHaveBeenCalledWith({}, 'base')
	})

	it('is not green when no record matches the tree', async () => {
		reusable_mock.mockReturnValue(undefined)

		expect(await run_ship_scoped.is_gate_green()).toBe(false)
	})
})
