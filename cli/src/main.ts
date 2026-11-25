import { main as chatgptMain } from "../../chatgpt-archive-cli/src/main.ts";
import { main as onefileMain } from "../../onefile-cli/src/main.ts";
import { main as xMain } from "../../x-archive-cli/src/main.ts";
import { main as youtubeMain } from "../../youtube-transcript-cli/src/main.ts";

const COMMANDS: Record<string, { description: string; run: (argv: readonly string[]) => Promise<number> }> = {
  x: { description: "archive X bookmarks, likes and profiles", run: xMain },
  onefile: { description: "save a page as a .u.zip.html archive", run: onefileMain },
  youtube: { description: "fetch a YouTube transcript or SRT", run: youtubeMain },
  chatgpt: { description: "archive ChatGPT conversations", run: chatgptMain },
};

const USAGE = `tools — terminal tools for the browser extensions

Usage:
  tools <command> [args...]

Commands:
${Object.entries(COMMANDS).map(([name, command]) => `  ${name.padEnd(8)} ${command.description}`).join("\n")}
  help     show this help

Run \`tools <command> --help\` for a command's options.
`;

export async function main(argv: readonly string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === "help" || name === "--help" || name === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (name === "--version" || name === "-v") {
    process.stdout.write("tools 0.1.0\n");
    return 0;
  }
  const command = COMMANDS[name];
  if (!command) {
    process.stderr.write(`tools: unknown command "${name}"\n${USAGE}`);
    return 2;
  }
  return command.run(rest);
}
