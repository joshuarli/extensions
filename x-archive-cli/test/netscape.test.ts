import { describe, expect, it } from "vitest";
import { parseNetscapeCookies } from "../src/deps.ts";

const sample = `# Netscape HTTP Cookie File
.x.com	TRUE	/	TRUE	1893456000	twid	u%3D12345
.x.com	TRUE	/	TRUE	1893456000	ct0	giga
.twitter.com	TRUE	/	TRUE	1893456000	old	nope
.othersite.com	TRUE	/	TRUE	1893456000	twid	u%3D99999
# comment line
bad-line-with-no-tabs
`;

describe("parseNetscapeCookies", () => {
  it("keeps only x.com domain rows with all fields", () => {
    const cookies = parseNetscapeCookies(sample, "x.com");
    expect(cookies).toContainEqual({ name: "twid", value: "u%3D12345" });
    expect(cookies).toContainEqual({ name: "ct0", value: "giga" });
    expect(cookies).toHaveLength(2);
  });
});
