.PHONY: build dist test coverage check lint install mutants-diff

build:
	pnpm run build

dist:
	pnpm run dist

test:
	pnpm run typecheck
	pnpm run test $(TEST_ARGS)

coverage:
	pnpm run test --coverage $(TEST_ARGS)

mutants-diff:
	node scripts/mutants-diff.mjs "$${BASE:-origin/main}" "$${MUTANTS_SCOPE:-}"

check:
	pnpm run check

lint:
	pnpm run typecheck
	pnpm run lint

install: dist
	@set -eu; \
		app="/Applications/Helium.app"; \
		if [ ! -d "$$app" ]; then echo "Could not find $$app." >&2; exit 1; fi; \
		open -a "$$app" "chrome://extensions" >/dev/null 2>&1 || true; \
		echo "In Helium, click Load unpacked and select:"; \
		echo "  $$(pwd)/dist/extension-suite"; \
		echo "Afterwards, run make dist and click reload in the extensions page."

bench:
	node scripts/bench.mjs $(BENCH_ARGS)

bench-check:
	node scripts/bench.mjs --check $(BENCH_ARGS)

bench-list:
	node scripts/bench.mjs --list
