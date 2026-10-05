---
name: joserah-node-ts-strip
description: Use when writing or reviewing TypeScript under server/ in the Joserah repo, or when Node refuses to run a .ts file, or tsc and Node disagree.
---

# TypeScript run by Node's type stripping

`server/` is TypeScript that Node ≥ 22.18 runs directly (`node server/main.ts`). There is no build.
Node only *erases* types, so only erasable syntax is allowed (`erasableSyntaxOnly` in tsconfig):

- No `enum` (use a `const` array and a union type: `const JOB_TYPES = [...] as const; type JobType = typeof JOB_TYPES[number]`).
- No `namespace`, no decorators, no parameter properties (`constructor(private x: T)` is a syntax error; declare the field, assign it).
- Every relative import carries `.ts`: `import { Store } from './store.ts'`.
- Type-only imports use `import type { Engine } from './engine.ts'` (`verbatimModuleSyntax`); a value import of a type is an error at run time.
- Private state uses `#field` (plain JavaScript, erasable).
- Node refuses TypeScript inside `node_modules`; never publish or import `.ts` from a package.
- Reaching the zero-dependency CommonJS tools: `createRequire(import.meta.url)` in `server/src/cjs.ts`, typed there once.
- `import.meta.dirname` is the module's folder (Node ≥ 20.11).

Check: `npx --prefix server tsc -p server/tsconfig.json` must print nothing and exit 0; `server/test/typecheck.test.ts` runs it inside the suite.
Tests: `node --test --test-concurrency=1 "server/test/*.test.ts"` — one file at a time, because job tests spawn processes and git.
