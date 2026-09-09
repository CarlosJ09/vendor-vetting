/**
 * CLI for the synthetic corpus generator.
 *
 *   pnpm synth
 *   pnpm synth --count 10 --seed 7 --out data/scratch
 *   pnpm synth --defective-ratio 1.0
 *
 * Lives under `src/synth` rather than a top-level `scripts/` directory to keep
 * the repo root as small as the project brief asks for.
 */

import path from "node:path";
import process from "node:process";

import { DEFAULT_OPTIONS, generateCorpus, type GenerateOptions } from "./generate";

const DEFAULT_OUT_DIR = "data/synthetic";

function parseArgs(argv: string[]): GenerateOptions {
  const options: GenerateOptions = {
    ...DEFAULT_OPTIONS,
    outDir: path.resolve(process.cwd(), DEFAULT_OUT_DIR),
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];

    const requireValue = (): string => {
      if (value === undefined) throw new Error(`${flag} requires a value`);
      i++;
      return value;
    };

    switch (flag) {
      case "--count":
        options.count = Number(requireValue());
        break;
      case "--seed":
        options.seed = Number(requireValue());
        break;
      case "--defective-ratio":
        options.defectiveRatio = Number(requireValue());
        break;
      case "--out":
        options.outDir = path.resolve(process.cwd(), requireValue());
        break;
      case "--no-clean":
        options.clean = false;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }

  if (!Number.isInteger(options.count) || options.count <= 0) {
    throw new Error(`--count must be a positive integer, got ${options.count}`);
  }
  if (!Number.isFinite(options.seed)) {
    throw new Error(`--seed must be a number, got ${options.seed}`);
  }
  if (options.defectiveRatio < 0 || options.defectiveRatio > 1) {
    throw new Error(`--defective-ratio must be within [0, 1], got ${options.defectiveRatio}`);
  }

  return options;
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm synth [options]",
      "",
      "  --count <n>              dossiers to generate (default 40)",
      "  --seed <n>               corpus seed; same seed, same corpus (default 20260615)",
      "  --defective-ratio <0-1>  fraction carrying a defect (default 0.4)",
      "  --out <dir>              output directory (default data/synthetic)",
      "  --no-clean               keep existing files in the output directory",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  process.stdout.write(
    `Generating ${options.count} dossiers (seed ${options.seed}, ${Math.round(options.defectiveRatio * 100)}% defective)\n`,
  );
  const startedAt = Date.now();

  const summary = await generateCorpus(options, (done, total, id) => {
    process.stdout.write(`\r  [${String(done).padStart(3)}/${total}] ${id}   `);
  });

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  process.stdout.write(`\r  ${summary.count} dossiers written in ${seconds}s\n\n`);

  process.stdout.write(`  output      ${options.outDir}\n`);
  process.stdout.write(`  clean       ${summary.clean}\n`);
  process.stdout.write(`  defective   ${summary.defective}\n\n`);

  process.stdout.write("  expected verdicts\n");
  for (const [verdict, n] of Object.entries(summary.verdictCounts).sort()) {
    process.stdout.write(`    ${verdict.padEnd(12)} ${n}\n`);
  }

  process.stdout.write("\n  defects injected\n");
  const defects = Object.entries(summary.defectCounts).sort((a, b) => b[1] - a[1]);
  if (defects.length === 0) {
    process.stdout.write("    (none)\n");
  }
  for (const [kind, n] of defects) {
    process.stdout.write(`    ${kind.padEnd(28)} ${n}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
