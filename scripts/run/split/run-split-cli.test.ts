import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_split_cli } from './run-split-cli'

// joshuafolkken/kit#5846, #5895: the arguments `run:split` refuses before anything is written, the verdict
// line a run branches on, and the report a failure leaves for the rerun.

const CHILDREN = '--children'
const ONE_CHILD = ['10', CHILDREN, '11']
const NEEDS_DECISION = 'needs-decision'
const PREREQUISITE = '--prerequisite'
const split = vi.hoisted(() => vi.fn())
const prerequisite = vi.hoisted(() => vi.fn())

vi.mock('./run-split', () => ({ run_split: { split } }))
vi.mock('./run-split-prerequisite', () => ({ run_split_prerequisite: { prerequisite } }))

const infos: Array<string> = []
const errors: Array<string> = []

beforeEach(() => {
	infos.length = 0
	errors.length = 0
	split.mockReset().mockResolvedValue({ kind: 'epic', epic: 20, done: [] })
	prerequisite.mockReset().mockResolvedValue({ kind: 'epic', epic: 20, done: [] })
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		infos.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		errors.push(line)
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_split_cli.run — arguments', () => {
	it.each([
		[['10']],
		[['10', CHILDREN]],
		[['10', CHILDREN, 'x']],
		[['10', CHILDREN, '10']],
		[['10', CHILDREN, '11,11']],
		[[CHILDREN, '11']],
		[['10', '12', CHILDREN, '11']],
	])('refuses %j with the usage and writes nothing', async (argv) => {
		expect(await run_split_cli.run(argv)).toBe(1)
		expect(split).not.toHaveBeenCalled()
		expect(errors).toStrictEqual([run_split_cli.USAGE])
	})

	it('splits `#N` into its children with the order and the title', async () => {
		const argv = ['10', CHILDREN, '11, 12', '--ordered', '--title', 'T']

		expect(await run_split_cli.run(argv)).toBe(0)
		expect(split).toHaveBeenCalledWith({
			issue: '10',
			children: ['11', '12'],
			is_ordered: true,
			title: 'T',
		})
	})

	it('leaves the order off and the title unset when neither is given', async () => {
		await run_split_cli.run(ONE_CHILD)

		expect(split).toHaveBeenCalledWith({
			issue: '10',
			children: ['11'],
			is_ordered: false,
			title: undefined,
		})
	})
})

describe('run_split_cli.USAGE', () => {
	it('names both forms', () => {
		expect(run_split_cli.USAGE).toContain('--children <N1,N2,...>')
		expect(run_split_cli.USAGE).toContain('--prerequisite <P>')
	})
})

describe('run_split_cli.run — `--prerequisite`', () => {
	it.each([
		[['10', PREREQUISITE]],
		[['10', PREREQUISITE, 'x']],
		[['10', PREREQUISITE, '10']],
		[['10', PREREQUISITE, '11', CHILDREN, '12']],
		[['10', PREREQUISITE, '11', '--ordered']],
	])('refuses %j, which no prerequisite form reads, and writes nothing', async (argv) => {
		expect(await run_split_cli.run(argv)).toBe(1)
		expect(prerequisite).not.toHaveBeenCalled()
		expect(split).not.toHaveBeenCalled()
		expect(errors).toStrictEqual([run_split_cli.USAGE])
	})

	it('pauses `#N` on its prerequisite with the title', async () => {
		expect(await run_split_cli.run(['10', PREREQUISITE, '11', '--title', 'T'])).toBe(0)
		expect(prerequisite).toHaveBeenCalledWith({ issue: '10', prerequisite: '11', title: 'T' })
		expect(split).not.toHaveBeenCalled()
		expect(infos.at(-1)).toMatch(/^epic .*#20/u)
	})
})

describe('run_split_cli.run — the verdict', () => {
	it('ends with the epic to continue against', async () => {
		split.mockResolvedValue({ kind: 'epic', epic: 20, done: [{ step: 'audit', detail: 'passed' }] })

		expect(await run_split_cli.run(ONE_CHILD)).toBe(0)
		expect(infos.at(0)).toBe('audit: passed')
		expect(infos.at(-1)).toMatch(/^epic .*#20/u)
	})

	it('ends with `needs-decision` when the split was parked', async () => {
		split.mockResolvedValue({ kind: NEEDS_DECISION, done: [] })

		expect(await run_split_cli.run(ONE_CHILD)).toBe(0)
		expect(infos).toStrictEqual([NEEDS_DECISION])
	})
})

describe('run_split_cli.run — a failure', () => {
	it('names the failed step, what was done, and the rerun that continues', async () => {
		split.mockResolvedValue({
			kind: 'failed',
			step: 'place',
			reason: 'down',
			done: [{ step: 'stash', detail: 'stashed' }],
		})

		expect(await run_split_cli.run(ONE_CHILD)).toBe(1)
		expect(errors).toStrictEqual([
			'✖ place failed: down',
			'Done: stash.',
			'Rerun the same `pnpm josh run:split` to continue from place.',
		])
	})

	it('asks for `--title` instead of the same rerun when the title refusal wrote nothing', async () => {
		split.mockResolvedValue({ kind: 'failed', step: 'title', reason: 'no epic', done: [] })

		expect(await run_split_cli.run(ONE_CHILD)).toBe(1)
		expect(errors).toStrictEqual([
			'✖ title failed: no epic',
			'Done: nothing.',
			'Rerun with `--title <title>`.',
		])
	})
})
