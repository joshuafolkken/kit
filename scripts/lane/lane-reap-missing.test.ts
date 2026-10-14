import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { lane_reap } from './lane-reap'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

// joshuafolkken/kit#3799. A machine without procps read every `ps` probe as "no parent", so the
// ancestry stopped at the caller and `run:step` answered `unknown` with no word of why.

// Only `missing` fails to spawn; every other probe runs and prints nothing.
function arrange_missing(missing: string): void {
	vi.mocked(execFileSync).mockImplementation((command) => {
		if (command !== missing) return ''

		throw Object.assign(new Error(`spawnSync ${missing} ENOENT`), { code: 'ENOENT' })
	})
}

describe('lane_reap — a process tool that is not installed', () => {
	it('refuses the ancestry walk, naming ps', () => {
		arrange_missing('/bin/ps')

		expect(() => lane_reap.own_ancestry()).toThrow('`ps` is not installed')
	})

	it('refuses the child match, naming pgrep', () => {
		arrange_missing('pgrep')

		expect(() => lane_reap.is_child_running('3799')).toThrow('`pgrep` is not installed')
	})

	it('still reads a probe that ran and found nothing as the empty answer', () => {
		vi.mocked(execFileSync).mockImplementation(() => {
			throw Object.assign(new Error('Command failed: pgrep'), { status: 1 })
		})

		expect(lane_reap.own_ancestry()).toEqual(new Set([process.pid]))
	})
})
