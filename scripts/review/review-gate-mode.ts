import { package_manifest, REVIEW_GATE_SCHEMA } from '#scripts/lib/package-manifest'
import type { z } from 'zod'

type ReviewGateMode = z.infer<typeof REVIEW_GATE_SCHEMA>

const ENV_KEY = 'JOSH_REVIEW_GATE'
const DEFAULT_MODE: ReviewGateMode = 'local'

function read(directory: string = process.cwd()): ReviewGateMode {
	return (
		REVIEW_GATE_SCHEMA.safeParse(process.env[ENV_KEY]).data ??
		package_manifest.read_nearest_value(
			directory,
			package_manifest.josh_schemas.review_gate,
			function select_mode(manifest) {
				return manifest.josh?.review_gate
			},
		) ??
		DEFAULT_MODE
	)
}

const review_gate_mode = { read }

export { review_gate_mode }
