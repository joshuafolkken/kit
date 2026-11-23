import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_command } from './epic'

// joshuafolkken/kit#5846: `run:split` creates its epic through `epic_command.create`, which answers
// what happened rather than an exit code — a refusal apart from a created epic and its number.

const refusal_of = vi.hoisted(() => vi.fn())
const create_epic_number = vi.hoisted(() => vi.fn())
const promote_epic = vi.hoisted(() => vi.fn())

vi.mock('./epic-split-reach', () => ({ epic_split_reach: { refusal_of } }))
vi.mock('./epic-run', () => ({ epic_run: { create_epic_number, promote_epic } }))
vi.mock('./epic-notify', () => ({
	epic_notify: { announce: async () => undefined, promoted_number: () => undefined },
}))

const TITLE = 'Split work'
const ARGV = [TITLE, '10', '11']
const CHAIN = '--chain'
const REASON = '--order-reason'
const TEN_TO_ELEVEN = '#10 -> #11'
const WHY_SPLIT = 'Each part merges alone and the whole is over the guide.'
const RATIONALE_DIRECTORY = temporary_directory('suite')('josh-epic-rationale-')
const RATIONALE_PATH = path.join(RATIONALE_DIRECTORY, 'rationale.md')
const BLANK_PATH = path.join(RATIONALE_DIRECTORY, 'blank.md')
const RATIONALE_FLAG = '--rationale-file'
const WITH_RATIONALE = [RATIONALE_FLAG, RATIONALE_PATH]
const WITH_BLANK = [RATIONALE_FLAG, BLANK_PATH]

writeFileSync(RATIONALE_PATH, WHY_SPLIT)
writeFileSync(BLANK_PATH, ' \n\t\n')

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	refusal_of.mockReset().mockResolvedValue(undefined)
	create_epic_number.mockReset().mockResolvedValue(30)
	promote_epic.mockReset().mockResolvedValue(0)
})

describe('epic_command.create', () => {
	it('answers the created epic and its number', async () => {
		expect(await epic_command.create(ARGV)).toStrictEqual({ kind: 'created', epic: 30 })
	})

	it('refuses without a child, creating nothing', async () => {
		expect(await epic_command.create([TITLE])).toStrictEqual({ kind: 'refused' })
		expect(create_epic_number).not.toHaveBeenCalled()
	})

	it('refuses a split whose children the reach check strands, creating nothing', async () => {
		refusal_of.mockResolvedValue('✖ stranded')

		expect(await epic_command.create(ARGV)).toStrictEqual({ kind: 'refused' })
		expect(create_epic_number).not.toHaveBeenCalled()
	})

	it('answers 1 from `run` on a refusal', async () => {
		expect(await epic_command.run([TITLE])).toBe(1)
	})

	// `run:split` passes no rationale; only the `josh epic` command requires one.
	it('creates without a rationale when called directly', async () => {
		expect(await epic_command.create(ARGV)).toStrictEqual({ kind: 'created', epic: 30 })
		expect(create_epic_number).toHaveBeenCalledWith(expect.objectContaining({ rationale: '' }))
	})
})

// joshuafolkken/kit#8798: an epic filed without a reason kept the template placeholder.
describe('epic_command.run — the split rationale', () => {
	const PROMOTE = ['--promote', '9', '10', '11']

	it.each([
		['creation without --rationale-file', ARGV],
		['creation with a blank rationale', [...ARGV, ...WITH_BLANK]],
		['promotion without --rationale-file', PROMOTE],
		['promotion with a blank rationale', [...PROMOTE, ...WITH_BLANK]],
	])('refuses a %s with 1, writing nothing', async (_name, argv) => {
		expect(await epic_command.run(argv)).toBe(1)

		expect(create_epic_number).not.toHaveBeenCalled()
		expect(promote_epic).not.toHaveBeenCalled()
		expect(vi.mocked(console.error)).toHaveBeenCalledWith(
			expect.stringContaining('A split rationale is required'),
		)
		expect(vi.mocked(console.error)).toHaveBeenCalledWith(
			expect.stringContaining('--rationale-file .josh/tmp/<dir>/rationale.md'),
		)
	})

	it('creates with the rationale read from the file', async () => {
		expect(await epic_command.run([...ARGV, ...WITH_RATIONALE])).toBe(0)

		expect(create_epic_number).toHaveBeenCalledWith(
			expect.objectContaining({ rationale: WHY_SPLIT }),
		)
	})

	it('promotes with the rationale read from the file', async () => {
		expect(await epic_command.run([...PROMOTE, ...WITH_RATIONALE])).toBe(0)

		expect(promote_epic).toHaveBeenCalledWith(expect.objectContaining({ rationale: WHY_SPLIT }))
	})
})

describe('epic_command.create — --chain', () => {
	it('passes the declared --chain lines to the creation', async () => {
		const joins = ['#10 -> #12', '#11 -> #12']
		const reasons = joins.flatMap((join) => [REASON, `${join}: 別の待ちがある — a reason`])

		await epic_command.create([
			...ARGV,
			'12',
			...joins.flatMap((join) => [CHAIN, join]),
			...reasons,
		])

		expect(create_epic_number).toHaveBeenCalledWith(
			expect.objectContaining({
				chains: [
					[10, 12],
					[11, 12],
				],
			}),
		)
	})

	it('refuses a cyclic --chain before the reach check, creating nothing', async () => {
		const cyclic = [...ARGV, CHAIN, TEN_TO_ELEVEN, CHAIN, '#11 -> #10']

		expect(await epic_command.create(cyclic)).toStrictEqual({ kind: 'refused' })
		expect(refusal_of).not.toHaveBeenCalled()
		expect(create_epic_number).not.toHaveBeenCalled()
	})

	it('names --chain in the usage it prints on a refusal', async () => {
		await epic_command.create([TITLE])

		expect(vi.mocked(console.error)).toHaveBeenCalledWith(
			expect.stringContaining('--chain "#A -> #B"'),
		)
	})
})

describe('epic_command.run — --promote with --chain', () => {
	const PROMOTE = ['--promote', '9', '10', '11', ...WITH_RATIONALE]

	it('passes the declared --chain lines to the promotion', async () => {
		const reason = [REASON, `${TEN_TO_ELEVEN}: 別の待ちがある — #11 reads #10`]

		expect(await epic_command.run([...PROMOTE, CHAIN, TEN_TO_ELEVEN, ...reason])).toBe(0)

		expect(promote_epic).toHaveBeenCalledWith(expect.objectContaining({ chains: [[10, 11]] }))
	})

	it('refuses a --chain naming a non-child before the reach check, promoting nothing', async () => {
		expect(await epic_command.run([...PROMOTE, CHAIN, '#10 -> #7'])).toBe(1)

		expect(refusal_of).not.toHaveBeenCalled()
		expect(promote_epic).not.toHaveBeenCalled()
	})
})

describe('epic_command — --order-reason', () => {
	const WHY = '別の待ちがある — #11 reads what #10 writes'
	const REASONS = [{ chain: [10, 11], reason: WHY }]
	const REASON_ARGS = [CHAIN, TEN_TO_ELEVEN, REASON, `${TEN_TO_ELEVEN}: ${WHY}`]

	it('passes the per-chain reasons to the creation', async () => {
		await epic_command.create([...ARGV, ...REASON_ARGS])

		expect(create_epic_number).toHaveBeenCalledWith(
			expect.objectContaining({ order_reasons: REASONS }),
		)
	})

	it('passes the per-chain reasons to the promotion', async () => {
		expect(
			await epic_command.run(['--promote', '9', '10', '11', ...REASON_ARGS, ...WITH_RATIONALE]),
		).toBe(0)

		expect(promote_epic).toHaveBeenCalledWith(expect.objectContaining({ order_reasons: REASONS }))
	})

	it('refuses a declared chain without its reason before the reach check, creating nothing', async () => {
		expect(await epic_command.create([...ARGV, CHAIN, TEN_TO_ELEVEN])).toStrictEqual({
			kind: 'refused',
		})
		expect(refusal_of).not.toHaveBeenCalled()
		expect(create_epic_number).not.toHaveBeenCalled()
	})

	it('names --order-reason in the usage it prints on a refusal', async () => {
		await epic_command.create([TITLE])

		expect(vi.mocked(console.error)).toHaveBeenCalledWith(
			expect.stringContaining('--order-reason "#A -> #B: <reason>"'),
		)
	})
})
