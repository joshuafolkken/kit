import type { StreamRead } from './run-event-stream'

// The loop behind `josh run:event --watch` (joshuafolkken/kit#2492) — the ambient surface a person keeps
// open in a pane of their own. `--follow` is one bounded pass a session restarted after every exit,
// relaying each line into its conversation; each relay re-read that conversation's whole history, so the
// attached session outspent every lane of the run on relaying alone. The watch runs the same pass in a
// loop inside one process and writes each event as the rendered line, so a person sees an event land at
// once and the conversation is never woken for it.
//
// **The pass is `run_event_follow.follow`, reused through a port rather than re-spelled**, and the loop
// carries the position the pass hands back. `should_continue` is the one stop condition: the CLI's is
// "until interrupted", a test's is a pass count.

interface WatchPorts {
	pass: (position: number) => Promise<StreamRead>
	write: (line: string) => void
	render: (event: StreamRead['events'][number]) => string
	should_continue: () => boolean
}

async function watch(ports: WatchPorts, position: number): Promise<number> {
	let next = position

	while (ports.should_continue()) {
		const read = await ports.pass(next)

		for (const event of read.events) ports.write(ports.render(event))
		next = read.next_position
	}

	return next
}

const run_event_watch = { watch }

export type { WatchPorts }
export { run_event_watch }
