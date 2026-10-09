import type { StreamRead } from './run-event-stream'

// The loop behind `josh run:event --watch` — the ambient surface a person keeps open in a pane of their
// own. A session relaying `--follow` would re-read its whole history on every line, so the watch runs
// the same pass in a loop inside one process and writes each event as the rendered line, so a person
// sees an event land at once and the conversation is never woken for it.
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
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		const read = await ports.pass(next)

		for (const event of read.events) ports.write(ports.render(event))
		next = read.next_position
	}

	return next
}

const run_event_watch = { watch }

export type { WatchPorts }
export { run_event_watch }
