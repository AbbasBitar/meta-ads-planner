import { mkdir, copyFile, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/src", { recursive: true });

for (const file of ["index.html", "app.js", "styles.css"]) {
  await copyFile(file, `dist/${file}`);
}

await copyFile("src/intake.js", "dist/src/intake.js");

console.log("ChatGPT campaign prompt app copied to dist/");
