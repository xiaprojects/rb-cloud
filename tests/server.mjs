/*
	This file is part of RB.

	Copyright (C) 2026 XIAPROJECTS SRL

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, version 3.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with this program. If not, see <https://www.gnu.org/licenses/>.

	This source is part of the project RB:
	01 -> Display with Synthetic vision, Autopilot and ADSB
	02 -> Display with SixPack
	03 -> Display with Autopilot, ADSB, Radio, Flight Computer
	04 -> Display with EMS: Engine monitoring system
	05 -> Display with Stratux BLE Traffic
	06 -> Display with Android 6.25" 7" 8" 10" 10.2"
	07 -> Display with Stratux BLE Traffic composed by RB-05 + RB-03 in the same box

	Community edition will be free for all builders and personal use as defined by the licensing model
	Dual licensing for commercial agreement is available
	Please join Discord community
*/

// Local web server for this checkout: the app at /, and /api/ reverse-proxied to an RB-Cloud
// API (production by default), so the app runs on one origin as it does in production.
// Run it to try the app in your browser: `node tests/server.mjs --help` for the options.
// The integration test imports startServer from here. No npm packages: Node 22+.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DEFAULT_API = 'https://app.rbavionics.com/api';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

// Resolves with the listening server. `port` 0 picks a free port. `log`, if given, gets one
// line per API request, with the token masked.
export function startServer({ apiBase = DEFAULT_API, port = 0, host = '127.0.0.1', log } = {}) {
  apiBase = apiBase.replace(/\/+$/, '');
  const server = http.createServer(async (req, res) => {
    const { pathname, search } = new URL(req.url, 'http://localhost');
    try {
      if (pathname.startsWith('/api/')) {
        // The app reads, and deletes flight logs from the logbook; request bodies are not forwarded.
        if (!['GET', 'HEAD', 'DELETE'].includes(req.method)) return void res.writeHead(405).end();
        const started = Date.now();
        const upstream = await fetch(apiBase + pathname.slice('/api'.length) + search, { method: req.method });
        const headers = {};
        for (const name of ['content-type', 'content-disposition']) {
          if (upstream.headers.has(name)) headers[name] = upstream.headers.get(name);
        }
        res.writeHead(upstream.status, headers).end(Buffer.from(await upstream.arrayBuffer()));
        log?.(`${req.method} ${pathname}${search.replace(/(Authorization=)[^&]*/, '$1***')} -> ${upstream.status} (${Date.now() - started} ms)`);
        return;
      }
      const file = path.join(ROOT, decodeURIComponent(pathname), pathname.endsWith('/') ? 'index.html' : '');
      if (!file.startsWith(ROOT + path.sep)) return void res.writeHead(403).end();
      const body = await fs.promises.readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch (e) {
      const missing = e.code === 'ENOENT' || e.code === 'EISDIR';
      if (!missing) console.error(`server: ${pathname}: ${e.cause?.message ?? e.message}`);
      res.writeHead(missing ? 404 : 502, { 'content-type': 'text/plain' }).end(e.message);
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

// ---- Run on its own: serve until Ctrl+C

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const USAGE = `Usage: node tests/server.mjs [options]

Serves this checkout and forwards /api/ to the RB-Cloud API, like production (one origin).
Edit a file and reload the page to see the change. Ctrl+C stops the server.

  --port N      port to listen on (default 8000)
  --host ADDR   address to listen on (default 127.0.0.1; 0.0.0.0 lets a phone or
                tablet on your network open it)
  --api URL     API that /api/ is forwarded to (default ${DEFAULT_API})
`;
  let opts;
  try {
    ({ values: opts } = parseArgs({
      options: {
        port: { type: 'string', default: '8000' },
        host: { type: 'string', default: '127.0.0.1' },
        api: { type: 'string', default: DEFAULT_API },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  try {
    const server = await startServer({ apiBase: opts.api, port: Number(opts.port), host: opts.host, log: console.log });
    const shown = opts.host === '0.0.0.0' ? 'localhost' : opts.host;
    console.log(`App:   http://${shown}:${server.address().port}/\nAPI:   /api/ -> ${opts.api.replace(/\/+$/, '')}\nFiles: ${ROOT}\nCtrl+C to stop.\n`);
  } catch (e) {
    console.error(e.code === 'EADDRINUSE' ? `Port ${opts.port} is already in use; pick another one with --port.` : e.message);
    process.exit(1);
  }
}
