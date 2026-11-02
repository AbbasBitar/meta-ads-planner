import { mkdir, copyFile, cp, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/src", { recursive: true });

for (const file of ["index.html", "app.js", "config.js", "styles.css"]) {
  await copyFile(file, `dist/${file}`);
}

await cp("src", "dist/src", { recursive: true });

console.log("Frontend assets copied to dist/");
