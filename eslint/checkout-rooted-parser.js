import ts from 'typescript-eslint'

// joshuafolkken/kit#2435: ESLint keys every cache entry on the file's content hash **and** a hash of
// the serialized config (`hashOfConfig`). typescript-eslint needs `tsconfigRootDir` as an absolute
// path, and carried in `parserOptions` it put the checkout's location into that hash: a lane at
// `.kit-lanes/<N>/` and the primary checkout hashed the same config differently, so every entry the
// lane warm-up (joshuafolkken/kit#1849) or the per-tool sync (joshuafolkken/kit#2060) carried across
// missed, and a lane's first gate re-linted every file.
//
// **The root directory travels inside the parser instead.** ESLint serializes a parser by its
// `meta` name and version alone, so a parser that supplies `tsconfigRootDir` itself keeps the path
// out of the hash while typescript-eslint still receives it. Leaving it out is sound: the checkout
// root decides where the files are, not how they are linted.
//
// It is a parser rather than a `toJSON` on `parserOptions` because ESLint's config merge replaces,
// instead of deep-merging, any `languageOptions` object that holds a function — a consumer block that
// set one more parser option for `.ts` files would have dropped `project` and the root with it.
// `parserOptions` stays plain data here, so it merges exactly as before, and a `tsconfigRootDir` a
// consumer sets there explicitly still wins.
//
// Only the location leaves the hash. Every parser option stays in it, the parser's version stays in
// it, and so does joshuafolkken/kit#1347's rule fingerprint, which lives in `settings`.

const META = { name: 'kit/checkout-rooted-typescript-parser', version: ts.parser.meta?.version }

function create(checkout_root) {
	function parseForESLint(code, options) {
		return ts.parser.parseForESLint(code, { tsconfigRootDir: checkout_root, ...options })
	}

	return { meta: META, parseForESLint }
}

export const checkout_rooted_parser = { create }
