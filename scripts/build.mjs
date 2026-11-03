import { mkdir, copyFile, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/src", { recursive: true });

for (const file of ["index.html", "app.js", "config.js", "styles.css"]) {
  await copyFile(file, `dist/${file}`);
}

await copyFile("src/intake.js", "dist/src/intake.js");
await copyFile("src/preflight.js", "dist/src/preflight.js");
await writeFile("dist/src/planner.js", "export { required, validPostUrl, validate, calculateBudget } from './intake.js';\n");

console.log("Frontend assets copied to dist/");
