import { document_byte_check } from './document-byte-check'
import { document_ratchet_check } from './document-ratchet-check'

// The document checks `josh lint:related` brings forward from the gate's tests, as one call: the
// byte ceilings (`document-byte-check.ts`) and the ratchets (`document-ratchet-check.ts`). Both run
// every time, so one edit reports every ceiling it broke in one pass rather than one per run.

const CHECKS = [document_byte_check, document_ratchet_check]

function check_files(root: string, absolute_files: ReadonlyArray<string>): number {
	return Math.max(...CHECKS.map((check) => check.check_files(root, absolute_files)))
}

function check_all(root: string): number {
	return Math.max(...CHECKS.map((check) => check.check_all(root)))
}

const document_checks = { check_all, check_files }

export { document_checks }
