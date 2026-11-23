// Ends a `josh gate` whose parent died (joshuafolkken/kit#8845). A gate launched by a lane worker or
// `josh run:review` keeps running its children (ESLint, vitest) when that parent stops, with nobody
// left to read the verdict — the orphan holds gigabytes and cores until a person kills its group.
//
// The parent is read once at launch and polled after: a changed `process.ppid` means the parent is
// gone (the kernel hands an orphan to init or another adopting process). On that change the gate signals its
// own process group — itself and every check it spawned — and exits non-zero in case the signal
// does not end it. The poll timer is `unref`ed, so a gate whose checks are done exits on its own as
// before and a live parent sees no change in what the gate does or how long it takes.
const PARENT_POLL_MS = 2000
const ORPHAN_EXIT_CODE = 1
// `process.kill(0, …)` is `kill(2)` on pid 0: the caller's own process group.
const OWN_GROUP = 0
const GROUP_SIGNAL = 'SIGTERM'

interface ParentProbe {
	read_parent: () => number
	end_group: () => void
	exit: (code: number) => void
}

function read_parent(): number {
	return process.ppid
}

function end_group(): void {
	process.kill(OWN_GROUP, GROUP_SIGNAL)
}

function exit(code: number): void {
	process.exit(code)
}

const PROCESS_PROBE: ParentProbe = { read_parent, end_group, exit }

function check_parent(launch_parent: number, probe: ParentProbe): void {
	if (probe.read_parent() === launch_parent) return

	probe.end_group()
	probe.exit(ORPHAN_EXIT_CODE)
}

function start(probe: ParentProbe = PROCESS_PROBE, interval_ms = PARENT_POLL_MS): NodeJS.Timeout {
	const launch_parent = probe.read_parent()
	const timer = setInterval(() => {
		check_parent(launch_parent, probe)
	}, interval_ms)

	timer.unref()

	return timer
}

const gate_parent_watch = { ORPHAN_EXIT_CODE, PARENT_POLL_MS, check_parent, start }

export { gate_parent_watch, type ParentProbe }
