.PHONY: build dist test check install

build:
	pnpm run build

dist:
	pnpm run dist

test:
	pnpm run test

check:
	pnpm run check

install: dist
	@set -eu; \
		app="/Applications/Helium.app"; \
		if [ ! -d "$$app" ]; then echo "Could not find $$app." >&2; exit 1; fi; \
		open -a "$$app" "chrome://extensions" >/dev/null 2>&1 || true; \
		echo "In Helium, click Load unpacked and select:"; \
		echo "  $$(pwd)/dist/extension-suite"; \
		echo "Afterwards, run make dist and click reload in the extensions page."
