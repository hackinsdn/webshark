'use strict'
const fs = require('fs');
const fetch = import("node-fetch");
const sharkd_dict = require('../custom_module/sharkd_dict');
const CAPTURES_PATH = process.env.CAPTURES_PATH || "/captures/";
const url_re = /^https?:\/\//
const WATCH_INTERVAL_MS = parseInt(process.env.WATCH_INTERVAL_MS || "1000");
const WATCH_HEARTBEAT_MS = 30000;

const download = function(url, dest, cb) {
  var file = fs.createWriteStream(dest);
  var request = http.get(url, function(response) {
    response.pipe(file);
    file.on('finish', function() {
      file.close(cb);  // close() is async, call cb after close completes.
    });
  });
}


module.exports = function (fastify, opts, next) {

  fastify.register(require('@fastify/static'), {
    root: CAPTURES_PATH,
    prefix: '/webshark//', // defeat unique prefix
  })

  fastify.get('/', async (req, res) => {
    res.redirect('/webshark');
  });

  // Server-Sent Events endpoint: watches a capture file and notifies the
  // client whenever it changes, so the UI can fetch only the new frames
  // without a page reload.
  fastify.get('/webshark/watch', function (request, reply) {
    let capture = (request.query && request.query.capture) || '';
    if (capture === '' || capture.includes('..')) {
      reply.code(400).send(JSON.stringify({"err": 1, "errstr": "Nope"}));
      return;
    }
    if (capture.startsWith("/")) {
      capture = capture.substr(1);
    }
    const cap_file = CAPTURES_PATH + capture;
    if (fs.existsSync(cap_file) === false) {
      reply.code(404).send(JSON.stringify({"err": 1, "errstr": "Nope"}));
      return;
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');

    const send_event = function (event, data) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const init_stats = fs.statSync(cap_file);
    send_event('capture-status', {size: init_stats.size, mtime: init_stats.mtimeMs});

    const listener = function (curr, prev) {
      if (curr.size !== prev.size || curr.mtimeMs !== prev.mtimeMs) {
        send_event('capture-changed', {size: curr.size, mtime: curr.mtimeMs});
      }
    };
    fs.watchFile(cap_file, {interval: WATCH_INTERVAL_MS}, listener);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), WATCH_HEARTBEAT_MS);

    request.raw.on('close', function () {
      clearInterval(heartbeat);
      fs.unwatchFile(cap_file, listener);
    });
  });

  fastify.get('/webshark/json', function (request, reply) {

    if (request.query && "method" in request.query) {
      if (request.query.method === 'files') {
        let files = fs.readdirSync(CAPTURES_PATH);
        let results = {"files":[], "pwd": "."};
        let loaded_files = sharkd_dict.get_loaded_sockets();
        files.forEach( async function(pcap_file){
          if (pcap_file.endsWith('.pcap')) {
            /* fetch URLs to local folder */
	    if(pcap_file.match(url_re)) {
		  const res = await fetch(pcap_file);
                  var filename = pcap_file.split('/').pop()
		  const fileStream = fs.createWriteStream(CAPTURES_PATH+filename);
		  await new Promise((resolve, reject) => {
		      res.body.pipe(fileStream);
		      res.body.on("error", reject);
		      fileStream.on("finish", resolve);
		    });
		  pcap_file=filename;
	    }

            let pcap_stats = fs.statSync(CAPTURES_PATH + pcap_file);
            if (loaded_files.includes(pcap_file)) {
              results.files.push({"name": pcap_file, "size": pcap_stats.size, "status": {"online": true}});
            } else {
              results.files.push({"name": pcap_file, "size": pcap_stats.size});
            }
          }
        });
        reply.send(JSON.stringify(results));
      } else if (request.query.method === 'download') {
        if ("capture" in request.query) {
          if (request.query.capture.includes('..')) {
            reply.send(JSON.stringify({"err": 1, "errstr": "Nope"}));
          }

          let cap_file = request.query.capture;
          if (cap_file.startsWith("/")) {
            cap_file = cap_file.substr(1);
          }

          if ("token" in request.query) {
            if (request.query.token === "self") {
              reply.header('Content-disposition', 'attachment; filename=' + cap_file);
              reply.sendFile(cap_file);
              next();
            } else {
              sharkd_dict.send_req(request.query).then((data) => {
                try {
                  data = JSON.parse(data);
                  reply.header('Content-Type', data.mime);
                  reply.header('Content-disposition', 'attachment; filename="' + data.file + '"');
                  let buff = new Buffer(data.data, 'base64');
                  reply.send(buff);
                } catch (err) {
                  reply.send(JSON.stringify({"err": 1, "errstr": "Nope"}));
                }
              });
            }
          } else {
            reply.send(JSON.stringify({"err": 1, "errstr": "Nope"}));
          }
        }
      } else if (
        request.query.method === 'tap' &&
        'tap0' in request.query && 
        ['srt:dcerpc', 'srt:rpc', 'srt:scsi', 'rtd:megaco'].includes(request.query.tap0) // catch the four invalid requests and prevent socket failure
      ) {
        reply.send(null);
      } else {
        sharkd_dict.send_req(request.query).then((data) => {
          reply.send(data);
        });
      }
    }
  })

  next()
}
