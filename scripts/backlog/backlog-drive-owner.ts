import { run_carry, type RunCarry } from '#scripts/run/run-carry'

function owns_record(carry: RunCarry, owner: string): boolean {
	const current = run_carry.owner_of(Number(owner))
	const has_owner = carry.owner_pid === current.pid && carry.owner_start === current.start

	return has_owner && run_carry.is_owner_live(carry) && !carry.is_handed_off
}

async function assert_current(owner: string): Promise<void> {
	const directory = await run_carry.repository_directory()
	if (directory === undefined) throw new Error('The carry record cannot be located.')

	const read = run_carry.read_carry(run_carry.carry_path(directory))
	if (read.kind !== 'carried') throw new Error('The carry record is no longer active.')

	if (!owns_record(read.carry, owner)) {
		throw new Error('The driver no longer owns the carry record.')
	}
}

export const backlog_drive_owner = { assert_current }
