import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceManifest, TemplateSourcePair } from './template-source-logic'

const MANIFEST_PATH = '.template-source-manifest.json'

vi.mock('./template-source-logic', () => ({
	template_source_logic: {
		find_copy_drift: vi.fn(),
		find_tripwire_drift: vi.fn(),
		read_recorded_manifest: vi.fn(),
		format_drift_message: vi.fn(),
		reconcile: vi.fn(),
		MANIFEST_PATH,
	},
}))

const { template_source_logic } = await import('./template-source-logic')
const mocked = {
	find_copy_drift: vi.mocked(template_source_logic.find_copy_drift),
	find_tripwire_drift: vi.mocked(template_source_logic.find_tripwire_drift),
	read_recorded_manifest: vi.mocked(template_source_logic.read_recorded_manifest),
	format_drift_message: vi.mocked(template_source_logic.format_drift_message),
	reconcile: vi.mocked(template_source_logic.reconcile),
}

const { check_drift, reconcile } = await import('./reconcile-templates')

const PROCESS_EXIT_CALLED = 'process.exit called'
const IN_SYNC_MESSAGE = '✔ Templates are in sync with their sources.'
const DRIFT_MESSAGE = 'drift detected'
const RECORDED_MANIFEST: SourceManifest = { gitignore: 'abc123' }
const COPY_PAIR: TemplateSourcePair = { template: 'templates/gitignore', source: '.gitignore' }
const TRIPWIRE_PAIR: TemplateSourcePair = {
	template: 'templates/sonar-project.properties',
	source: 'sonar-project.properties',
}

beforeEach(() => {
	vi.clearAllMocks()
	mocked.read_recorded_manifest.mockReturnValue(RECORDED_MANIFEST)
	mocked.format_drift_message.mockReturnValue(DRIFT_MESSAGE)
	vi.spyOn(process, 'exit').mockImplementation(() => {
		throw new Error(PROCESS_EXIT_CALLED)
	})
	vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
	vi.spyOn(console, 'error').mockImplementation(() => {
		/* suppress */
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('check_drift — in sync', () => {
	beforeEach(() => {
		mocked.find_copy_drift.mockReturnValue([])
		mocked.find_tripwire_drift.mockReturnValue([])
	})

	it('exits 0 when neither copy nor tripwire drift is present', () => {
		expect(() => {
			check_drift()
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(vi.mocked(process.exit)).toHaveBeenCalledWith(0)
	})

	it('reports the in-sync message and does not format a drift message', () => {
		expect(() => {
			check_drift()
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(vi.mocked(console.info)).toHaveBeenCalledWith(IN_SYNC_MESSAGE)
		expect(mocked.format_drift_message).not.toHaveBeenCalled()
		expect(vi.mocked(console.error)).not.toHaveBeenCalled()
	})

	it('evaluates tripwire drift against the recorded manifest', () => {
		expect(() => {
			check_drift()
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(mocked.find_tripwire_drift).toHaveBeenCalledWith(RECORDED_MANIFEST)
	})
})

describe('check_drift — drift detected', () => {
	it('exits 1 and prints the drift message when only copy drift exists', () => {
		mocked.find_copy_drift.mockReturnValue([COPY_PAIR])
		mocked.find_tripwire_drift.mockReturnValue([])

		expect(() => {
			check_drift()
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(vi.mocked(console.error)).toHaveBeenCalledWith(DRIFT_MESSAGE)
		expect(vi.mocked(process.exit)).toHaveBeenCalledWith(1)
		expect(mocked.format_drift_message).toHaveBeenCalledWith([COPY_PAIR], [])
	})

	it('exits 1 when only tripwire drift exists', () => {
		mocked.find_copy_drift.mockReturnValue([])
		mocked.find_tripwire_drift.mockReturnValue([TRIPWIRE_PAIR])

		expect(() => {
			check_drift()
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(vi.mocked(process.exit)).toHaveBeenCalledWith(1)
		expect(mocked.format_drift_message).toHaveBeenCalledWith([], [TRIPWIRE_PAIR])
	})

	it('exits 1 when both copy and tripwire drift exist', () => {
		mocked.find_copy_drift.mockReturnValue([COPY_PAIR])
		mocked.find_tripwire_drift.mockReturnValue([TRIPWIRE_PAIR])

		expect(() => {
			check_drift()
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(vi.mocked(process.exit)).toHaveBeenCalledWith(1)
		expect(mocked.format_drift_message).toHaveBeenCalledWith([COPY_PAIR], [TRIPWIRE_PAIR])
	})
})

describe('reconcile', () => {
	it('regenerates templates and exits 0', () => {
		expect(() => {
			reconcile()
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(mocked.reconcile).toHaveBeenCalledOnce()
		expect(vi.mocked(process.exit)).toHaveBeenCalledWith(0)
	})

	it('reports the reconciled message including the manifest path', () => {
		expect(() => {
			reconcile()
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(vi.mocked(console.info)).toHaveBeenCalledWith(
			expect.stringContaining('Templates reconciled'),
		)
		expect(vi.mocked(console.info)).toHaveBeenCalledWith(expect.stringContaining(MANIFEST_PATH))
	})
})
