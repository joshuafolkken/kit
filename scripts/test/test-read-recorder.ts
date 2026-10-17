import { test_read_capture } from './test-read-capture'

// The worker setup file that records which repository paths each test reads, for the test-read map.
// Every worker runs it before every test file; what it arms is `test-read-capture.ts`.
test_read_capture.arm()
