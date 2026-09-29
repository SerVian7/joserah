'use strict';
// Where tool-count.js keeps a session's count and user-prompt-submit.js
// clears it. The session id comes from the hook payload, so it is reduced to
// safe characters before it names a file; no id, no file.
const os = require('os');
const path = require('path');

function toolCountFile(sessionId) {
  const id = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  return id ? path.join(os.tmpdir(), `joserah-tool-count-${id}`) : null;
}

module.exports = { toolCountFile };
