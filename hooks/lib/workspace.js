'use strict';
const fs = require('fs');
const path = require('path');

const MARKER = path.join('.joserah', 'config.json');

/** Walk up from startDir looking for the workspace marker. */
function findWorkspace(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, MARKER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readConfig(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, MARKER), 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

module.exports = { findWorkspace, readConfig, MARKER };
