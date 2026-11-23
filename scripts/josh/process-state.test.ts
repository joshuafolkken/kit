import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { process_state } from './process-state'

// A pid in the range `ps` accepts whose process has exited and been reaped.
function gone_pid(): number {
	return spawnSync('/usr/bin/true').pid
}

// joshuafolkken/kit#8869: a process `lane:pause` stopped reads as stopped, and a state that cannot be
// read reads as running.

const PID = 4321

function reader(state: string): () => Map<number, string> {
	return () => new Map([[PID, state]])
}

describe('process_state.stopped_pids', () => {
	it.each(['T', 'TN', 'T+'])('names a process in the state %s', (state) => {
		expect(process_state.stopped_pids([PID], reader(state))).toStrictEqual(new Set([PID]))
	})

	it.each(['S', 'SN', 'R+', 'Z'])('leaves out a process in the state %s', (state) => {
		expect(process_state.stopped_pids([PID], reader(state))).toStrictEqual(new Set())
	})

	it('leaves out a process whose state cannot be read', () => {
		expect(process_state.stopped_pids([PID], () => new Map())).toStrictEqual(new Set())
	})
})

describe('process_state.read_states', () => {
	it('reads a running state for this process, past a pid that is gone', () => {
		const gone = gone_pid()
		const states = process_state.read_states([gone, process.pid])

		expect(states.get(process.pid)).toMatch(/^[RS]/u)
		expect(states.has(gone)).toBe(false)
	})

	it('reads nothing for no pid', () => {
		expect(process_state.read_states([])).toStrictEqual(new Map())
	})
})
