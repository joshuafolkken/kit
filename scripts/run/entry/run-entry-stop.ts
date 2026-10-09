import { issue_cite } from '#scripts/issue/issue-cite'
import { josh_command } from '#scripts/josh/josh-run'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { lane_park } from '#scripts/rules/lane-park'

// What `run:entry` does on the way out of a stop it decided itself.
//
// **The command that decides the stop does its chores** — the `confirmation` Telegram and the hold
// release — because it knows everything they need, and leaving them to the agent costs further turns
// re-reading the whole context. The `Stop` hook stays a safety net that a normal run never trips.
//
// **The release is the claim's own undo, and only where this call made the claim.** A resume over a
// stopped `halfrun` / `prrun` stops on the budget before adopting anything, and the hold there is the
// stopped run's — kept on purpose over its verified diff — so that stop notifies and releases nothing.
// A `busy` / `unknown` hold is another run's, or none at all, so it is never released here either.
//
// **A dispatched lane child sends no Telegram from here.** Its stop must park the Issue before it
// notifies, and `lane_park`'s guard delivers that rule at the `josh notify` call — a Telegram sent from
// inside this command would pass that guard by and satisfy the `Stop` hook with no park behind it.

interface StopNotice {
	issue_number: string
	command: string
	reason: string
	should_release: boolean
}

interface StopPorts {
	notify: (input: { issue_title: string; body: string; recovery: string }) => Promise<boolean>
	release: (issue_number: string) => Promise<boolean>
	is_parking_child: () => boolean
}

const RECOVERY = 'If this did not arrive, the run:entry output in the session names the stop.'
const NOTIFY_FAILED_NOTE =
	'(the confirmation Telegram could not be sent — send it with `pnpm josh notify --task-type confirmation` before stopping)'
const RELEASED_NOTE = '(hold released by run:entry — the tree is free for the resume)'
const RELEASE_FAILED_NOTE =
	'(the hold could not be released — run `pnpm josh run:release` before stopping)'
const should_forward_stderr = true
const SUCCESS_EXIT_CODE = 0

const BUDGET_REASON = 'the session budget is spent'
const HOLD_REASON = 'the working tree is not held for this run — see the run:entry output'

async function release(issue_number: string): Promise<boolean> {
	const released = await josh_command.josh_run(['run:release', issue_number], should_forward_stderr)

	return released.code === SUCCESS_EXIT_CODE
}

function is_parking_child(): boolean {
	return lane_park.is_parking_child()
}

const DEFAULT_PORTS: StopPorts = { notify: telegram_notify.confirm, release, is_parking_child }

function body_of(notice: StopNotice): string {
	return `${notice.command} ${issue_cite.plain(notice.issue_number)} stopped at entry: ${notice.reason}.\nResume with \`${notice.command} ${issue_cite.plain(notice.issue_number)}\`.`
}

// The release runs first, so the resume the Telegram names finds the tree free when a person acts on it.
// The marker line is printed only for a Telegram that went out: the `Stop` hook reads it as the notify,
// and a failed send has to leave the hook still asking for one. The released note, likewise, is printed
// only for a release that succeeded, so a failed one leaves the agent still asked to release.
async function release_claim(notice: StopNotice, ports: StopPorts): Promise<void> {
	if (!notice.should_release) return

	const is_released = await ports.release(notice.issue_number)

	console.info(is_released ? RELEASED_NOTE : RELEASE_FAILED_NOTE)
}

async function notify_stop(notice: StopNotice, ports: StopPorts): Promise<void> {
	if (ports.is_parking_child()) return

	const is_sent = await ports.notify({
		issue_title: `${notice.command} ${issue_cite.plain(notice.issue_number)} stopped`,
		body: body_of(notice),
		recovery: RECOVERY,
	})

	console.info(is_sent ? lane_park.COMMAND_NOTIFY_MARKER : NOTIFY_FAILED_NOTE)
}

async function stop(notice: StopNotice, ports: StopPorts = DEFAULT_PORTS): Promise<void> {
	await release_claim(notice, ports)
	await notify_stop(notice, ports)
}

const run_entry_stop = {
	BUDGET_REASON,
	HOLD_REASON,
	NOTIFY_FAILED_NOTE,
	RELEASED_NOTE,
	RELEASE_FAILED_NOTE,
	body_of,
	stop,
}

export { run_entry_stop }
export type { StopNotice, StopPorts }
