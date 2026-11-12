import { randomUUID } from 'node:crypto'
import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { git_command } from '#scripts/git/git-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { file_map_stamp } from '#scripts/josh/file-map-stamp'
import { review_attest } from '#scripts/review/review-attest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { run_ship_review_checkpoint, type NamedPhase } from './run-ship-review-checkpoint'

vi.mock('#scripts/gate/gate-tree', () => ({ gate_tree: { read_gate_tree: vi.fn() } }))
vi.mock('#scripts/git/git-command', () => ({ git_command: { head_commit: vi.fn() } }))
vi.mock('#scripts/review/review-attest', () => ({ review_attest: { check_here: vi.fn() } }))

const ISSUE = randomUUID()
const STAGE = 'one-code'
const NAMES = ['scoped', 'provider', 'gate', 'attest', 'record']
const SOURCE = 'source.ts'
const TREE: GateTree = { base: 'base', files: { [SOURCE]: 'digest' } }
const PASS = { code: 0, out: 'passed' }
const FAIL = { code: 1, out: 'failed' }
const phases = NAMES.map(() => vi.fn(async () => PASS))

async function run(is_stale = false): ReturnType<typeof run_ship_review_checkpoint.run> {
	const named: ReadonlyArray<NamedPhase> = phases.map((phase, index) => [NAMES[index] ?? '', phase])

	return await run_ship_review_checkpoint.run(ISSUE, STAGE, named, is_stale)
}

beforeEach(() => {
	vi.mocked(gate_tree.read_gate_tree).mockResolvedValue(TREE)
	vi.mocked(git_command.head_commit).mockResolvedValue('head')
	vi.mocked(review_attest.check_here).mockResolvedValue({ status: 'ok' })
	for (const phase of phases) phase.mockReset().mockResolvedValue(PASS)
})

afterEach(() => {
	for (const name of NAMES) {
		file_map_stamp.create(`josh-ship-review-step-${ISSUE}-${STAGE}-${name}-`, PROJECT_ROOT).remove()
	}
})

it.each(NAMES)('resumes at failed %s and skips each completed step (ac-fd0b03b2)', async (name) => {
	const stopped = NAMES.indexOf(name)

	phases[stopped]?.mockResolvedValueOnce(FAIL)
	expect(await run()).toStrictEqual(FAIL)
	expect(await run()).toStrictEqual(PASS)

	for (const [index, phase] of phases.entries()) {
		expect(phase).toHaveBeenCalledTimes(index === stopped ? 2 : 1)
	}
})

it('records every step independently and reuses a completed prefix after a thrown interruption (ac-364c0551)', async () => {
	const interrupted = phases.at(-1)

	interrupted?.mockRejectedValueOnce(new Error('interrupted'))
	await expect(run()).rejects.toThrow('interrupted')
	expect(await run()).toStrictEqual(PASS)
	expect(phases.slice(0, -1).every((phase) => phase.mock.calls.length === 1)).toBe(true)
	expect(interrupted).toHaveBeenCalledTimes(2)
})

it.each(['head', 'base', 'files', 'stale'])(
	'runs all steps again after %s changes (ac-6d8e0972)',
	async (change) => {
		await run()
		const trees: Record<string, GateTree> = {
			base: { ...TREE, base: 'new base' },
			files: { ...TREE, files: { added: 'edit' } },
		}

		vi.mocked(git_command.head_commit).mockResolvedValue(change === 'head' ? 'new head' : 'head')
		vi.mocked(gate_tree.read_gate_tree).mockResolvedValue(trees[change] ?? TREE)
		await run(change === 'stale')
		for (const phase of phases) expect(phase).toHaveBeenCalledTimes(2)
	},
)

it.each<GateTree>([
	{ ...TREE, base: undefined },
	{ ...TREE, files: {} },
])('never reuses an unknown tree: %j', async (tree) => {
	await run()
	vi.mocked(gate_tree.read_gate_tree).mockResolvedValue(tree)
	await run()
	for (const phase of phases) expect(phase).toHaveBeenCalledTimes(2)
	vi.mocked(gate_tree.read_gate_tree).mockResolvedValue(TREE)
	await run()
	for (const phase of phases) expect(phase).toHaveBeenCalledTimes(3)
})

it('invalidates later attestations before retrying an unfinished provider', async () => {
	await run()
	file_map_stamp.create(`josh-ship-review-step-${ISSUE}-${STAGE}-provider-`, PROJECT_ROOT).remove()
	phases[1]?.mockResolvedValueOnce(FAIL)
	expect(await run()).toStrictEqual(FAIL)
	await run()
	expect(phases[0]).toHaveBeenCalledOnce()
	expect(phases[1]).toHaveBeenCalledTimes(3)
	for (const phase of phases.slice(2)) expect(phase).toHaveBeenCalledTimes(2)
})

it('does not bless edits made while a step runs', async () => {
	phases[0]?.mockImplementationOnce(async () => {
		vi.mocked(gate_tree.read_gate_tree).mockResolvedValue({ ...TREE, files: { changed: 'edit' } })

		return PASS
	})
	await run()
	await run()
	for (const phase of phases) expect(phase).toHaveBeenCalledTimes(2)
})

it.each(['missing', 'mismatch'] as const)(
	'restarts the provider after an attestation is %s',
	async (status) => {
		phases[3]?.mockResolvedValueOnce(FAIL)
		expect(await run()).toStrictEqual(FAIL)
		vi.mocked(review_attest.check_here).mockResolvedValue({ status })
		expect(await run()).toStrictEqual(PASS)
		expect(phases[0]).toHaveBeenCalledOnce()
		const restarted = phases.slice(1, -1)

		for (const phase of restarted) expect(phase).toHaveBeenCalledTimes(2)
		expect(phases.at(-1)).toHaveBeenCalledOnce()
	},
)
