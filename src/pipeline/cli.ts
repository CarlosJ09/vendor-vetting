/**
 * CLI for running the pipeline and storing the result.
 *
 *   pnpm ingest data/synthetic/dossier-001
 *   pnpm ingest --corpus data/synthetic --limit 8
 *
 * This is what puts dossiers in front of the UI. It is not the eval: nothing
 * here is scored, and no ground truth is read except the reference date (see
 * below).
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { closeDb, isReachable } from "@/db/client";
import { OllamaProvider } from "@/models/ollama";

import { processFolder } from "./process";

interface Args {
  folders: string[];
  corpusDir?: string;
  limit?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { folders: [] };

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
      case "--limit":
        args.limit = Number(next());
        break;
      case "--help":
      case "-h":
        process.stdout.write(
          [
            "Usage: pnpm ingest [folder...] [options]",
            "",
            "  --corpus <dir>   ingest every dossier-* folder under <dir>",
            "  --limit <n>      with --corpus, ingest only the first n",
            "",
          ].join("\n"),
        );
        process.exit(0);
        break;
      default:
        if (flag.startsWith("-")) throw new Error(`Unknown flag: ${flag}`);
        args.folders.push(path.resolve(process.cwd(), flag));
    }
  }

  return args;
}

/**
 * The reference date a dossier is judged as of.
 *
 * Synthetic dossiers carry their own so a corpus generated today still produces
 * the same verdicts a year from now. Only that one field is read — the expected
 * verdict and the injected defects sitting next to it in the same file are
 * deliberately ignored, because the pipeline must not be able to see the answer.
 */
async function referenceDateFor(folderPath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path.join(folderPath, "ground-truth.json"), "utf8");
    const parsed = JSON.parse(raw) as { referenceDate?: string };
    return parsed.referenceDate;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let folders = args.folders;

  if (args.corpusDir !== undefined) {
    const { readdir } = await import("node:fs/promises");
    const entries = (await readdir(args.corpusDir))
      .filter((entry) => entry.startsWith("dossier-"))
      .sort()
      .slice(0, args.limit);
    folders = [...folders, ...entries.map((entry) => path.join(args.corpusDir!, entry))];
  }

  if (folders.length === 0) {
    throw new Error("Nothing to ingest. Pass a folder or --corpus <dir>.");
  }

  if (!(await isReachable())) {
    throw new Error("Cannot reach the database. Run `pnpm db:up && pnpm db:migrate` first.");
  }

  const provider = new OllamaProvider();
  if (!(await provider.isReachable())) {
    throw new Error(
      `Cannot reach Ollama at ${process.env.OLLAMA_HOST ?? "http://localhost:11434"}. Is \`ollama serve\` running?`,
    );
  }

  const startedAt = Date.now();
  let failures = 0;

  for (const [index, folder] of folders.entries()) {
    const info = await stat(folder).catch(() => null);
    if (info === null || !info.isDirectory()) {
      process.stderr.write(`\n  skipped ${folder}: not a directory\n`);
      failures += 1;
      continue;
    }

    const label = path.basename(folder);
    process.stdout.write(`[${index + 1}/${folders.length}] ${label} ... `);

    try {
      const result = await processFolder({
        folderPath: folder,
        provider,
        referenceDate: await referenceDateFor(folder),
      });

      const review = result.report.reviewQueue.length;
      process.stdout.write(
        `${result.report.overall}` +
          ` (${result.documentCount} docs` +
          (review > 0 ? `, ${review} para revisión` : "") +
          (result.errors.length > 0 ? `, ${result.errors.length} errores` : "") +
          ")\n",
      );
    } catch (error) {
      failures += 1;
      process.stdout.write(`ERROR\n`);
      process.stderr.write(`      ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  process.stdout.write(`\nDone in ${elapsed}s. ${failures} failed.\n`);

  await closeDb();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  await closeDb();
  process.exit(1);
});
