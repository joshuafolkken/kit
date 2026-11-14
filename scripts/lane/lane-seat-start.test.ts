import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { deferred_answer } from '#scripts/git/deferred-answer-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_seat } from './lane-seat'
import { lane_seat_ownership } from './lane-seat-ownership'
import { lane_seat_start } from './lane-seat-start'

const make_directory = temporary_directory('suite')

const ROOT = make_directory('lane-seat-start-')
const MAIN = path.join(ROOT, 'kit')
const LANES = path.join(ROOT, '.kit-lanes')
const ISSUE = '5444'
const OLD_SEAT = 9
const DIRTY_FILE = 'unfinished.txt'
const CONTENT = 'saved changes'
const PREVIOUS_LOG = path.join(ROOT, 'previous.log')
const LOCKS = '.seat-locks'
const FAILURE = 'launch failed'

function lane(): LaneInfo {
	return {
		issue: ISSUE,
		branch: `${ISSUE}-lane`,
		directory: path.join(LANES, ISSUE),
		seat: OLD_SEAT,
		development_port: undefined,
		preview_port: undefined,
		output: PREVIOUS_LOG,
		is_stranded: false,
		seat_held: false,
	}
}

function environment_file(): string {
	return path.join(lane().directory, '.env')
}

beforeEach(() => {
	mkdirSync(lane().directory, { recursive: true })
	mkdirSync(MAIN, { recursive: true })
	writeFileSync(
		environment_file(),
		`PORT_SEED=2\nJOSH_LANE_SEAT=${String(OLD_SEAT)}\nJOSH_LANE_OUTPUT=${PREVIOUS_LOG}\n`,
	)
	writeFileSync(path.join(lane().directory, DIRTY_FILE), CONTENT)
	vi.stubEnv('JOSH_LANE_ROOT', LANES)
	vi.spyOn(lane_registry, 'main_repository_root').mockResolvedValue(MAIN)
	vi.spyOn(lane_registry, 'list_lanes').mockResolvedValue([lane()])
	vi.spyOn(lane_seat_ownership, 'snapshot').mockResolvedValue({
		running: new Set(),
		ports: new Set(),
	})
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	rmSync(ROOT, { force: true, recursive: true })
})

describe('lane seat start', () => {
	it('updates the saved environment and launch environment before resuming on another seat', async () => {
		await lane_seat_start.start(lane(), async (seated) => {
			expect(seated.seat).toBe(1)
			expect(readFileSync(environment_file(), 'utf8')).toContain('JOSH_LANE_SEAT=1\n')
			expect(lane_seat_start.environment(seated)).toEqual({ JOSH_LANE_SEAT: '1', PORT_SEED: '2' })
		})
		const dirty = readFileSync(path.join(lane().directory, DIRTY_FILE), 'utf8')

		expect(dirty).toBe(CONTENT)
		expect(readFileSync(environment_file(), 'utf8')).toContain(`JOSH_LANE_OUTPUT=${PREVIOUS_LOG}`)
	})

	it('reserves different seats for concurrent starts and releases both', async () => {
		const leases = await Promise.all([
			lane_seat.reserve(LANES, ISSUE),
			lane_seat.reserve(LANES, '5445'),
		])

		expect(new Set(leases.map((lease) => lease?.seat)).size).toBe(leases.length)

		for (const lease of leases) {
			if (lease !== undefined) lane_seat.release(lease)
		}

		expect(readdirSync(path.join(LANES, LOCKS))).toEqual([])
	})
})

describe('failed lane seat starts', () => {
	it('holds one same-issue start during confirmation, then releases a wait for retry', async () => {
		const entered = deferred_answer<undefined>()
		const confirmation = deferred_answer<string>()
		const first = lane_seat_start.start(lane(), async () => {
			entered.answer(undefined)

			return await confirmation.promise
		})

		await entered.promise
		await expect(lane_seat_start.start(lane(), async () => 'duplicate')).rejects.toThrow(
			'already acquiring',
		)
		confirmation.answer('waiting')
		expect(await first).toBe('waiting')
		expect(readdirSync(path.join(LANES, LOCKS))).toEqual([])
		expect(await lane_seat_start.start(lane(), async () => 'launched')).toBe('launched')
	})

	it('returns the reservation after a launch failure', async () => {
		await expect(
			lane_seat_start.start(lane(), async () => {
				throw new Error(FAILURE)
			}),
		).rejects.toThrow(FAILURE)
		expect(readdirSync(path.join(LANES, LOCKS))).toEqual([])
	})

	it('refuses an unknown process reading and leaves no reservation', async () => {
		vi.mocked(lane_seat_ownership.snapshot).mockResolvedValue(undefined)
		await expect(lane_seat_start.start(lane(), async () => undefined)).rejects.toThrow('process')
		expect(readdirSync(path.join(LANES, LOCKS))).toEqual([])
	})
})
