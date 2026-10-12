import { existsSync } from 'node:fs'
import { poll } from '#scripts/lib/poll'
import { run_carry, type CarryRead, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'
import { backlog_budget } from './backlog-budget'

// **A record that does not read is asked again before the driver gives up on it.** The driver is the
// only thing looking for work during the idle watch, so ending on one failed read throws away whatever
// is left of the watch. The read is repeated at the offer's own interval, and
// the count bounds it: a record that stays unreadable still ends the driver, with the reason said.
const READ_ATTEMPTS = 6
const ENDED_MESSAGE = 'The carry record is no longer active.'

// The run this driver last read, so a record that is gone can be told from one `run:carry --end` ended.
const seen: { started_at?: string } = {}

function owns_record(carry: RunCarry, owner: string): boolean {
	const current = run_carry.owner_of(Number(owner))
	const has_owner = carry.owner_pid === current.pid && carry.owner_start === current.start

	return has_owner && run_carry.is_owner_live(carry) && !carry.is_handed_off
}

// `--end` records the run it removes, so an ended run answers at once rather than after the re-reads.
function is_ended(directory: string): boolean {
	return run_carry_ended.has_ended(run_carry_ended.ended_path(directory), seen.started_at)
}

// Whether the file is there is said beside the read, because `none` is the answer both to a record
// that is gone and to one that is present and could not be opened.
function unread_note(read: CarryRead, directory: string): string {
	const presence = existsSync(run_carry.carry_path(directory)) ? 'present' : 'absent'

	return `The carry record read \`${read.kind}\` with its file ${presence}`
}

function is_settled(read: CarryRead, directory: string): boolean {
	if (read.kind === 'carried' || is_ended(directory)) return true

	console.error(`${unread_note(read, directory)}; reading it again.`)

	return false
}

async function read_record(directory: string): Promise<CarryRead> {
	const target = run_carry.carry_path(directory)
	let read: CarryRead = { kind: 'none' }

	await poll.poll_until(
		async () => {
			read = run_carry.read_carry(target)

			return is_settled(read, directory)
		},
		{
			attempts: READ_ATTEMPTS,
			interval_ms: backlog_budget.OFFER_INTERVAL_MS,
			sleeper: async (duration_ms) => {
				await poll.sleep(duration_ms)
			},
		},
	)

	return read
}

function unread_message(read: CarryRead, directory: string): string {
	if (is_ended(directory)) return ENDED_MESSAGE

	return `${unread_note(read, directory)}, ${String(READ_ATTEMPTS)} times in a row.`
}

async function assert_current(owner: string): Promise<RunCarry> {
	const directory = await run_carry.repository_directory()
	if (directory === undefined) throw new Error('The carry record cannot be located.')

	const read = await read_record(directory)
	if (read.kind !== 'carried') throw new Error(unread_message(read, directory))

	if (!owns_record(read.carry, owner)) {
		throw new Error('The driver no longer owns the carry record.')
	}

	seen.started_at = read.carry.started_at

	return read.carry
}

export const backlog_drive_owner = { READ_ATTEMPTS, assert_current }
