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
		await epic_command.run(['--add', '893', '894', CHAIN, JOIN])

		expect(add_children).toHaveBeenCalledWith(expect.objectContaining({ chains: [[894, 891]] }))
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

	it('names --chain in the --add usage line', async () => {
		await epic_command.run(['--add'])

		expect(printed()).toContain(
			'josh epic --add <E> <N1> <N2> ... [--before <M> | --after <M> | --chain',
		)
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

		await epic_command.run(['--add', QUALIFIED_EPIC, '894', CHAIN, JOIN])

		expect(add_children).toHaveBeenCalledWith(expect.objectContaining({ chains: [[894, 891]] }))
	})
})
