import { stamp_file } from '#scripts/josh/stamp-file'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// The live run's lane-limit override: where `josh lane:limit` writes it, where
// `lane_capacity.lane_limit` reads it, and how the `--wait` watcher sees a raise.
//
// **It lives on the run's carry record**, not in a file of its own. A running parent keeps the
// environment it started with, so `JOSH_LANE_LIMIT` cannot change under it; the record is keyed on the
// common git directory, so the parent, its lanes and a person's shell all resolve the same one — and it
// is removed with the run at `run:carry --end`, so an override never outlives the run it was set on.

const STREAM_START = 0

async function carry_target(): Promise<string | undefined> {
	const repository = await run_carry.repository_directory()

	return repository === undefined ? undefined : run_carry.carry_path(repository)
}

function live_carry(target: string): RunCarry | undefined {
	const read = run_carry.read_carry(target)

	return read.kind === 'carried' ? read.carry : undefined
}

async function current_carry(): Promise<RunCarry | undefined> {
	const target = await carry_target()

	return target === undefined ? undefined : live_carry(target)
}

// The override, or `undefined` where no live run set one — the run's start limit, else the
// environment's, then stands.
async function read_override(): Promise<number | undefined> {
	const carry = await current_carry()

	return carry?.lane_limit
}

// A record a crashed run left must not pin its start limit over an edited `.env`: the start limit
// counts while its owner lives, or while a cut hands the record to a successor.
function is_run_live(carry: RunCarry): boolean {
	return carry.is_handed_off === true || run_carry.is_owner_live(carry)
}

// The limit a live run holds: its override, else the limit it started with — so a `--reset` returns
// to the run's own `JOSH_LANE_LIMIT`, not the one a shell's `.env` reads now (joshuafolkken/kit#6166).
async function read_carried(): Promise<number | undefined> {
	const carry = await current_carry()

	if (carry?.lane_limit !== undefined) return carry.lane_limit

	return carry !== undefined && is_run_live(carry) ? carry.launch_limit : undefined
}

// Answers whether a live run took the fields: with no run there is no record to write to, and the
// next run reads `JOSH_LANE_LIMIT` as it starts.
async function update_carry(
	fields: Pick<RunCarry, 'lane_limit'> | Pick<RunCarry, 'launch_limit'>,
): Promise<boolean> {
	const target = await carry_target()
	const carry = target === undefined ? undefined : live_carry(target)

	if (target === undefined || carry === undefined) return false

	stamp_file.write_stamp(target, { ...carry, ...fields })

	return true
}

// `undefined` clears the override.
async function write_override(limit: number | undefined): Promise<boolean> {
	return await update_carry({ lane_limit: limit })
}

async function write_launch(limit: number): Promise<boolean> {
	return await update_carry({ launch_limit: limit })
}

async function emit_raise(text: string): Promise<void> {
	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.LANE_LIMIT, text)
}

function never_raised(): boolean {
	return false
}

// A check for a raise written after this call — the watcher takes it at its start, so a raise it was
// started after is not one it wakes for.
async function watch_raise(): Promise<() => boolean> {
	const target = await run_event_stream_emit.stream_target()

	if (target === undefined) return never_raised

	const start = run_event_stream.read_from(target, STREAM_START).next_position

	return function is_raised(): boolean {
		const { events } = run_event_stream.read_from(target, start)

		return events.some((event) => event.kind === run_event_stream.EVENT_KIND.LANE_LIMIT)
	}
}

const lane_limit_override = {
	emit_raise,
	read_carried,
	read_override,
	watch_raise,
	write_launch,
	write_override,
}

export { lane_limit_override }
