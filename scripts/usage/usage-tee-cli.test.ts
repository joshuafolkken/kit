import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'

it('runs the registered entry with stdin and no output', () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), 'usage-tee-cli-'))

	try {
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
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})
