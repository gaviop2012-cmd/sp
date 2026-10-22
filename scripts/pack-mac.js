
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

console.log("Packaging SpotDL Studio for macOS...");
console.log("Automatic publishing is disabled.");

const result = spawnSync(
  process.execPath,
  [
    require.resolve("electron-builder/cli.js"),
    "--mac",
    "dmg",
    "zip",
    "--publish",
    "never",
  ],
  {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES: "true",
    },
    shell: false,
  }
);

if (result.error) {
  console.error("Failed to launch electron-builder:", result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    `macOS packaging failed with exit code ${result.status}`
  );
  process.exit(result.status || 1);
}

console.log("macOS packaging completed successfully.");
console.log("Check the release folder for the DMG and ZIP.");
