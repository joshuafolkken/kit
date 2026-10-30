import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { lane_environment } from './lane-environment'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_seat, type SeatReservation } from './lane-seat'
import { lane_seat_ownership } from './lane-seat-ownership'
import { lane_seat_start } from './lane-seat-start'

const ROOT = mkdtempSync(path.join(tmpdir(), 'lane-seat-live-'))
const MAIN = path.join(ROOT, 'kit')
const LANES = path.join(ROOT, '.kit-lanes')
const DIRECTORY = path.join(LANES, '5444')
const ENVIRONMENT = path.join(DIRECTORY, '.env')
const SEED = 90
const OLD_SEAT = 9
const servers: Array<Server> = []
const leases: Array<SeatReservation> = []

function lane(): LaneInfo {
	const content = readFileSync(ENVIRONMENT, 'utf8')
	const ports = lane_environment.read_lane_ports(content)

	return {
		issue: '5444',
		branch: '5444-lane',
		directory: DIRECTORY,
		seat: lane_environment.read_lane_seat(content),
		development_port: ports.development,
		preview_port: ports.preview,
		output: undefined,
		is_stranded: false,
	}
}

async function listed(): Promise<Array<LaneInfo>> {
	return lane_seat_ownership.measure([lane()], await lane_seat_ownership.snapshot())
}

async function held(): Promise<boolean | undefined> {
	const lanes = await listed()

	return lanes[0]?.seat_held
}

function prepare(): void {
	mkdirSync(DIRECTORY, { recursive: true })
	mkdirSync(MAIN)
	writeFileSync(ENVIRONMENT, `PORT_SEED=${String(SEED)}\nJOSH_LANE_SEAT=${String(OLD_SEAT)}\n`)
	writeFileSync(path.join(MAIN, '.env'), `PORT_SEED=${String(SEED)}\n`)
	vi.stubEnv('JOSH_LANE_ROOT', LANES)
	vi.spyOn(lane_registry, 'main_repository_root').mockResolvedValue(MAIN)
	vi.spyOn(lane_registry, 'list_lanes').mockImplementation(listed)
}

async function serve(seated: LaneInfo): Promise<Server> {
	const server = createServer()

	servers.push(server)
	server.listen(seated.development_port, '127.0.0.1')
	await once(server, 'listening')

	return server
}

async function close(server: Server): Promise<void> {
	server.close()
	await once(server, 'close')
}

afterEach(() => {
	for (const server of servers) server.close()
	for (const lease of leases) lane_seat.release(lease)
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	rmSync(ROOT, { force: true, recursive: true })
})

it.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')(
	'starts, protects a real listener, stops, reuses its seat and resumes elsewhere',
	async () => {
		prepare()
		const server = await lane_seat_start.start(lane(), serve)

		expect(await held()).toBe(true)
		await close(server)
		expect(await held()).toBe(false)
		const occupied = await lane_seat.reserve(LANES, '5445')
		if (occupied === undefined) throw new Error('Expected a free seat after the listener stopped')
		leases.push(occupied)
		await lane_seat_start.start(lane(), async (seated) => {
			expect(seated.seat).not.toBe(occupied.seat)
			expect(lane_seat_start.environment(seated)['JOSH_LANE_SEAT']).toBe(String(seated.seat))
		})
	},
)
