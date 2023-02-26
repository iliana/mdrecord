import child_process from "node:child_process";
import { rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearLine } from "node:readline";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { resolve } from "import-meta-resolve";
import { parseFile } from "music-metadata";
import {
  ExploitStateManager,
  ForceTOCEdit,
  isCompatible,
} from "netmd-exploits";
import {
  DevicesIds,
  download,
  MDTrack,
  NetMDInterface,
  openNewDevice,
  readUTOCSector,
  Wireformat,
  writeUTOCSector,
} from "netmd-js";
// eslint-disable-next-line import/extensions
import { makeGetAsyncPacketIteratorOnWorkerThread } from "netmd-js/dist/node-encrypt-worker.js";
// eslint-disable-next-line import/extensions
import { parseTOC, reconstructTOC } from "netmd-tocmanip";
import { WebUSB } from "usb";
import { splitTrack } from "./toc.js";

let tempdir: string;

function convertRaw(input: string[], output: string) {
  const args = [];
  const filterInput = [];
  for (const file of input) {
    args.push("-i", file);
    filterInput.push(`[${filterInput.length}:a:0]`);
  }
  args.push(
    "-filter_complex",
    `${filterInput.join("")}concat=n=${input.length}:v=0:a=1[out]`
  );
  args.push("-map", "[out]");
  args.push("-ac", "2", "-ar", "44100", "-f", "s16be", output);
  const { status, signal, error } = child_process.spawnSync("ffmpeg", args, {
    stdio: "ignore",
  });
  if (error !== undefined) {
    throw error;
  }
  if (status !== 0) {
    throw new Error(
      `command ffmpeg ${args.join(" ")} exited with ${
        status === null ? `signal ${signal}` : `status code ${status}`
      }`
    );
  }
}

async function readRaw(file: string) {
  const data = await fs.readFile(file);
  const padding = (2048 - (data.length % 2048)) % 2048;
  return Buffer.concat([data, Buffer.alloc(padding)]);
}

async function writeTrack(
  netmdInterface: NetMDInterface,
  data: Buffer,
  title: string
) {
  const encryptWorkerPath = fileURLToPath(
    await resolve("netmd-js/dist/node-encrypt-worker.js", import.meta.url)
  );

  const progressPrefix = title || "writing track";
  process.stderr.write(`${progressPrefix}... `);

  const mdTrack = new MDTrack(
    title,
    Wireformat.pcm,
    data.buffer,
    0x400,
    "",
    makeGetAsyncPacketIteratorOnWorkerThread(new Worker(encryptWorkerPath))
  );
  const [track] = await download(
    netmdInterface,
    mdTrack,
    ({ writtenBytes, totalBytes }) => {
      process.stderr.write(
        `\r${progressPrefix}... ${writtenBytes}/${totalBytes}`
      );
    }
  );
  clearLine(process.stderr, 0);
  process.stderr.write(`\r${progressPrefix}... done\n`);

  // this is always a number but typescript decided the type output of `download` is
  // (string | number)[] instead of [number, string, string]
  return track as number;
}

export default async function main(
  tracks: string[],
  { erase, gapless }: { erase?: true; gapless?: true }
) {
  tempdir = await fs.mkdtemp(path.join(os.tmpdir(), "mdrecord-"));
  const gaplessRawPath = path.join(tempdir, "gapless.raw");
  const files = await Promise.all(
    tracks.map(async (inputPath, i) => ({
      inputPath,
      rawPath: path.join(tempdir, `${i}.raw`),
      metadata: await parseFile(inputPath),
    }))
  );
  if (gapless) {
    files.forEach(({ inputPath, metadata }) => {
      if (metadata.format.duration === undefined) {
        throw new Error(
          `could not determine duration of ${inputPath}, which is required in gapless mode`
        );
      }
    });
  }

  const netmdInterface = await openNewDevice(
    new WebUSB({
      allowedDevices: DevicesIds,
      deviceTimeout: 1000000,
    })
  );
  if (netmdInterface === null) {
    throw new Error("NetMD device not found");
  }
  const tempConsole = console.log;
  console.log = () => {};
  const exploitStateManager = gapless
    ? await ExploitStateManager.create(netmdInterface)
    : null;
  if (
    exploitStateManager &&
    !isCompatible(ForceTOCEdit, exploitStateManager.device)
  ) {
    throw new Error(
      "gapless mode requested, but there is no ForceTOCEdit exploit for this device"
    );
  }
  console.log = tempConsole;

  // TODO: check that the requested files will fit on the dang disc
  // const [, capacity] = await netmdInterface.getDiscCapacity();
  // const minutes = capacity[0] * 60 + capacity[1];
  // const seconds = minutes * 60 + capacity[2];
  // const maxSamples = Math.floor((seconds * 44100) / 512 + capacity[3]) * 512;
  // console.log(maxSamples);

  if (gapless) {
    convertRaw(
      files.map(({ inputPath }) => inputPath),
      gaplessRawPath
    );
  } else {
    await Promise.all(
      files.map(async ({ inputPath, rawPath }) => {
        convertRaw([inputPath], rawPath);
      })
    );
  }

  if (erase) {
    process.stderr.write("erasing disc... ");
    await netmdInterface.eraseDisc();
    process.stderr.write("done\n");
  }

  if (exploitStateManager) {
    const data = await readRaw(gaplessRawPath);
    const track = (await writeTrack(netmdInterface, data, "")) + 1;

    const factoryInterface = exploitStateManager.factoryIface;
    const sector0 = await readUTOCSector(factoryInterface, 0);
    const toc = parseTOC(sector0);
    splitTrack(toc, track, files);
    const binToc = reconstructTOC(toc);
    for (const [idx, sector] of binToc.entries()) {
      if (sector) {
        console.log(`writing UTOC sector ${idx}`);
        // eslint-disable-next-line no-await-in-loop
        await writeUTOCSector(factoryInterface, idx, sector);
      }
    }

    console.log("waiting for ForceTOCEdit exploit...");
    await (await exploitStateManager.require(ForceTOCEdit)).forceTOCEdit();
    console.log("##################################################");
    console.log("## You must reset the player by taking out the  ##");
    console.log("## batteries to keep the tracks split correctly ##");
    console.log("##################################################");
  } else {
    for (const { rawPath, metadata } of files) {
      const title = metadata.common.title || "";
      // eslint-disable-next-line no-await-in-loop
      await writeTrack(netmdInterface, await readRaw(rawPath), title);
    }

    if (files[0].metadata.common.album !== undefined) {
      process.stderr.write("setting disc title... ");
      await netmdInterface.setDiscTitle(files[0].metadata.common.album);
      process.stderr.write("done\n");
    }
  }
}

process.on("exit", () => {
  if (tempdir !== undefined) {
    rmSync(tempdir, { recursive: true, force: true });
  }
});
