import { stamp_file } from '#scripts/josh/stamp-file'
import { run_carry, type CarryOwner } from './run-carry'
import { run_carry_conversation } from './run-carry-conversation'

// **A resumed conversation has to take its record back before it falls quiet**.
// A count moves the owner to the conversation's new process, but a parent waiting on a lane child
// counts nothing — `lane:await` blocks in the background and the transcript stays unwritten — so a
// restart followed by a long wait outlasts the quiet window with the record still naming the dead
// process, and `run:wake` recovers it as a crash. The wait itself is therefore where the parent
// declares its owner: `lane:await --owner "$PPID"` reclaims the record before it starts waiting.

// Writes the record back under the caller's process when the caller is the record's own conversation
// in a new one; answers whether it did.
function reclaim_at(target: string, owner: CarryOwner): boolean {
	const read = run_carry.read_carry(target)

	if (read.kind !== 'carried') return false

	const reclaimed = run_carry_conversation.reclaim_owner(read.carry, owner)

	if (reclaimed === read.carry) return false

	// Replaced atomically: a `run:wake` reading between an unlink and a write would see no record.
	stamp_file.replace_stamp(target, reclaimed)

	return true
}

async function reclaim_carry(owner: CarryOwner): Promise<boolean> {
	const directory = await run_carry.repository_directory()

	return directory !== undefined && reclaim_at(run_carry.carry_path(directory), owner)
}

const run_carry_reclaim = { reclaim_at, reclaim_carry }

export { run_carry_reclaim }
