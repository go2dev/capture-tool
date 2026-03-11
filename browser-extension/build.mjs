import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const commonOptions = {
  bundle: true,
  sourcemap: false,
  target: "chrome120",
  outdir: "dist",
  logLevel: "info",
};

const entrypoints = [
  {
    entryPoints: ["src/background.ts"],
    format: "esm",
  },
  {
    entryPoints: ["src/content.ts"],
    format: "iife",
  },
  {
    entryPoints: ["src/popup.ts"],
    format: "iife",
  },
];

async function main() {
  for (const entry of entrypoints) {
    const options = { ...commonOptions, ...entry };

    if (watch) {
      const ctx = await esbuild.context(options);
      await ctx.watch();
      console.log(`Watching ${entry.entryPoints.join(", ")}...`);
    } else {
      await esbuild.build(options);
    }
  }

  if (!watch) {
    console.log("Build complete.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
