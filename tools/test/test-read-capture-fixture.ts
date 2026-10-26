import { test_read_capture, type RecorderState } from './test-read-capture'

// A repository module that is not a test, recording a read the way `import-graph.ts` makes one: from a
// named function, after an `await` dropped the test that called it from the stack
// (joshuafolkken/kit#5033).
async function record_after_await(state: RecorderState, file: string): Promise<void> {
	await Promise.resolve()
	test_read_capture.record_read(state, file)
}

const test_read_capture_fixture = { record_after_await }

export { test_read_capture_fixture }
