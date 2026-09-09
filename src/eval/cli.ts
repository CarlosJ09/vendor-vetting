/**
 * CLI for the evaluation harness.
 *
 *   pnpm eval
 *   pnpm eval --limit 5
 *   pnpm eval --rate-in 3 --rate-out 15
 *
 * Cost projection takes explicit rates rather than a built-in price table.
 * Hardcoding a provider's prices would bake in a number that silently goes stale
 * and would be a fabricated figure in a published report the moment it changed.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { OllamaProvider } from "@/models/ollama";

import { renderMarkdown } from "./report";
import { runEval } from "./run";

const DEFAULT_CORPUS = "data/synthetic";
const DEFAULT_OUT = "eval-results";

interface Args {
  corpusDir: string;
  outDir: string;
  limit?: number;
  rates?: { inputPerMillion: number; outputPerMillion: number };
  write: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    corpusDir: path.resolve(process.cwd(), DEFAULT_CORPUS),
    outDir: path.resolve(process.cwd(), DEFAULT_OUT),
    write: true,
  };

  let rateIn: number | undefined;
  let rateOut: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} requires a value`);
      return value;
    };

    switch (flag) {
      case "--corpus":
        args.corpusDir = path.resolve(process.cwd(), next());
        break;
      case "--out":
        args.outDir = path.resolve(process.cwd(), next());
        break;
      case "--limit":
        args.limit = Number(next());
        break;
      case "--rate-in":
        rateIn = Number(next());
        break;
      case "--rate-out":
        rateOut = Number(next());
        break;
      case "--no-write":
        args.write = false;
        break;
      case "--help":
      case "-h":
        process.stdout.write(
          [
            "Usage: pnpm eval [options]",
            "",
            "  --corpus <dir>     corpus directory (default data/synthetic)",
            "  --out <dir>        results directory (default eval-results)",
            "  --limit <n>        evaluate only the first n dossiers",
            "  --rate-in <usd>    USD per million input tokens, for the cost projection",
            "  --rate-out <usd>   USD per million output tokens",
            "  --no-write         print the report without writing files",
            "",
          ].join("\n"),
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }

  if ((rateIn === undefined) !== (rateOut === undefined)) {
    throw new Error("--rate-in and --rate-out must be supplied together");
  }
  if (rateIn !== undefined && rateOut !== undefined) {
    args.rates = { inputPerMillion: rateIn, outputPerMillion: rateOut };
  }

  return args;
}

/** Filesystem-safe slug for a model tag like `qwen2.5:7b`. */
function slug(model: string): string {
  return model.replace(/[^a-z0-9.]+/gi, "-").replace(/^-|-$/g, "");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const provider = new OllamaProvider();

  if (!(await provider.isReachable())) {
    throw new Error(
      `Cannot reach Ollama at ${process.env.OLLAMA_HOST ?? "http://localhost:11434"}. Is \`ollama serve\` running?`,
    );
  }

  process.stdout.write(
    `Evaluating with ${provider.textModel} (text) and ${provider.visionModel} (vision)\n`,
  );

  const startedAt = Date.now();

  const report = await runEval({
    corpusDir: args.corpusDir,
    provider,
    limit: args.limit,
    rates: args.rates,
    onProgress: (done, total, id) => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const eta = done === 0 ? 0 : (elapsed / done) * (total - done);
      process.stdout.write(
        `\r  [${String(done).padStart(3)}/${total}] ${id}  ${elapsed.toFixed(0)}s elapsed, ~${eta.toFixed(0)}s left   `,
      );
    },
  });

  process.stdout.write("\n\n");

  const markdown = renderMarkdown(report);
  process.stdout.write(markdown);

  if (args.write) {
    await mkdir(args.outDir, { recursive: true });
    /*
     * Timestamped to the minute, not just the day. Two runs of the same model
     * on the same date previously collided on one filename, and the second
     * silently overwrote the first — destroying exactly the before/after pair
     * that makes a fix worth writing up.
     */
    const stamp = report.generatedAt.slice(0, 16).replace("T", "-").replace(":", "");
    const base = `${stamp}-${slug(report.textModel)}`;
    const mdPath = path.join(args.outDir, `${base}.md`);
    const jsonPath = path.join(args.outDir, `${base}.json`);

    await writeFile(mdPath, markdown);
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

    process.stdout.write(`\nWritten:\n  ${mdPath}\n  ${jsonPath}\n`);
  }

  // A false pass is the failure this harness exists to surface, so it is also
  // the thing that makes the command fail in CI.
  process.exit(report.verdicts.falsePasses.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
