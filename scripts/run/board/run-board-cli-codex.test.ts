import { describe, expect, it } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import { run_board_operation_codex_fixture } from './run-board-operation-codex-fixture'
import { run_board_operation_read } from './run-board-operation-read'

const { AT, ROOT, command } = run_board_operation_codex_fixture
const AT_MS = Date.parse(AT)
const SECOND = 1000
const NONE = { log: undefined, root: undefined }

function local(): typeof run_board_fixture.LOCAL {
	const operations = run_board_operation_read.read(
		{
			lanes: [{ issue: '1', log: '/probe/codex.jsonl', root: ROOT }],
			owner: NONE,
			judgment: NONE,
		},
		() => command('pnpm josh gate'),
	)

	return {
		...run_board_fixture.LOCAL,
		started_ms: AT_MS,
		operations,
		events: [{ pos: 1, at: AT, kind: 'child-launch', text: '#1 codex' }],
	}
}

describe('run:board --once with a Codex operation log', () => {
	it('draws the recorded operation and advancing timer in the complete terminal frame', async () => {
		const { ports, frames, clock } = run_board_fixture.harness(local(), [
			run_board_fixture.plan_titled('codex'),
		])

		clock.now_ms = AT_MS + SECOND
		await run_board_cli.run(['--once'], ports)
		clock.now_ms += SECOND
		await run_board_cli.run(['--once'], ports)

		expect(frames[0]?.split('\n', 3)[2]).toContain('1″  🔧 #1 · Bash pnpm josh gate')
		expect(frames[1]?.split('\n', 3)[2]).toContain('2″  🔧 #1 · Bash pnpm josh gate')
	})
})
