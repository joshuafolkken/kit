// Runs work whose own reports go to stdout with stdout pointed at stderr, for a caller whose stdout is
// a contract: the `Stop` hook's decision envelope, and `josh run:hold`'s single verdict token.

type StreamWrite = typeof process.stdout.write

function set_stdout_write(stream_write: StreamWrite): void {
	process.stdout.write = stream_write
}

async function run<T>(work: () => Promise<T>): Promise<T> {
	const saved = { write: process.stdout.write.bind(process.stdout) }

	set_stdout_write(process.stderr.write.bind(process.stderr))

	try {
		return await work()
	} finally {
		set_stdout_write(saved.write)
	}
}

const stdout_on_stderr = { run }

export { stdout_on_stderr }
