// The one check `run:chain` and the ship's pre-detach both run: `command:derive --check` names each
// generated page the derivation would rewrite, and writes none (joshuafolkken/kit#7728). It lives in
// `scripts/` because both callers ship; the derivation itself is kit's (`tools/document/`).

const DERIVE_COMMAND = 'pnpm josh command:derive'
const CHECK_FLAG = '--check'
const DERIVE_CHECK_ARGV: ReadonlyArray<string> = ['command:derive', CHECK_FLAG]

const derive_check = {
	CHECK_FLAG,
	DERIVE_CHECK_ARGV,
	DERIVE_COMMAND,
}

export { derive_check }
