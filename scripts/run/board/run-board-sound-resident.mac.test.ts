// #9087: the resident player must exit when its stdin closes. JXA returns NSData.length as a
// string, so a strict `=== 0` never matched end of input and every board leaked one osascript.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { run_board_sound_resident } from './run-board-sound-resident'

const LIVE_TIMEOUT_MS = 10_000

describe('run_board_sound_resident.SCRIPT on macOS', () => {
	it.runIf(process.platform === 'darwin')(
		'reports its latency and exits when stdin closes',
		async () => {
			const child = spawn(
				'osascript',
				['-l', 'JavaScript', '-e', run_board_sound_resident.SCRIPT],
				{
					stdio: ['pipe', 'pipe', 'ignore'],
				},
			)
			const exited = once(child, 'exit')
			const [first] = await once(child.stdout, 'data')

			expect(String(first)).toMatch(/^latency \d/u)

			child.stdin.end()

			const [code] = await exited

			expect(code).toBe(0)
		},
		LIVE_TIMEOUT_MS,
	)
})
