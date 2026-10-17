import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { test_read_trace } from './test-read-trace'

// joshuafolkken/kit#4065: the recorder runs as a setup file in every unit worker, so a run that did
// not ask for a recording must find `fs` exactly as Node left it, and a whole-suite run that did must
// find it wrapped. Which of the two this run is decides the expected name.
function expected_read_name(): string {
	return process.env[test_read_trace.RECORD_DIRECTORY_KEY] === undefined
		? 'readFileSync'
		: 'recorded'
}

describe('the test-read recorder', () => {
	it('patches fs exactly when the run asked for a recording', () => {
		expect(readFileSync.name).toBe(expected_read_name())
	})
})
