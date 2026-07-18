<img src=https://github.com/RFbkak37y3kIY/webshark/assets/1423657/e769fcbf-d83b-4d07-8e86-c9b5706ad5ee width=180>

# webshark-ng

**webShark** is a *Wireshark-like* webapp powered by [sharkd](https://wiki.wireshark.org/Development/sharkd) and all its dissectors 🕵️

<img src="https://github.com/QXIP/webshark/assets/1423657/092c2544-f5db-4a79-b3da-d48df4e0813c" width=600 />

> Client-Side RTP playback powered by WASM/ffmpeg 🚀

<br>

## Instructions
Mount your PCAP content directory to location `/captures` and launch webshark

#### Run with Compose
```
docker-compose up -d
```
#### Run Manually
```
docker run -ti --rm -p 8085:8085 -v $(pwd)/captures:/captures ghcr.io/qxip/webshark:latest
```
#### Usage
Browse to your webshark-ng instance, ie: `http://localhost:8085/webshark`

#### Live capture updates
When the opened capture file grows (e.g. a capture being written by
`tcpdump -w` / `dumpcap`), the UI picks up the new packets automatically —
no page reload needed, and only the new frames are fetched from sharkd
(`frames` with `skip`). If the file is replaced or truncated, the full
packet list is reloaded instead.

How it works:
- the API exposes `GET /webshark/watch?capture=<file>`, a Server-Sent Events
  stream that emits `capture-changed` events when the file changes (stat
  polling, interval configurable with the `WATCH_INTERVAL_MS` env var);
- `web/live-update.js` subscribes to that stream and appends the new frames
  to the packet list and packet-length chart. Since the UI in `web/` is a
  prebuilt bundle, the shim is handed the app's internals by two tiny hooks
  (`window.__wsLive.svc(this)` / `window.__wsLive.comp(this)`) injected into
  the minified `main.*.js` — the Dockerfile re-applies those hooks (and the
  `live-update.js` script tag) to the UI bundle it downloads at build time.

<br>

#### Credits
> This program is free software based on a fork of GPLv2 [webshark](https://bitbucket.org/jwzawadzki/webshark) by [Jakub Zawadzki](https://bitbucket.org/jwzawadzki) and sponsored by [qxip](https://github.com/QXIP)

> Dissections powered by tshark [sharkd](https://wiki.wireshark.org/Development/sharkd) from Wireshark Project. See [LICENSE](https://github.com/QXIP/node-webshark/blob/master/LICENSE) for details
