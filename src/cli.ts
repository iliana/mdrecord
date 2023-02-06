import child_process from "node:child_process";
import { rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearLine } from "node:readline";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { program } from "commander";
import { resolve } from "import-meta-resolve";
import { parseFile } from "music-metadata";
import {
  DevicesIds,
  download,
  MDTrack,
  openNewDevice,
  Wireformat,
} from "netmd-js";
// eslint-disable-next-line import/extensions
import { makeGetAsyncPacketIteratorOnWorkerThread } from "netmd-js/dist/node-encrypt-worker.js";
import { WebUSB } from "usb";

let tempdir: string;

function spawn(command: string, args?: readonly string[]) {
  const { status, signal, error } = child_process.spawnSync(command, args);
  if (error !== undefined) {
    throw error;
  }
  if (status !== 0) {
    throw new Error(
      `command ${[command, ...(args ?? [])].join(" ")} exited with ${
        status === null ? `signal ${signal}` : `status code ${status}`
      }`
    );
  }
}

async function main() {
  const encryptWorkerPath = fileURLToPath(
    await resolve("netmd-js/dist/node-encrypt-worker.js", import.meta.url)
  );

  program.option("--gapless").argument("<files...>").parse();
  const { gapless } = program.opts();
  if (gapless) {
    throw new Error("gapless not yet implemented");
  }

  tempdir = await fs.mkdtemp(path.join(os.tmpdir(), "mdrecord-"));
  const files = await Promise.all(
    program.args.map(async (inputPath, i) => ({
      inputPath,
      rawPath: path.join(tempdir, `${i}.raw`),
      metadata: await parseFile(inputPath),
    }))
  );

  const netmdInterface = await openNewDevice(
    new WebUSB({
      allowedDevices: DevicesIds,
      deviceTimeout: 1000000,
    })
  );
  if (netmdInterface === null) {
    throw new Error("NetMD device not found");
  }

  // TODO: check that the requested files will fit on the dang disc

  await Promise.all(
    files.map(async ({ inputPath, rawPath }) => {
      spawn("ffmpeg", [
        "-i",
        inputPath,
        "-ac",
        "2",
        "-ar",
        "44100",
        "-f",
        "s16be",
        rawPath,
      ]);
    })
  );

  process.stderr.write("erasing disc... ");
  await netmdInterface.eraseDisc();
  process.stderr.write("done\n");

  for (const [index, { rawPath, metadata }] of files.entries()) {
    const title = metadata.common.title || `Track ${index + 1}`;
    process.stderr.write(`${title}... `);
    // eslint-disable-next-line no-await-in-loop
    const data = await fs.readFile(rawPath);
    const mdTrack = new MDTrack(
      title,
      Wireformat.pcm,
      data.buffer,
      0x400,
      "",
      makeGetAsyncPacketIteratorOnWorkerThread(new Worker(encryptWorkerPath))
    );
    // eslint-disable-next-line no-await-in-loop
    await download(netmdInterface, mdTrack, ({ writtenBytes, totalBytes }) => {
      process.stderr.write(`\r${title}... ${writtenBytes}/${totalBytes}`);
    });
    clearLine(process.stderr, 0);
    process.stderr.write(`\r${title}... done\n`);
  }

  if (files[0].metadata.common.album !== undefined) {
    process.stderr.write("setting disc title... ");
    await netmdInterface.setDiscTitle(files[0].metadata.common.album);
    process.stderr.write("done\n");
  }
}

process.on("exit", () => {
  if (tempdir !== undefined) {
    rmSync(tempdir, { recursive: true, force: true });
  }
});

main()
  .then(() => process.exit())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
