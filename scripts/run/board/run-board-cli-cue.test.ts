import { describe, expect, it } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import type { GatherRead } from './run-board-gather'
import type { CueName } from './run-board-sound-cues'
import { run_board_sound_player } from './run-board-sound-player'
import type { BoardPorts } from './run-board-state'

// joshuafolkken/kit#7951: the live board alone sounds a lane's launch; a single frame — `--once`,
// `--chat`, `--every` — stays silent.

const { LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const LAUNCH = { pos: 1, at: '2026-10-08T08:00:00.000Z', kind: 'child-launch', text: '#1 a' }
// Enough waits for a few live frames, their spinners turned between them.
const SLEEPS = 40
// The reads before the launch: the plan arrives on one of them, and a frame before it sounds nothing.
const QUIET_READS = 3

// Ports whose first reads find no lane and every later one finds lane 1 launched, each cue recorded;
// the live board stops once its waits run out. The harness's read is taken once — its own reads stop
// on their second wait.
function launching(cues: Array<CueName>): BoardPorts {
	const { ports, clock } = harness({ ...LOCAL, events: [LAUNCH] }, [plan_titled('a')])
	let launched: Promise<GatherRead> | undefined = undefined
	let reads = 0
	let sleeps = 0

	return {
		...ports,
		gather: async (pace) => {
			reads += 1
			const is_quiet = reads <= QUIET_READS

			launched ??= ports.gather(pace)
			const read = await launched

			return is_quiet ? { ...read, local: LOCAL } : read
		},
		sleep: async (ms) => {
			sleeps += 1
			if (sleeps > SLEEPS) throw STOPPED
			clock.now_ms += ms
			await Promise.resolve()
		},
		cue: (name) => {
			cues.push(name)
		},
	}
}

// Waits out a run that may end on the ports' stop.
async function settle(run: Promise<number>): Promise<void> {
	try {
		await run
	} catch {
		// The stop that ends `--every`'s loop.
	}
}

describe('run_board_cli.run cue', () => {
	it('sounds the launch once on the live board', async () => {
		const cues: Array<CueName> = []

		await expect(run_board_cli.run([], launching(cues))).rejects.toBe(STOPPED)
		expect(cues).toStrictEqual(['launch'])
	})

	it.each([[['--once']], [['--chat']], [['--every', '1']]])(
		'sounds nothing for %j',
		async (argv) => {
			const cues: Array<CueName> = []
			const ports = launching(cues)

			await settle(run_board_cli.run(argv, ports))
			await settle(run_board_cli.run(argv, ports))
			expect(cues).toStrictEqual([])
		},
	)
})

describe('run_board_cli.live_ports cue', () => {
	it('passes the sound player to the live board alone', () => {
		expect(run_board_cli.live_ports(true).cue).toBe(run_board_sound_player.play_cue)
		expect(run_board_cli.live_ports(false).cue).toBeUndefined()
	})
})
