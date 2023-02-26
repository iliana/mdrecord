This is a personal tool for recording MiniDiscs via NetMD. You may find it useful as a reference for working with [netmd-js](https://github.com/cybercase/netmd-js), [netmd-exploits](https://github.com/asivery/netmd-exploits), and [netmd-tocmanip](https://github.com/asivery/netmd-tocmanip).

## Usage

```
Usage: npm run cli -- [options] <tracks...>
```

Records `<tracks...>` to a MiniDisc, setting titles if the files have track names in their metadata.

- `--erase`: Erase the disc before recording tracks. (Leaving this off appends tracks.)
- `--gapless`: Record the tracks gaplessly, if possible, by recording a single track and then manipulating the UTOC as if track marks were inserted. This relies on factory mode and the [ForcedTOCEdit](https://github.com/asivery/netmd-exploits) exploit, which will probably only work on Sony recorders.
- `--set-disc-title`: Also set the disc title based on the album name of the first track.

## Caveats

This was tested on my Sony MZ-N707. Apart from `--gapless` mode, the tool is a small wrapper around a well-tested subset of [Web MiniDisc Pro](https://web.minidisc.wiki/). `--gapless` mode directly modifies the UTOC and may cause some problems with your recorders or players.

**_As far as the law allows, this software comes as is,
without any warranty or condition, and no contributor
will be liable to anyone for any damages related to this
software or this license, under any kind of legal claim._**
