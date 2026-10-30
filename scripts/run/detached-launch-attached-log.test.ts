import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_event } from '#scripts/agent/agent-event'
import { json_value } from '#scripts/lib/json-value'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { run_board_operation } from './board/run-board-operation'
import { detached_launch } from './detached-launch'

const directories: Array<string> = []
const STAMP_SCHEMA = z.object({ timestamp: z.string() })
const SOURCE = `
process.stdout.write('{"type":"item.started","item":');
setTimeout(() => {
  process.stdout.write('{"type":"command_execution","command":"pwd"}}\\n');
  process.stderr.write('diagnostic\\n');
  process.stdout.write('{"type":"turn.completed"}');
}, 10);
`

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

async function recorded(): Promise<{ output: string; before: number; after: number }> {
	const directory = mkdtempSync(path.join(tmpdir(), 'attached-log-'))
	const log_path = path.join(directory, 'output.log')
	const errors: Array<string> = []

	directories.push(directory)
	const before = Date.now()
	const result = await detached_launch.launch_attached(
		{
			argv: { command: process.execPath, args: ['-e', SOURCE.replaceAll('\n', '')] },
			cwd: directory,
			log_path,
		},
		(note) => {
			errors.push(note)
		},
	)

	expect(result).toMatchObject({ kind: 'completed', exit_code: 0 })
	expect(errors).toStrictEqual([])

	return { output: readFileSync(log_path, 'utf8'), before, after: Date.now() }
}

describe('attached process recording', () => {
	it('stamps complete events, drains the last line and preserves progress consumers', async () => {
		const { output, before, after } = await recorded()
		const operation = run_board_operation.latest_of(output)

		expect(output).toContain('diagnostic')
		expect(operation).toMatchObject({ kind: 'Bash', target: 'pwd' })
		expect(operation?.at_ms).toBeGreaterThanOrEqual(before)
		expect(operation?.at_ms).toBeLessThanOrEqual(after)
		expect(agent_event.read(output)).toMatchObject({ provider: 'openai', result: 'completed' })
		const last = STAMP_SCHEMA.parse(
			json_value.parse_or_undefined(output.trim().split('\n').at(-1) ?? ''),
		)

		expect(Date.parse(last.timestamp)).toBeGreaterThanOrEqual(before)
	})
})
