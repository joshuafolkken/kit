import { token_shape_fixture } from '#scripts/lib/token-shape-fixture'
import { describe, expect, it } from 'vitest'
import { run_board_operation } from './run-board-operation'
import { run_board_operation_codex_fixture } from './run-board-operation-codex-fixture'

const { AT, ROOT, command, file } = run_board_operation_codex_fixture
const AT_MS = Date.parse(AT)
const GATE = 'pnpm josh gate'
const TOKEN_HEAD = 8
const EXAMPLE = 'scripts/example.ts'

function latest(tail: string): ReturnType<typeof run_board_operation.latest_of> {
	return run_board_operation.latest_of(tail, ROOT)
}

describe('Codex operation logs', () => {
	it('reads command execution with its recorded time', () => {
		expect(latest(command(GATE))).toStrictEqual({
			kind: 'Bash',
			target: GATE,
			at_ms: AT_MS,
		})
	})

	it('reads file changes relative to the checkout', () => {
		expect(latest(file(`${ROOT}/${EXAMPLE}`))).toStrictEqual({
			kind: 'Edit',
			target: EXAMPLE,
			at_ms: AT_MS,
		})
	})

	it('resolves relative Codex paths from the lane checkout', () => {
		expect(latest(file(EXAMPLE))?.target).toBe(EXAMPLE)
	})

	it('redacts credentials before truncating a command', () => {
		const secret = token_shape_fixture.sample_of('GitHub token')

		expect(latest(command(`curl ${secret}`))?.target).not.toContain(secret.slice(0, TOKEN_HEAD))
	})
})

describe('Codex logs without a usable operation', () => {
	it.each([
		JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'ls' } }),
		command('ls', 'yesterday'),
		'{"type":"item.started","item":',
		JSON.stringify({
			type: 'item.completed',
			timestamp: AT,
			item: { type: 'agent_message', text: 'hi' },
		}),
	])('does not invent an operation or time from %s', (line) => {
		expect(latest(line)).toBeUndefined()
	})

	it('reads past a cut line to the newest complete operation', () => {
		expect(latest(`${command('old').slice(20)}\n${file('/outside/a.ts')}\n{"item":`)).toMatchObject(
			{ kind: 'Edit', target: 'a.ts' },
		)
	})
})
