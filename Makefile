.PHONY: build dist test check fmt lint fmtlint install

build:
	deno task build

dist:
	deno task dist

test:
	deno task test

check:
	deno task check

fmt:
	deno task fmt

lint:
	deno task lint

fmtlint:
	deno task fmtlint

install: dist
	@set -eu; \
		app="/Applications/Helium.app"; \
		if [ ! -d "$$app" ]; then echo "Could not find $$app." >&2; exit 1; fi; \
		open -a "$$app" "chrome://extensions" >/dev/null 2>&1 || true; \
		echo "In Helium, click Load unpacked and select each directory below:"; \
		echo "  $$(pwd)/extension-loupe/dist"; \
		echo "  $$(pwd)/extension-allow-right-click/dist"; \
		echo "  $$(pwd)/extension-youtube-transcript/dist"; \
		echo "Afterwards, run make dist and click refresh in the extensions page."
