import { describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather, type GatherRead } from './run-board-gather'
import {
	run_board_gather_thread,
	type GatherPost,
	type GatherWorker,
	type Handed,
} from './run-board-gather-thread'
import type { LocalRead } from './run-board-read'
import type { CueName } from './run-board-sound-cues'
import { run_board_sound_player } from './run-board-sound-player'
import { run_board_sound_typing } from './run-board-sound-typing'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_theme_defs } from './run-board-theme-defs'

// joshuafolkken/kit#7951: the live board alone sounds a lane's launch; a single frame — `--once`,
// `--chat`, `--every` — stays silent.

const { FIRST_ROUND, LOCAL, START, STOPPED, harness, plan_titled } = run_board_fixture
const { THEME_DEFS } = run_board_theme_defs
const LAUNCH = { pos: 1, at: '2026-10-08T08:00:00.000Z', kind: 'child-launch', text: '#1 a' }
// Enough waits for a few live frames, their spinners turned and their clocks' colons blinked between
// them (joshuafolkken/kit#8476).
const SLEEPS = 60
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

// joshuafolkken/kit#7953: a keyboard whose store keeps the sound off silences the live board's cues,
// and `s` typed at once switches it on, playing launch then and every cue after.
function silenced(cues: Array<CueName>, typed: string): BoardPorts {
	const ports = launching(cues)

	return {
		...ports,
		keys: {
			is_tty: true,
			raw: () => undefined,
			listen: (on_data) => {
				on_data(typed)
			},
			close: () => undefined,
			interrupt: () => undefined,
			store: {
				load: () => new Set(),
				save: () => undefined,
				load_sound: () => false,
				save_sound: () => undefined,
			},
		},
	}
}

describe('run_board_cli.run sound switch', () => {
	it('sounds nothing on the live board while the sound is off', async () => {
		const cues: Array<CueName> = []

		await expect(run_board_cli.run([], silenced(cues, ''))).rejects.toBe(STOPPED)
		expect(cues).toStrictEqual([])
	})

	it('plays launch as s switches the sound on, then the launch the board sees', async () => {
		const cues: Array<CueName> = []

		await expect(run_board_cli.run([], silenced(cues, 's'))).rejects.toBe(STOPPED)
		expect(cues).toStrictEqual(['launch', 'launch'])
	})
})

// joshuafolkken/kit#8160: the worker decides the cue over its own read of the run and hands it over on
// the frame; the board plays it through its switch, once.
function worker_post(local: LocalRead, board: BoardState, now_ms: number): Handed {
	const read = { ...run_board_gather.FRESH_GATHER, local, read_ms: now_ms }
	const data = { ...FIRST_ROUND.data, ...run_board_gather.read_of(read), plan: plan_titled('a') }

	return run_board_gather_thread.post_of(board, read, data, now_ms)
}

// The frame the worker hands over once lane 1 launches after a quiet frame.
function launched_post(): GatherPost {
	const quiet = worker_post(LOCAL, FIRST_ROUND.board, START)

	return worker_post({ ...LOCAL, events: [LAUNCH] }, quiet.board, START + QUIET_READS).post
}

// The live board over a worker that hands the launch's frame over once, its sound switch as `typed`
// leaves it.
function worker_launching(cues: Array<CueName>, typed: string): BoardPorts {
	const ports = silenced(cues, typed)
	const post = launched_post()
	const worker: GatherWorker = {
		on: (event, listener) => {
			if (event === 'message') listener(post)
		},
		unref: () => undefined,
	}

	return { ...ports, gather: run_board_gather_thread.worker_gatherer(() => worker, ports.now) }
}

describe('run_board_cli.run cue the worker decided', () => {
	it('hands the launch over on the worker’s frame', () => {
		expect(launched_post().display?.cue).toBe('launch')
	})

	it('sounds nothing while the sound is off', async () => {
		const cues: Array<CueName> = []

		await expect(run_board_cli.run([], worker_launching(cues, ''))).rejects.toBe(STOPPED)
		expect(cues).toStrictEqual([])
	})

	it('plays the launch once over every redraw of its frame once s switches the sound on', async () => {
		const cues: Array<CueName> = []

		await expect(run_board_cli.run([], worker_launching(cues, 's'))).rejects.toBe(STOPPED)
		expect(cues).toStrictEqual(['launch', 'launch'])
	})
})

describe('run_board_cli.live_ports cue', () => {
	it('passes the sound player to the live board alone', () => {
		expect(run_board_cli.live_ports(true).cue).toBe(run_board_sound_player.play_cue)
		expect(run_board_cli.live_ports(false).cue).toBeUndefined()
	})

	// joshuafolkken/kit#8250: the trill, like the cues, sounds on the live board alone.
	it('passes the trill to the live board alone', () => {
		expect(run_board_cli.live_ports(true).typing_sound).toBeDefined()
		expect(run_board_cli.live_ports(false).typing_sound).toBeUndefined()
	})

	// joshuafolkken/kit#8365: the trill sounds the theme row's voice at the row's letter pace.
	it('voices the trill with the theme row typing at its letter pace', () => {
		const voiced = vi.spyOn(run_board_sound_typing, 'voiced')
		const typing = vi.spyOn(THEME_DEFS.trace, 'typing').mockReturnValue('click.wav')

		run_board_cli.live_ports(true, { theme: 'trace', icons: 'shapes' })
		expect(voiced.mock.calls[0]?.[0]()).toBe('click.wav')
		expect(typing).toHaveBeenCalledWith(THEME_DEFS.trace.intro.letter_ms)
		vi.restoreAllMocks()
	})

	// joshuafolkken/kit#8339: `--timing` reads the heap of the worker a live board gathers on.
	it('passes the worker heap to the live board alone, reading none before a worker starts', async () => {
		const { worker_heap } = run_board_cli.live_ports(true)

		expect(worker_heap).toBeDefined()
		await expect(worker_heap?.()).resolves.toBeUndefined()
		expect(run_board_cli.live_ports(false).worker_heap).toBeUndefined()
	})
})
