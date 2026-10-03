.PHONY: build dist test check lint install

build:
	pnpm run build

dist:
	pnpm run dist

test:
	pnpm run test

check:
	pnpm run check

lint:
	pnpm run lint

install: dist
	@set -eu; \
		app="/Applications/Helium.app"; \
		if [ ! -d "$$app" ]; then echo "Could not find $$app." >&2; exit 1; fi; \
		open -a "$$app" "chrome://extensions" >/dev/null 2>&1 || true; \
		echo "In Helium, click Load unpacked and select each directory below:"; \
		echo "  $$(pwd)/dist/extension-loupe"; \
		echo "  $$(pwd)/dist/extension-allow-right-click"; \
		echo "  $$(pwd)/dist/extension-youtube-transcript"; \
		echo "Afterwards, run make dist and click refresh in the extensions page."
