import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { lane_reap } from './lane-reap'

// joshuafolkken/kit#4198: a paused lane holds a SIGTERM it handles pending until it is continued, so
// closing or restarting it left the tree stopped for good. A real process, since the pending signal is
// the kernel's behavior, not the reaper's.

const LANE = { issue: '4198', directory: '/w/.kit-lanes/4198' }
const HANDLES_TERM =
	'process.on("SIGTERM", () => process.exit(0)); console.log("ready"); setInterval(() => {}, 1000)'

function pid_of(child: ChildProcess): number {
	if (child.pid === undefined) throw new Error('the child did not start')

	return child.pid
}

async function exit_code_of(child: ChildProcess): Promise<number | undefined> {
	return await new Promise((resolve) => {
		child.once('exit', (code) => {
			resolve(code ?? undefined)
		})
	})
}

async function stopped_child(): Promise<ChildProcess> {
	const child = spawn(process.execPath, ['-e', HANDLES_TERM], {
		stdio: ['ignore', 'pipe', 'ignore'],
	})

	await once(child.stdout, 'data')
	process.kill(pid_of(child), 'SIGSTOP')

	return child
}

describe('lane_reap.reap_child — a paused lane', () => {
	it('ends a stopped process that handles SIGTERM', async () => {
		const child = await stopped_child()
		const pid = pid_of(child)
		const exited = exit_code_of(child)
		const probes = {
			...lane_reap.SYSTEM_PROBES,
			matching: () => [pid],
			parent_of: () => undefined,
		}

		expect(lane_reap.reap_child(LANE, { ...probes, children_of: () => [] })).toStrictEqual([pid])
		await expect(exited).resolves.toBe(0)
	})
})
