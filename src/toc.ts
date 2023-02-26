/* eslint-disable no-param-reassign */
/* eslint-disable import/prefer-default-export */

import { IAudioMetadata } from "music-metadata";
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

function track(toc: ToC, n: number) {
  return toc.trackFragmentList[toc.trackMap[n]];
}

export function splitTrack(
  toc: ToC,
  startingTrackNumber: number,
  files: { metadata: IAudioMetadata }[]
) {
  const { start, mode, end } = track(toc, startingTrackNumber);
  let totalDuration = 0;
  let currentTrack = startingTrackNumber;

  for (const { metadata } of files.slice(0, -1)) {
    if (metadata.format.duration === undefined) {
      throw new Error(
        "track has undefined duration, and we didn't catch it earlier"
      );
    }
    totalDuration += metadata.format.duration;
    const splitAt =
      groups(start) + Math.round((totalDuration * 44100) / 512) * 2;

    track(toc, currentTrack).end = ungroups(splitAt - 1);

    const nextTrack = toc.trackMap.findIndex((x) => x === 0);
    toc.trackMap[nextTrack] = toc.nextFreeTrackSlot;
    Object.assign(track(toc, nextTrack), {
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
