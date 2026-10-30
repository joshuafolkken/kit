import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { ENV_FILE_NAME } from '#ports'
import { session_cite } from '#scripts/issue/session-cite'
import { file_reader } from '#scripts/lib/read-file'
import { lane_environment } from './lane-environment'
import { lane_paths } from './lane-paths'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_seat_ownership } from './lane-seat-ownership'
import { lane_seed_policy } from './lane-seed'

interface SeatReservation {
	seat: number
	lock: string
	issue_lock: string
}

const SEAT_LOCK_PREFIX = 'seat-'

function lock_path(root: string, name: string): string {
	return path.join(root, lane_paths.SEAT_LOCK_DIR, name)
}

function release_lock(lock: string): void {
	rmSync(lock, { recursive: true, force: true })
}

function release(reservation: SeatReservation): void {
	release_lock(reservation.lock)
	release_lock(reservation.issue_lock)
}

function open_in_flight_count(root: string): number {
	try {
		return readdirSync(path.join(root, lane_paths.SEAT_LOCK_DIR)).filter((entry) =>
			entry.startsWith(SEAT_LOCK_PREFIX),
		).length
	} catch {
		return 0
	}
}

function claim(lock: string): boolean {
	mkdirSync(path.dirname(lock), { recursive: true })

	try {
		mkdirSync(lock)

		return true
	} catch {
		return false
	}
}

function unreadable_description(lane: LaneInfo): string {
	return `${session_cite.issue(lane.issue)} (${lane.directory}): ${lane.seat_problem ?? 'unreadable .env'}`
}

function guard_readable(root: string, lanes: ReadonlyArray<LaneInfo>): void {
	const unreadable = lane_registry.unreadable_lanes(lanes)
	const unknown = unreadable.filter(
		(lane) => lane.seat_problem !== undefined || !existsSync(lock_path(root, `lane-${lane.issue}`)),
	)
	if (unknown.length === 0) return

	throw new Error(
		`Cannot read lane port ownership: ${unknown.map((lane) => unreadable_description(lane)).join(', ')}`,
	)
}

function candidates(lanes: ReadonlyArray<LaneInfo>, issue: string): Array<number> {
	const own = lane_registry.find_lane(lanes, issue)
	if (own?.seat_owned === true && own.seat !== undefined) return [own.seat]

	return lane_seed_policy.free_seats(lane_registry.used_seats(lanes))
}

async function ports_available(seat: number, lane: LaneInfo | undefined): Promise<boolean> {
	const root = lane?.directory ?? (await lane_registry.main_repository_root())
	const content = file_reader.read_file_or_empty(path.join(root, ENV_FILE_NAME))
	const ports = lane_environment.read_lane_ports(lane_environment.lane_file_content(content, seat))
	const reading = await lane_seat_ownership.snapshot()
	if (reading === undefined) throw new Error(lane_seat_ownership.UNREADABLE)

	return !lane_seat_ownership.ports_held(
		{ development_port: ports.development, preview_port: ports.preview },
		reading.ports,
	)
}

async function available(root: string, issue: string, seat: number): Promise<boolean> {
	const lanes = await lane_registry.list_lanes()

	guard_readable(root, lanes)

	if (lane_registry.used_seats(lanes.filter((lane) => lane.issue !== issue)).includes(seat)) {
		return false
	}

	if (lane_registry.find_lane(lanes, issue)?.seat_owned === true) return true

	return await ports_available(seat, lane_registry.find_lane(lanes, issue))
}

async function try_seat(root: string, issue: string, seat: number): Promise<string | undefined> {
	const lock = lock_path(root, `${SEAT_LOCK_PREFIX}${String(seat)}`)
	if (!claim(lock)) return undefined
	let is_held = false

	try {
		is_held = await available(root, issue, seat)

		return is_held ? lock : undefined
	} finally {
		if (!is_held) release_lock(lock)
	}
}

async function first_available(
	root: string,
	issue: string,
	seats: ReadonlyArray<number>,
): Promise<Pick<SeatReservation, 'seat' | 'lock'> | undefined> {
	const [seat, ...rest] = seats
	if (seat === undefined) return undefined
	const lock = await try_seat(root, issue, seat)

	return lock === undefined ? await first_available(root, issue, rest) : { seat, lock }
}

async function reserve_locked(
	root: string,
	issue: string,
	issue_lock: string,
): Promise<SeatReservation | undefined> {
	const lanes = await lane_registry.list_lanes()

	guard_readable(root, lanes)

	const selected = await first_available(root, issue, candidates(lanes, issue))

	return selected === undefined ? undefined : { ...selected, issue_lock }
}

async function reserve(root: string, issue: string): Promise<SeatReservation | undefined> {
	const issue_lock = lock_path(root, `lane-${issue}`)
	if (!claim(issue_lock)) throw new Error(`Lane ${issue} is already acquiring a port seat.`)

	try {
		const reservation = await reserve_locked(root, issue, issue_lock)
		if (reservation !== undefined) return reservation
	} catch (error) {
		release_lock(issue_lock)
		throw error
	}

	release_lock(issue_lock)

	return undefined
}

const lane_seat = { guard_readable, open_in_flight_count, release, reserve }

export { lane_seat }
export type { SeatReservation }
