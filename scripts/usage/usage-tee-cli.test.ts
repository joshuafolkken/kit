import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { expect, it } from 'vitest'

const make_directory = temporary_directory()

it('runs the registered entry with stdin and no output', () => {
	const directory = make_directory('usage-tee-cli-')
	const result = spawnSync(
		process.execPath,
		['--import', 'tsx', path.join(import.meta.dirname, 'usage-tee-cli.ts')],
		{
			input: '{"rate_limits":{"five_hour":{"used_percentage":0,"resets_at":0}}}',
			env: { ...process.env, CLAUDE_CONFIG_DIR: directory },
			encoding: 'utf8',
		},
	)
	const state: unknown = JSON.parse(
		readFileSync(path.join(directory, 'josh', 'usage.json'), 'utf8'),
	)

	expect(result.status).toBe(0)
	expect(result.stdout).toBe('')
	expect(result.stderr).toBe('')
	expect(state).toMatchObject({ five_hour: { used_percentage: 0, resets_at: 0 } })
})
