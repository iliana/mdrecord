/* eslint-disable no-param-reassign */
/* eslint-disable import/prefer-default-export */

import { IAudioMetadata } from "music-metadata";
// eslint-disable-next-line import/extensions
import { encodeToSJIS, sanitizeHalfWidthTitle } from "netmd-js/dist/utils.js";
import { DiscAddress, isValidFragment, ToC } from "netmd-tocmanip";

function groups({ cluster, sector, group }: DiscAddress) {
  return (cluster * 32 + sector) * 11 + group;
}

function ungroups(group: number): DiscAddress {
  const cluster = Math.floor(group / (32 * 11));
  const rem = group % (32 * 11);
  const sector = Math.floor(rem / 11);
  return {
    cluster,
    sector,
    group: rem % 11,
  };
}

function freeTitleSlots(toc: ToC) {
  const cells = new Set(toc.titleMap.map((_, idx) => idx));
  // always mark cell 0 as used
  cells.delete(0);

  for (let cell of toc.titleMap) {
    do {
      cells.delete(cell);
      cell = toc.titleCellList[cell].link;
    } while (cell !== 0);
  }

  return [...cells];
}

function allocateTitle(toc: ToC, unicodeTitle: string) {
  // This is pretty obnoxious because TitleCell wants the title to be a string, even though it's
  // going to call `String.charCodeAt` on all the characters...
  const newTitle = new Uint8Array([
    ...encodeToSJIS(sanitizeHalfWidthTitle(unicodeTitle)),
    0,
  ]);
  const availableCells = freeTitleSlots(toc);
  const titleStartSlot = availableCells[0];

  for (let x = 0; x < newTitle.length; x += 7) {
    const slot = availableCells.shift();
    if (slot === undefined) {
      throw new Error("out of title cells!");
    }
    [toc.nextFreeTitleSlot] = availableCells;

    toc.titleCellList[slot] = {
      title: String.fromCharCode(...newTitle.slice(x, x + 7)).padEnd(7, "\x00"),
      link: x + 7 >= newTitle.length ? 0 : toc.nextFreeTitleSlot,
    };
  }

  return titleStartSlot;
}

export function splitTrack(
  toc: ToC,
  startingTrackNumber: number,
  files: { metadata: IAudioMetadata }[]
) {
  function track(n: number) {
    return toc.trackFragmentList[toc.trackMap[n]];
  }

  const { start, mode, end } = track(startingTrackNumber);
  let totalDuration = 0;
  let currentTrack = startingTrackNumber;

  for (const [idx, { metadata }] of files.entries()) {
    if (metadata.common.title) {
      toc.titleMap[currentTrack] = 0; // "deallocate" the current title
      toc.titleMap[currentTrack] = allocateTitle(toc, metadata.common.title);
    }

    if (idx < files.length - 1) {
      if (metadata.format.duration === undefined) {
        throw new Error(
          "track has undefined duration, and we didn't catch it earlier"
        );
      }
      totalDuration += metadata.format.duration;
      const splitAt =
        groups(start) + Math.round((totalDuration * 44100) / 512) * 2;

      track(currentTrack).end = ungroups(splitAt - 1);

      const nextTrack = toc.trackMap.findIndex((x) => x === 0);
      toc.trackMap[nextTrack] = toc.nextFreeTrackSlot;
      Object.assign(track(nextTrack), {
        start: ungroups(splitAt),
        mode,
        end,
        link: 0,
      });

      toc.nTracks += 1;
      toc.nextFreeTrackSlot = toc.trackFragmentList.findIndex(
        (frag, index) => index > 0 && !isValidFragment(frag)
      );

      currentTrack = nextTrack;
    }
  }
}
