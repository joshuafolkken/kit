import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { acceptance_map } from '#scripts/review/acceptance-map'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_tick_cli } from './issue-tick-cli'

const { issue_get_body, issue_edit_body } = vi.hoisted(() => ({
	issue_get_body: vi.fn<(issue: string) => Promise<string | undefined>>(),
	issue_edit_body: vi.fn<(issue: string, body: string) => Promise<string>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_get_body, issue_edit_body },
}))

const BODY = '## 受け入れ条件\n- [ ] First\n- [ ] Second\n'
const FIRST = acceptance_map.criterion_id('First')
const ARGS = ['6233', FIRST]
const NETWORK_FAILURE = 'network failure'

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	issue_get_body.mockResolvedValue(BODY)
	issue_edit_body.mockResolvedValue('https://github.com/o/r/issues/6233')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.resetAllMocks()
})

describe('issue_tick_cli.run', () => {
	it('passes dispatcher arguments through the executable entry', async () => {
		expect(await main_entry_fixture.run_entry('scripts/issue/issue-tick-cli.ts', ARGS)).toBe(0)
		expect(issue_edit_body).toHaveBeenCalledExactlyOnceWith(
			'6233',
			BODY.replace('[ ] First', '[x] First'),
		)
	})
	it('ticks only the selected conditions in one call (ac-a1f32a2f)', async () => {
		expect(await issue_tick_cli.run(ARGS)).toBe(0)
		expect(issue_get_body).toHaveBeenCalledWith('6233')
		expect(issue_edit_body).toHaveBeenCalledExactlyOnceWith(
			'6233',
			BODY.replace('[ ] First', '[x] First'),
		)
	})

	it('does not write on an idempotent repeat', async () => {
		issue_get_body.mockResolvedValue(BODY.replace('[ ] First', '[X] First'))

		expect(await issue_tick_cli.run(ARGS)).toBe(0)
		expect(issue_edit_body).not.toHaveBeenCalled()
	})
})

describe('issue_tick_cli.run refusals', () => {
	it.each(
		[[], ['0', FIRST], ['06233', FIRST], ['6233'], ['6233', FIRST, '--bogus']].map((args) => ({
			args,
		})),
	)('refuses invalid arguments $args without reading GitHub', async ({ args }) => {
		expect(await issue_tick_cli.run(args)).toBe(1)
		expect(issue_get_body).not.toHaveBeenCalled()
	})

	it('refuses a stale condition without writing', async () => {
		expect(await issue_tick_cli.run([...ARGS, 'ac-stale'])).toBe(1)
		expect(issue_edit_body).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ac-stale'))
	})

	it('reports an unreadable body', async () => {
		issue_get_body.mockResolvedValue(undefined)

		expect(await issue_tick_cli.run(ARGS)).toBe(1)
		expect(issue_edit_body).not.toHaveBeenCalled()
	})

	it.each(['read', 'write'])('reports a failed %s', async (operation) => {
		const mock = operation === 'read' ? issue_get_body : issue_edit_body

		mock.mockRejectedValue(new Error(NETWORK_FAILURE))

		expect(await issue_tick_cli.run(ARGS)).toBe(1)
		expect(console.error).toHaveBeenCalledWith(NETWORK_FAILURE)
	})
})
