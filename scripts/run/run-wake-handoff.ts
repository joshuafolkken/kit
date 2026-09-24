import { stamp_file } from '#scripts/josh/stamp-file'
import { run_carry } from './run-carry'

// The supervisor's recovery hand-off (joshuafolkken/kit#2437). A session that claimed the carry record
// and then died without `run:carry --cut` leaves it `carried`, owned by a gone process, with no
// hand-off. `run-wake.ts` → `decide_not_handed_off` already re-wakes on that record (#2336), but the
// successor it woke then ran `--begin` over a record no cut handed off and was answered `standing` —
// "stop for a person" — so the recovery ended the run it existed to continue.
//
// **The fix is to make the recovery a cut, not to teach the successor a second answer.** Before it
// launches, the supervisor writes the same `is_handed_off` a `--cut` writes, so the successor's
// `--begin` classifies `resume` through the one path a declared cut already takes, and `standing` is
// left meaning what `backlogrun-steps.md` says it means: a record nobody is watching.
//
// It writes only where the record is `carried` and not already handed off, so on the ordinary path —
// a hand-off a cut already declared — it touches nothing. The dead-owner test is the caller's: the loop
// reaches a launch on an un-handed-off record only through `decide_not_handed_off`'s dead-owner branch.

function hand_off(target: string): void {
	const read = run_carry.read_carry(target)

	if (read.kind !== 'carried' || read.carry.is_handed_off === true) return

	stamp_file.write_stamp(target, { ...read.carry, is_handed_off: true })
}

const run_wake_handoff = { hand_off }

export { run_wake_handoff }
