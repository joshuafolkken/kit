import path from 'node:path'
import type { RunInput } from './test-related-record'

// The run input the `test_related_record` suites share: one own change, one a main sync brought in,
// one the change since the map's tree joined, and a reader test in the scope alone.

const ROOT = '/repository'
const OWN_CHANGE = 'scripts/own.ts'
const SYNCED_CHANGE = 'scripts/synced.ts'
const SINCE_MAP_CHANGE = 'scripts/since-map.ts'
const READER_TEST = 'scripts/reader.test.ts'

function related_input(): RunInput {
	const files = [OWN_CHANGE, SYNCED_CHANGE, SINCE_MAP_CHANGE, READER_TEST].map((file) =>
		path.join(ROOT, file),
	)

	return {
		scope: { mode: 'related', files, reason: '4 related file(s)' },
		root: ROOT,
		changed: [OWN_CHANGE, SYNCED_CHANGE, SINCE_MAP_CHANGE],
		synced: [SYNCED_CHANGE],
		since_map: [SINCE_MAP_CHANGE],
	}
}

const test_related_record_fixture = {
	ROOT,
	OWN_CHANGE,
	SYNCED_CHANGE,
	SINCE_MAP_CHANGE,
	READER_TEST,
	related_input,
}

export { test_related_record_fixture }
