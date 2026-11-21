import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_command } from './epic'

// `josh epic --add … --chain`: the parsed declarations reach the writer, and a refused one stops the
// insertion — on the bare path and on the `owner/repo#N` one — before anything is written.

const add_children = vi.hoisted(() => vi.fn())
const repo_get_name_with_owner = vi.hoisted(() => vi.fn())

vi.mock('./epic-add', () => ({ epic_add: { add_children } }))
vi.mock('#scripts/gh/git-gh-command', () => ({ git_gh_command: { repo_get_name_with_owner } }))

const CHAIN = '--chain'
const JOIN = '#894 -> #891'
const ORDER_REASON = '--order-reason'
const NO_REASON = 'has no `--order-reason'
const JOIN_REASON = [ORDER_REASON, `${JOIN}: #891 reads what #894 writes`]
const FAILURE = 1
const TARGET_REPO = 'someone/other'
const QUALIFIED_EPIC = `${TARGET_REPO}#893`

function printed(): string {
	return vi
		.mocked(console.error)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	add_children.mockReset().mockResolvedValue(0)
	// Not the target's repository, so a cross-repository insertion takes the suggestion path.
	repo_get_name_with_owner.mockReset().mockResolvedValue('someone/here')
})

describe('epic_command.run — --add --chain', () => {
	it('hands the declared chains to the writer', async () => {
		await epic_command.run(['--add', '893', '894', CHAIN, JOIN, ...JOIN_REASON])

		expect(add_children).toHaveBeenCalledWith(expect.objectContaining({ chains: [[894, 891]] }))
	})

	it('refuses a chain without its --order-reason without writing', async () => {
		expect(await epic_command.run(['--add', '893', '894', CHAIN, JOIN])).toBe(FAILURE)
		expect(printed()).toContain(NO_REASON)
		expect(add_children).not.toHaveBeenCalled()
	})

	it('refuses a chain beside --before without writing', async () => {
		const exit_code = await epic_command.run([
			'--add',
			'893',
			'894',
			CHAIN,
			JOIN,
			'--before',
			'891',
		])

		expect(exit_code).toBe(FAILURE)
		expect(add_children).not.toHaveBeenCalled()
	})

	it('names --chain and --order-reason in the --add usage line', async () => {
		await epic_command.run(['--add'])

		expect(printed()).toContain(
			'josh epic --add <E> <N1> <N2> ... [--chain "#A -> #B" ...] [--order-reason "#A -> #B: <reason>" ...]',
		)
	})

	it('names the required --order-reason beside --before / --after in the usage', async () => {
		await epic_command.run(['--add'])

		expect(printed()).toContain('--before <M> | --after <M> --order-reason "<chain>: <reason>"')
	})
})

describe('epic_command.run — --add --before / --after need an --order-reason', () => {
	it.each([
		['--after', '890'],
		['--before', '891'],
	])('refuses %s without its --order-reason, writing nothing', async (flag, target) => {
		expect(await epic_command.run(['--add', '893', '894', flag, target])).toBe(FAILURE)
		expect(printed()).toContain(NO_REASON)
		expect(add_children).not.toHaveBeenCalled()
	})

	it('refuses a reason naming a chain other than the one --after writes', async () => {
		const reason = [ORDER_REASON, `${JOIN}: the wrong chain`]

		expect(await epic_command.run(['--add', '893', '894', '--after', '890', ...reason])).toBe(
			FAILURE,
		)
		expect(printed()).toContain('`--before` or `--after` declared')
		expect(add_children).not.toHaveBeenCalled()
	})

	it.each([
		['--after', '890', '#890 -> #894'],
		['--before', '891', JOIN],
	])('records %s and its reason in the decision', async (flag, target, chain) => {
		const reason = [ORDER_REASON, `${chain}: #894 extends the parser`]

		expect(await epic_command.run(['--add', '893', '894', flag, target, ...reason])).toBe(0)

		const decision = String(add_children.mock.calls[0]?.[0]?.decision)

		expect(decision).toContain(`- Order: \`${chain}\`, declared by \`josh epic --add\``)
		expect(decision).toContain('- Reasoning: #894 extends the parser')
	})

	it.each(['--order-after', '--order-before'])(
		'moves the row with %s without any --order-reason',
		async (flag) => {
			expect(await epic_command.run(['--add', '893', '894', flag, '890'])).toBe(0)
			expect(add_children).toHaveBeenCalledWith(expect.objectContaining({ decision: undefined }))
		},
	)
})

describe('epic_command.run — --add --chain records its reasons', () => {
	const RECORD = '- Reasoning: #891 reads what #894 writes'
	const make_directory = temporary_directory()

	it('folds each chain and its reason into the decision the writer records', async () => {
		await epic_command.run(['--add', '893', '894', CHAIN, JOIN, ...JOIN_REASON])

		const decision = String(add_children.mock.calls[0]?.[0]?.decision)

		expect(decision).toContain('- Order: `#894 -> #891`, declared by `josh epic --add`')
		expect(decision).toContain(RECORD)
	})

	it('writes the --decision-file text first, then the order record', async () => {
		const directory = make_directory('epic-add-reason-')
		const decision_file = path.join(directory, 'why.md')

		writeFileSync(decision_file, 'Placed after the parser work.')
		await epic_command.run([
			'--add',
			'893',
			'894',
			CHAIN,
			JOIN,
			...JOIN_REASON,
			'--decision-file',
			decision_file,
		])

		const decision = String(add_children.mock.calls[0]?.[0]?.decision)

		expect(decision).toMatch(/^Placed after the parser work\.\n\n- Order: /u)
		expect(decision).toContain(RECORD)
	})
})

describe('epic_command.run — --add --chain into owner/repo#N', () => {
	it('refuses a refused chain in another repository, suggesting nothing', async () => {
		const argv = ['--add', QUALIFIED_EPIC, '894', CHAIN, '7999 then 7996']

		expect(await epic_command.run(argv)).toBe(FAILURE)
		expect(printed()).toContain('not a chain line')
		expect(printed()).not.toContain('Run `pnpm josh epic --add')
	})

	it('writes a target naming this repository, chains included', async () => {
		repo_get_name_with_owner.mockResolvedValue(TARGET_REPO)

		await epic_command.run(['--add', QUALIFIED_EPIC, '894', CHAIN, JOIN, ...JOIN_REASON])

		expect(add_children).toHaveBeenCalledWith(expect.objectContaining({ chains: [[894, 891]] }))
	})
})
