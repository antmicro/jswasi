var global$1 = (typeof global !== "undefined" ? global :
            typeof self !== "undefined" ? self :
            typeof window !== "undefined" ? window : {});

// shim for using process in browser
// based off https://github.com/defunctzombie/node-process/blob/master/browser.js

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
var cachedSetTimeout = defaultSetTimout;
var cachedClearTimeout = defaultClearTimeout;
if (typeof global$1.setTimeout === 'function') {
    cachedSetTimeout = setTimeout;
}
if (typeof global$1.clearTimeout === 'function') {
    cachedClearTimeout = clearTimeout;
}

function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}
function nextTick(fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
}
// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};





 // empty string to avoid regexp issues


















// from https://github.com/kumavis/browser-process-hrtime/blob/master/index.js
var performance = global$1.performance || {};
var performanceNow =
  performance.now        ||
  performance.mozNow     ||
  performance.msNow      ||
  performance.oNow       ||
  performance.webkitNow  ||
  function(){ return (new Date()).getTime() };

// generate timestamp or delta
// see http://nodejs.org/api/process.html#process_process_hrtime

// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
function resolve() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : '/';

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
}

// path.normalize(path)
// posix version
function normalize(path) {
  var isPathAbsolute = isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isPathAbsolute).join('/');

  if (!path && !isPathAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isPathAbsolute ? '/' : '') + path;
}

// posix version
function isAbsolute(path) {
  return path.charAt(0) === '/';
}

// posix version
function join() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
}


// path.relative(from, to)
// posix version
function relative(from, to) {
  from = resolve(from).substr(1);
  to = resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
}

var sep = '/';
var delimiter = ':';

function dirname(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
}

function basename(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
}


function extname(path) {
  return splitPath(path)[3];
}
var pathNode = {
  extname: extname,
  basename: basename,
  dirname: dirname,
  sep: sep,
  delimiter: delimiter,
  relative: relative,
  join: join,
  isAbsolute: isAbsolute,
  normalize: normalize,
  resolve: resolve
};
function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b' ?
    function (str, start, len) { return str.substr(start, len) } :
    function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    };

var constants = Object.freeze({
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_ACCMODE: 3,
  S_IFMT: 61440,
  S_IFREG: 32768,
  S_IFDIR: 16384,
  S_IFCHR: 8192,
  S_IFBLK: 24576,
  S_IFIFO: 4096,
  S_IFLNK: 40960,
  S_IFSOCK: 49152,
  O_CREAT: 64,
  O_EXCL: 128,
  O_NOCTTY: 256,
  O_TRUNC: 512,
  O_APPEND: 1024,
  O_DIRECTORY: 65536,
  O_NOATIME: 262144,
  O_NOFOLLOW: 131072,
  O_SYNC: 1052672,
  O_DIRECT: 16384,
  O_NONBLOCK: 2048,
  S_IRWXU: 448,
  S_IRUSR: 256,
  S_IWUSR: 128,
  S_IXUSR: 64,
  S_IRWXG: 56,
  S_IRGRP: 32,
  S_IWGRP: 16,
  S_IXGRP: 8,
  S_IRWXO: 7,
  S_IROTH: 4,
  S_IWOTH: 2,
  S_IXOTH: 1,
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  COPYFILE_EXCL: 1,
  SEEK_SET: 0,
  SEEK_CUR: 1,
  SEEK_END: 2,
  MAP_SHARED: 1,
  MAP_PRIVATE: 2
});

/** @module Stat */

/**
 * Class representing Stat metadata.
 */
class Stat {

  /**
   * Creates Stat.
   */
  constructor(props) {
    this.dev = props.dev || 0; // in-memory has no devices
    this.ino = props.ino;
    this.mode = props.mode;
    this.nlink = props.nlink;
    this.uid = props.uid;
    this.gid = props.gid;
    this.rdev = props.rdev || 0; // is 0 for regular files and directories
    this.size = props.size;
    this.blksize = undefined; // in-memory doesn't have blocks
    this.blocks = undefined; // in-memory doesn't have blocks
    this.atime = props.atime;
    this.mtime = props.mtime;
    this.ctime = props.ctime;
    this.birthtime = props.birthtime;
  }

  /**
   * Checks if file.
   */
  isFile() {
    return (this.mode & constants.S_IFMT) == constants.S_IFREG;
  }

  /**
   * Checks if directory.
   */
  isDirectory() {
    return (this.mode & constants.S_IFMT) == constants.S_IFDIR;
  }

  /**
   * Checks if block device.
   */
  isBlockDevice() {
    return (this.mode & constants.S_IFMT) == constants.S_IFBLK;
  }

  /**
   * Checks if character device.
   */
  isCharacterDevice() {
    return (this.mode & constants.S_IFMT) == constants.S_IFCHR;
  }

  /**
   * Checks if symbolic link.
   */
  isSymbolicLink() {
    return (this.mode & constants.S_IFMT) == constants.S_IFLNK;
  }

  /**
   * Checks if FIFO.
   */
  isFIFO() {
    return (this.mode & constants.S_IFMT) == constants.S_IFIFO;
  }

  /**
   * Checks if socket.
   */
  isSocket() {
    return (this.mode & constants.S_IFMT) == constants.S_IFSOCK;
  }

}

class CurrentDirectory {

  constructor(iNodeMgr, iNode, curPath = []) {
    this._iNodeMgr = iNodeMgr;
    this._iNode = iNode;
    this._curPath = curPath;
    iNodeMgr.refINode(iNode);
  }

  changeDir(iNode, curPath) {
    this._iNodeMgr.refINode(iNode);
    this._iNodeMgr.unrefINode(this._iNode);
    this._iNode = iNode;
    this._curPath = curPath;
    return;
  }

  getINode() {
    return this._iNode;
  }

  getPathStack() {
    return [...this._curPath];
  }

  getPath() {
    return '/' + this._curPath.join('/');
  }

}

/**
 * Default root uid.
 */

/** @module Permissions */

const DEFAULT_ROOT_UID = 0;

/**
 * Default root gid.
 */
const DEFAULT_ROOT_GID = 0;

/**
 * Default root directory permissions of `rwxr-xr-x`.
 */
const DEFAULT_ROOT_PERM = constants.S_IRWXU | constants.S_IRGRP | constants.S_IXGRP | constants.S_IROTH | constants.S_IXOTH;

/**
 * Default file permissions of `rw-rw-rw-`.
 */
const DEFAULT_FILE_PERM = constants.S_IRUSR | constants.S_IWUSR | constants.S_IRGRP | constants.S_IWGRP | constants.S_IROTH | constants.S_IWOTH;

/**
 * Default directory permissions of `rwxrwxrwx`.
 */
const DEFAULT_DIRECTORY_PERM = constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO;

/**
 * Default symlink permissions of `rwxrwxrwx`.
 */
const DEFAULT_SYMLINK_PERM = constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO;

/**
 * Permission checking relies on ownership details of the iNode.
 * If the accessing user is the same as the iNode user, then only user permissions are used.
 * If the accessing group is the same as the iNode group, then only the group permissions are used.
 * Otherwise the other permissions are used.
 */
function resolveOwnership(uid, gid, stat) {
  if (uid === stat.uid) {
    return (stat.mode & constants.S_IRWXU) >> 6;
  } else if (gid === stat.gid) {
    return (stat.mode & constants.S_IRWXG) >> 3;
  } else {
    return stat.mode & constants.S_IRWXO;
  }
}

/**
 * Checks the desired permissions with user id and group id against the metadata of an iNode.
 * The desired permissions can be bitwise combinations of constants.R_OK, constants.W_OK and constants.X_OK.
 */
function checkPermissions(access, uid, gid, stat) {
  return (access & resolveOwnership(uid, gid, stat)) === access;
}

/**
 * @license BitSet v5.2.3 10/9/2024
 * https://raw.org/article/javascript-bit-array/
 *
 * Copyright (c) 2024, Robert Eisele (https://raw.org/)
 * Licensed under the MIT license.
 **/

/**
 * The number of bits of a word
 * @const
 * @type number
 */
var WORD_LENGTH = 32;

/**
 * The log base 2 of WORD_LENGTH
 * @const
 * @type number
 */
var WORD_LOG = 5;

/**
 * Calculates the number of set bits
 *
 * @param {number} v
 * @returns {number}
 */
function popCount(v) {

  // Warren, H. (2009). Hacker`s Delight. New York, NY: Addison-Wesley

  v -= v >>> 1 & 0x55555555;
  v = (v & 0x33333333) + (v >>> 2 & 0x33333333);
  return (v + (v >>> 4) & 0xF0F0F0F) * 0x1010101 >>> 24;
}

/**
 * Divide a number in base two by B
 *
 * @param {Array} arr
 * @param {number} B
 * @returns {number}
 */
function divide(arr, B) {

  var r = 0;

  for (var i = 0; i < arr.length; i++) {
    r *= 2;
    var d = (arr[i] + r) / B | 0;
    r = (arr[i] + r) % B;
    arr[i] = d;
  }
  return r;
}

/**
 * Parses the parameters and set variable P
 *
 * @param {Object} P
 * @param {string|BitSet|Array|Uint8Array|number=} val
 */
function parse(P, val) {

  if (val == null) {
    P['data'] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    P['_'] = 0;
    return;
  }

  if (val instanceof BitSet) {
    P['data'] = val['data'];
    P['_'] = val['_'];
    return;
  }

  switch (typeof val) {

    case 'number':
      P['data'] = [val | 0];
      P['_'] = 0;
      break;

    case 'string':

      var base = 2;
      var len = WORD_LENGTH;

      if (val.indexOf('0b') === 0) {
        val = val.substr(2);
      } else if (val.indexOf('0x') === 0) {
        val = val.substr(2);
        base = 16;
        len = 8;
      }

      P['data'] = [];
      P['_'] = 0;

      var a = val.length - len;
      var b = val.length;

      do {

        var num = parseInt(val.slice(a > 0 ? a : 0, b), base);

        if (isNaN(num)) {
          throw SyntaxError('Invalid param');
        }

        P['data'].push(num | 0);

        if (a <= 0) break;

        a -= len;
        b -= len;
      } while (1);

      break;

    default:

      P['data'] = [0];
      var data = P['data'];

      if (val instanceof Array) {

        for (var i = val.length - 1; i >= 0; i--) {

          var ndx = val[i];

          if (ndx === Infinity) {
            P['_'] = -1;
          } else {
            scale(P, ndx);
            data[ndx >>> WORD_LOG] |= 1 << ndx;
          }
        }
        break;
      }

      if (Uint8Array && val instanceof Uint8Array) {

        var bits = 8;

        scale(P, val.length * bits);

        for (var i = 0; i < val.length; i++) {

          var n = val[i];

          for (var j = 0; j < bits; j++) {

            var k = i * bits + j;

            data[k >>> WORD_LOG] |= (n >> j & 1) << k;
          }
        }
        break;
      }
      throw SyntaxError('Invalid param');
  }
}

/**
 * Module entry point
 *
 * @constructor
 * @param {string|BitSet|number=} param
 * @returns {BitSet}
 */
function BitSet(param) {

  if (!(this instanceof BitSet)) {
    return new BitSet(param);
  }
  parse(this, param);
  this['data'] = this['data'].slice();
}

function scale(dst, ndx) {

  var l = ndx >>> WORD_LOG;
  var d = dst['data'];
  var v = dst['_'];

  for (var i = d.length; l >= i; l--) {
    d.push(v);
  }
}

var P = {
  'data': [], // Holds the actual bits in form of a 32bit integer array.
  '_': 0 // Holds the MSB flag information to make indefinitely large bitsets inversion-proof
};

BitSet.prototype = {
  'data': [],
  '_': 0,
  /**
   * Set a single bit flag
   *
   * Ex:
   * bs1 = new BitSet(10);
   *
   * bs1.set(3, 1);
   *
   * @param {number} ndx The index of the bit to be set
   * @param {number=} value Optional value that should be set on the index (0 or 1)
   * @returns {BitSet} this
   */
  'set': function (ndx, value) {

    ndx |= 0;

    scale(this, ndx);

    if (value === undefined || value) {
      this['data'][ndx >>> WORD_LOG] |= 1 << ndx;
    } else {
      this['data'][ndx >>> WORD_LOG] &= ~(1 << ndx);
    }
    return this;
  },
  /**
   * Get a single bit flag of a certain bit position
   *
   * Ex:
   * bs1 = new BitSet();
   * var isValid = bs1.get(12);
   *
   * @param {number} ndx the index to be fetched
   * @returns {number} The binary flag
   */
  'get': function (ndx) {

    ndx |= 0;

    var d = this['data'];
    var n = ndx >>> WORD_LOG;

    if (n >= d.length) {
      return this['_'] & 1;
    }
    return d[n] >>> ndx & 1;
  },
  /**
   * Creates the bitwise NOT of a set.
   *
   * Ex:
   * bs1 = new BitSet(10);
   *
   * res = bs1.not();
   *
   * @returns {BitSet} A new BitSet object, containing the bitwise NOT of this
   */
  'not': function () {
    // invert()

    var t = this['clone']();
    var d = t['data'];
    for (var i = 0; i < d.length; i++) {
      d[i] = ~d[i];
    }

    t['_'] = ~t['_'];

    return t;
  },
  /**
   * Creates the bitwise AND of two sets.
   *
   * Ex:
   * bs1 = new BitSet(10);
   * bs2 = new BitSet(10);
   *
   * res = bs1.and(bs2);
   *
   * @param {BitSet} value A bitset object
   * @returns {BitSet} A new BitSet object, containing the bitwise AND of this and value
   */
  'and': function (value) {
    // intersection

    parse(P, value);

    var T = this['clone']();
    var t = T['data'];
    var p = P['data'];

    var pl = p.length;
    var p_ = P['_'];
    var t_ = T['_'];

    // If this is infinite, we need all bits from P
    if (t_ !== 0) {
      scale(T, pl * WORD_LENGTH - 1);
    }

    var tl = t.length;
    var l = Math.min(pl, tl);
    var i = 0;

    for (; i < l; i++) {
      t[i] &= p[i];
    }

    for (; i < tl; i++) {
      t[i] &= p_;
    }

    T['_'] &= p_;

    return T;
  },
  /**
   * Creates the bitwise OR of two sets.
   *
   * Ex:
   * bs1 = new BitSet(10);
   * bs2 = new BitSet(10);
   *
   * res = bs1.or(bs2);
   *
   * @param {BitSet} val A bitset object
   * @returns {BitSet} A new BitSet object, containing the bitwise OR of this and val
   */
  'or': function (val) {
    // union

    parse(P, val);

    var t = this['clone']();
    var d = t['data'];
    var p = P['data'];

    var pl = p.length - 1;
    var tl = d.length - 1;

    var minLength = Math.min(tl, pl);

    // Append backwards, extend array only once
    for (var i = pl; i > minLength; i--) {
      d[i] = p[i];
    }

    for (; i >= 0; i--) {
      d[i] |= p[i];
    }

    t['_'] |= P['_'];

    return t;
  },
  /**
   * Creates the bitwise XOR of two sets.
   *
   * Ex:
   * bs1 = new BitSet(10);
   * bs2 = new BitSet(10);
   *
   * res = bs1.xor(bs2);
   *
   * @param {BitSet} val A bitset object
   * @returns {BitSet} A new BitSet object, containing the bitwise XOR of this and val
   */
  'xor': function (val) {
    // symmetric difference

    parse(P, val);

    var t = this['clone']();
    var d = t['data'];
    var p = P['data'];

    var t_ = t['_'];
    var p_ = P['_'];

    var i = 0;

    var tl = d.length - 1;
    var pl = p.length - 1;

    // Cut if tl > pl
    for (i = tl; i > pl; i--) {
      d[i] ^= p_;
    }

    // Cut if pl > tl
    for (i = pl; i > tl; i--) {
      d[i] = t_ ^ p[i];
    }

    // XOR the rest
    for (; i >= 0; i--) {
      d[i] ^= p[i];
    }

    // XOR infinity
    t['_'] ^= p_;

    return t;
  },
  /**
   * Creates the bitwise AND NOT (not confuse with NAND!) of two sets.
   *
   * Ex:
   * bs1 = new BitSet(10);
   * bs2 = new BitSet(10);
   *
   * res = bs1.notAnd(bs2);
   *
   * @param {BitSet} val A bitset object
   * @returns {BitSet} A new BitSet object, containing the bitwise AND NOT of this and other
   */
  'andNot': function (val) {
    // difference

    return this['and'](new BitSet(val)['flip']());
  },
  /**
   * Flip/Invert a range of bits by setting
   *
   * Ex:
   * bs1 = new BitSet();
   * bs1.flip(); // Flip entire set
   * bs1.flip(5); // Flip single bit
   * bs1.flip(3,10); // Flip a bit range
   *
   * @param {number=} from The start index of the range to be flipped
   * @param {number=} to The end index of the range to be flipped
   * @returns {BitSet} this
   */
  'flip': function (from, to) {

    if (from === undefined) {

      var d = this['data'];
      for (var i = 0; i < d.length; i++) {
        d[i] = ~d[i];
      }

      this['_'] = ~this['_'];
    } else if (to === undefined) {

      scale(this, from);

      this['data'][from >>> WORD_LOG] ^= 1 << from;
    } else if (0 <= from && from <= to) {

      scale(this, to);

      for (var i = from; i <= to; i++) {
        this['data'][i >>> WORD_LOG] ^= 1 << i;
      }
    }
    return this;
  },
  /**
   * Clear a range of bits by setting it to 0
   *
   * Ex:
   * bs1 = new BitSet();
   * bs1.clear(); // Clear entire set
   * bs1.clear(5); // Clear single bit
   * bs1.clear(3,10); // Clear a bit range
   *
   * @param {number=} from The start index of the range to be cleared
   * @param {number=} to The end index of the range to be cleared
   * @returns {BitSet} this
   */
  'clear': function (from, to) {

    var data = this['data'];

    if (from === undefined) {

      for (var i = data.length - 1; i >= 0; i--) {
        data[i] = 0;
      }
      this['_'] = 0;
    } else if (to === undefined) {

      from |= 0;

      scale(this, from);

      data[from >>> WORD_LOG] &= ~(1 << from);
    } else if (from <= to) {

      scale(this, to);

      for (var i = from; i <= to; i++) {
        data[i >>> WORD_LOG] &= ~(1 << i);
      }
    }
    return this;
  },
  /**
   * Gets an entire range as a new bitset object
   *
   * Ex:
   * bs1 = new BitSet();
   * bs1.slice(4, 8);
   *
   * @param {number=} from The start index of the range to be get
   * @param {number=} to The end index of the range to be get
   * @returns {BitSet} A new smaller bitset object, containing the extracted range
   */
  'slice': function (from, to) {

    if (from === undefined) {
      return this['clone']();
    } else if (to === undefined) {

      to = this['data'].length * WORD_LENGTH;

      var im = Object.create(BitSet.prototype);

      im['_'] = this['_'];
      im['data'] = [0];

      for (var i = from; i <= to; i++) {
        im['set'](i - from, this['get'](i));
      }
      return im;
    } else if (from <= to && 0 <= from) {

      var im = Object.create(BitSet.prototype);
      im['data'] = [0];

      for (var i = from; i <= to; i++) {
        im['set'](i - from, this['get'](i));
      }
      return im;
    }
    return null;
  },
  /**
   * Set a range of bits
   *
   * Ex:
   * bs1 = new BitSet();
   *
   * bs1.setRange(10, 15, 1);
   *
   * @param {number} from The start index of the range to be set
   * @param {number} to The end index of the range to be set
   * @param {number} value Optional value that should be set on the index (0 or 1)
   * @returns {BitSet} this
   */
  'setRange': function (from, to, value) {

    for (var i = from; i <= to; i++) {
      this['set'](i, value);
    }
    return this;
  },
  /**
   * Clones the actual object
   *
   * Ex:
   * bs1 = new BitSet(10);
   * bs2 = bs1.clone();
   *
   * @returns {BitSet|Object} A new BitSet object, containing a copy of the actual object
   */
  'clone': function () {

    var im = Object.create(BitSet.prototype);
    im['data'] = this['data'].slice();
    im['_'] = this['_'];

    return im;
  },
  /**
   * Gets a list of set bits
   *
   * @returns {Array}
   */
  'toArray': Math['clz32'] ? function () {

    var ret = [];
    var data = this['data'];

    for (var i = data.length - 1; i >= 0; i--) {

      var num = data[i];

      while (num !== 0) {
        var t = 31 - Math['clz32'](num);
        num ^= 1 << t;
        ret.unshift(i * WORD_LENGTH + t);
      }
    }

    if (this['_'] !== 0) ret.push(Infinity);

    return ret;
  } : function () {

    var ret = [];
    var data = this['data'];

    for (var i = 0; i < data.length; i++) {

      var num = data[i];

      while (num !== 0) {
        var t = num & -num;
        num ^= t;
        ret.push(i * WORD_LENGTH + popCount(t - 1));
      }
    }

    if (this['_'] !== 0) ret.push(Infinity);

    return ret;
  },
  /**
   * Overrides the toString method to get a binary representation of the BitSet
   *
   * @param {number=} base
   * @returns string A binary string
   */
  'toString': function (base) {

    var data = this['data'];

    if (!base) base = 2;

    // If base is power of two
    if ((base & base - 1) === 0 && base < 36) {

      var ret = '';
      var len = 2 + Math.log(4294967295 /*Math.pow(2, WORD_LENGTH)-1*/) / Math.log(base) | 0;

      for (var i = data.length - 1; i >= 0; i--) {

        var cur = data[i];

        // Make the number unsigned
        if (cur < 0) cur += 4294967296 /*Math.pow(2, WORD_LENGTH)*/;

        var tmp = cur.toString(base);

        if (ret !== '') {
          // Fill small positive numbers with leading zeros. The +1 for array creation is added outside already
          ret += '0'.repeat(len - tmp.length - 1);
        }
        ret += tmp;
      }

      if (this['_'] === 0) {

        ret = ret.replace(/^0+/, '');

        if (ret === '') ret = '0';
        return ret;
      } else {
        // Pad the string with ones
        ret = '1111' + ret;
        return ret.replace(/^1+/, '...1111');
      }
    } else {

      if (2 > base || base > 36) throw SyntaxError('Invalid base');

      var ret = [];
      var arr = [];

      // Copy every single bit to a new array
      for (var i = data.length; i--;) {

        for (var j = WORD_LENGTH; j--;) {

          arr.push(data[i] >>> j & 1);
        }
      }

      do {
        ret.unshift(divide(arr, base).toString(base));
      } while (!arr.every(function (x) {
        return x === 0;
      }));

      return ret.join('');
    }
  },
  /**
   * Check if the BitSet is empty, means all bits are unset
   *
   * Ex:
   * bs1 = new BitSet(10);
   *
   * bs1.isEmpty() ? 'yes' : 'no'
   *
   * @returns {boolean} Whether the bitset is empty
   */
  'isEmpty': function () {

    if (this['_'] !== 0) return false;

    var d = this['data'];

    for (var i = d.length - 1; i >= 0; i--) {
      if (d[i] !== 0) return false;
    }
    return true;
  },
  /**
   * Calculates the number of bits set
   *
   * Ex:
   * bs1 = new BitSet(10);
   *
   * var num = bs1.cardinality();
   *
   * @returns {number} The number of bits set
   */
  'cardinality': function () {

    if (this['_'] !== 0) {
      return Infinity;
    }

    var s = 0;
    var d = this['data'];
    for (var i = 0; i < d.length; i++) {
      var n = d[i];
      if (n !== 0) s += popCount(n);
    }
    return s;
  },
  /**
   * Calculates the Most Significant Bit / log base two
   *
   * Ex:
   * bs1 = new BitSet(10);
   *
   * var logbase2 = bs1.msb();
   *
   * var truncatedTwo = Math.pow(2, logbase2); // May overflow!
   *
   * @returns {number} The index of the highest bit set
   */
  'msb': Math['clz32'] ? function () {

    if (this['_'] !== 0) {
      return Infinity;
    }

    var data = this['data'];

    for (var i = data.length; i-- > 0;) {

      var c = Math['clz32'](data[i]);

      if (c !== WORD_LENGTH) {
        return i * WORD_LENGTH + WORD_LENGTH - 1 - c;
      }
    }
    return Infinity;
  } : function () {

    if (this['_'] !== 0) {
      return Infinity;
    }

    var data = this['data'];

    for (var i = data.length; i-- > 0;) {

      var v = data[i];
      var c = 0;

      if (v) {

        for (; (v >>>= 1) > 0; c++) {}
        return i * WORD_LENGTH + c;
      }
    }
    return Infinity;
  },
  /**
   * Calculates the number of trailing zeros
   *
   * Ex:
   * bs1 = new BitSet(10);
   *
   * var ntz = bs1.ntz();
   *
   * @returns {number} The index of the lowest bit set
   */
  'ntz': function () {

    var data = this['data'];

    for (var j = 0; j < data.length; j++) {
      var v = data[j];

      if (v !== 0) {

        v = (v ^ v - 1) >>> 1; // Set v's trailing 0s to 1s and zero rest

        return j * WORD_LENGTH + popCount(v);
      }
    }
    return Infinity;
  },
  /**
   * Calculates the Least Significant Bit
   *
   * Ex:
   * bs1 = new BitSet(10);
   *
   * var lsb = bs1.lsb();
   *
   * @returns {number} The index of the lowest bit set
   */
  'lsb': function () {

    var data = this['data'];

    for (var i = 0; i < data.length; i++) {

      var v = data[i];
      var c = 0;

      if (v) {

        var bit = v & -v;

        for (; bit >>>= 1; c++) {}
        return WORD_LENGTH * i + c;
      }
    }
    return this['_'] & 1;
  },
  /**
   * Compares two BitSet objects
   *
   * Ex:
   * bs1 = new BitSet(10);
   * bs2 = new BitSet(10);
   *
   * bs1.equals(bs2) ? 'yes' : 'no'
   *
   * @param {BitSet} val A bitset object
   * @returns {boolean} Whether the two BitSets have the same bits set (valid for indefinite sets as well)
   */
  'equals': function (val) {

    parse(P, val);

    var t = this['data'];
    var p = P['data'];

    var t_ = this['_'];
    var p_ = P['_'];

    var tl = t.length - 1;
    var pl = p.length - 1;

    if (p_ !== t_) {
      return false;
    }

    var minLength = tl < pl ? tl : pl;
    var i = 0;

    for (; i <= minLength; i++) {
      if (t[i] !== p[i]) return false;
    }

    for (i = tl; i > pl; i--) {
      if (t[i] !== p_) return false;
    }

    for (i = pl; i > tl; i--) {
      if (p[i] !== t_) return false;
    }
    return true;
  },
  [Symbol.iterator]: function () {

    var d = this['data'];
    var ndx = 0;

    if (this['_'] === 0) {

      // Find highest index with something meaningful
      var highest = 0;
      for (var i = d.length - 1; i >= 0; i--) {
        if (d[i] !== 0) {
          highest = i;
          break;
        }
      }

      return {
        'next': function () {
          var n = ndx >>> WORD_LOG;

          return {
            'done': n > highest || n === highest && d[n] >>> ndx === 0,
            'value': n > highest ? 0 : d[n] >>> ndx++ & 1
          };
        }
      };
    } else {
      // Endless iterator!
      return {
        'next': function () {
          var n = ndx >>> WORD_LOG;

          return {
            'done': false,
            'value': n < d.length ? d[n] >>> ndx++ & 1 : 1
          };
        }
      };
    }
  }
};

BitSet['fromBinaryString'] = function (str) {

  return new BitSet('0b' + str);
};

BitSet['fromHexString'] = function (str) {

  return new BitSet('0x' + str);
};

BitSet['Random'] = function (n) {

  if (n === undefined || n < 0) {
    n = WORD_LENGTH;
  }

  var m = n % WORD_LENGTH;

  // Create an array, large enough to hold the random bits
  var t = [];
  var len = Math.ceil(n / WORD_LENGTH);

  // Create an bitset instance
  var s = Object.create(BitSet.prototype);

  // Fill the vector with random data, uniformly distributed
  for (var i = 0; i < len; i++) {
    t.push(Math.random() * 4294967296 | 0);
  }

  // Mask out unwanted bits
  if (m > 0) {
    t[len - 1] &= (1 << m) - 1;
  }

  s['data'] = t;
  s['_'] = 0;
  return s;
};

/** @module Counter */

// bitset library uses 32 bits numbers internally
// it preemptively adds an extra number whan it detects it's full
// this is why we use Uint8Array and minus 1 from the blocksize / 8
// in order to get exactly the right size
// because of the functions supplied by the bitset library
// we invert the notions of set and unset where
// set is 0 and unset is 1

/**
 * Creates a new bitmap sized according to the block size
 */
function createBitMap(blockSize) {
  return new BitSet(new Uint8Array(blockSize / 8 - 1)).flip(0, blockSize - 1);
}

/**
  * Set a bit
  */
function setBit(bitMap, i) {
  return bitMap.set(i, 0);
}

/**
  * Unsets a bit
  */
function unsetBit(bitMap, i) {
  return bitMap.set(i, 1);
}

/**
  * Checks if the entire bitmap is set
  */
function allSet(bitMap) {
  return bitMap.isEmpty();
}

/**
  * Checks if the entire bitmap is unset
  */
function allUnset(bitMap, blockSize) {
  return bitMap.cardinality() === blockSize;
}

/**
  * Find first set algorithm
  * If null is returned, all items have been set
  */
function firstUnset(bitMap) {
  let first = bitMap.ntz();
  if (first === Infinity) {
    first = null;
  }
  return first;
}

/**
  * Checks if a bit is set.
  */
function isSet(bitMap, i) {
  return !bitMap.get(i);
}

/**
 * Class representing a lazy recursive fully-persistent bitmap tree.
 * Only the leaf bitmaps correspond to counters.
 * Interior bitmaps index their child bitmaps.
 * If an interior bit is set, that means there's no free bits in the child bitmap.
 * If an interior bit is not set, that means there's at least 1 free bit in the child bitmap.
 * The snapshot parameter for allocate and deallocate controls how the persistence works.
 * If a snapshot is passed in to mutation methods and a mutation occurs either by
 * changing the current node or leaf, or creating a new parent or child, then these
 * will always create new nodes or leafs instead of mutating the current node or leaf.
 * If the node or leaf to be copied is already in a snapshot, then it will not bother copying
 * unnecessarily.
 */
class BitMapTree {

  /**
   * Creates a BitMapTree, this is an abstract class.
   * It is not meant to by directly instantiated.
   */
  constructor(blockSize, shrink, begin, depth, bitMap) {
    this.blockSize = blockSize;
    this.shrink = shrink;
    this.begin = begin;
    this.depth = depth;
    this.bitMap = bitMap || createBitMap(blockSize);
  }

}

/**
 * Class representing a Leaf of the recursive bitmap tree.
 * This represents the base case of the lazy recursive bitmap tree.
 */
class Leaf extends BitMapTree {

  /**
   * Creates a Leaf
   */
  constructor(blockSize, shrink, begin, bitMap) {
    super(blockSize, shrink, begin, 0, bitMap);
  }

  /**
   * Allocates a counter and sets the corresponding bit for the bitmap.
   * It will lazily grow parents.
   */
  allocate(counter, callback, snapshot) {
    let index;
    if (counter == null) {
      index = firstUnset(this.bitMap);
    } else {
      index = counter - this.begin;
    }
    if (index !== null && index < this.blockSize) {
      if (!isSet(this.bitMap, index)) {
        let bitMapNew;
        let treeNew;
        if (!snapshot || snapshot.has(this)) {
          bitMapNew = this.bitMap;
          setBit(bitMapNew, index);
          treeNew = this;
        } else {
          bitMapNew = this.bitMap.clone();
          setBit(bitMapNew, index);
          treeNew = new Leaf(this.blockSize, this.shrink, this.begin, bitMapNew);
          snapshot.add(treeNew);
        }
        callback({
          counter: this.begin + index,
          changed: true,
          bitMap: bitMapNew,
          tree: treeNew
        });
      } else {
        callback({
          counter: this.begin + index,
          changed: false,
          bitMap: this.bitMap,
          tree: this
        });
      }
    } else {
      // grow the tree upwards
      const treeNew = new Node(this.blockSize, this.shrink, this.begin, this.depth + 1);
      if (snapshot) {
        snapshot.add(treeNew);
        snapshot.add(treeNew.bitMap);
      }
      treeNew.bitMapTrees[0] = this;
      if (allSet(this.bitMap)) {
        setBit(treeNew.bitMap, 0);
      }
      treeNew.allocate(counter, callback, snapshot);
    }
  }

  /**
   * Deallocates a counter and unsets the corresponding bit for the bitmap.
   */
  deallocate(counter, callback, snapshot) {
    const index = counter - this.begin;
    if (index >= 0 && index < this.blockSize) {
      if (isSet(this.bitMap, index)) {
        let bitMapNew;
        let treeNew;
        if (!snapshot || snapshot.has(this)) {
          bitMapNew = this.bitMap;
          unsetBit(bitMapNew, index);
          treeNew = this;
        } else {
          bitMapNew = this.bitMap.clone();
          unsetBit(bitMapNew, index);
          treeNew = new Leaf(this.blockSize, this.shrink, this.begin, bitMapNew);
          snapshot.add(treeNew);
        }
        callback({
          exists: true,
          changed: true,
          bitMap: bitMapNew,
          tree: treeNew
        });
      } else {
        callback({
          exists: true,
          changed: false,
          bitMap: this.bitMap,
          tree: this
        });
      }
    } else {
      callback({
        exists: false,
        changed: false,
        bitMap: this.bitMap,
        tree: this
      });
    }
  }

  /**
   * Checks if the counter has been set
   */
  check(counter, callback) {
    const index = counter - this.begin;
    if (index >= 0 && index < this.blockSize) {
      if (isSet(this.bitMap, index)) {
        callback(true);
      } else {
        callback(false);
      }
    } else {
      callback(null);
    }
  }

}

/**
 * Class representing a Node of the recursive bitmap tree.
 */
class Node extends BitMapTree {

  /**
   * Creates a Node
   */
  constructor(blockSize, shrink, begin, depth, bitMap, bitMapTrees) {
    super(blockSize, shrink, begin, depth, bitMap);
    this.bitMapTrees = bitMapTrees || [];
  }

  /**
   * Allocates a counter by allocating the corresponding child.
   * Passes a continuation to the child allocate that will
   * set the current bitmap if the child bitmap is now all set.
   * It will also lazily create the children or parents as necessary.
   */
  allocate(counter, callback, snapshot) {
    let index;
    if (counter == null) {
      index = firstUnset(this.bitMap);
    } else {
      index = Math.floor((counter - this.begin) / this.blockSize ** this.depth);
    }
    if (index != null && this.bitMapTrees[index]) {
      const index_ = index; // fix the non-null value
      this.bitMapTrees[index].allocate(counter, ({ counter, changed, bitMap: bitMapChild, tree: treeChild }) => {
        let bitMapNew = this.bitMap;
        let treeNew = this;
        if (changed) {
          if (!snapshot && allSet(bitMapChild)) {
            setBit(bitMapNew, index_);
          } else if (snapshot && snapshot.has(this)) {
            if (allSet(bitMapChild)) {
              if (!snapshot.has(this.bitMap)) {
                bitMapNew = this.bitMap.clone();
                snapshot.add(bitMapNew);
                this.bitMap = bitMapNew;
              }
              setBit(bitMapNew, index_);
            }
            treeNew.bitMapTrees[index_] = treeChild;
          } else if (snapshot) {
            if (allSet(bitMapChild)) {
              bitMapNew = this.bitMap.clone();
              snapshot.add(bitMapNew);
              setBit(bitMapNew, index_);
            }
            const bitMapTreesNew = this.bitMapTrees.slice();
            bitMapTreesNew[index_] = treeChild;
            treeNew = new Node(this.blockSize, this.shrink, this.begin, this.depth, bitMapNew, bitMapTreesNew);
            snapshot.add(treeNew);
          }
        }
        callback({
          counter: counter,
          changed: changed,
          bitMap: bitMapNew,
          tree: treeNew
        });
      }, snapshot);
    } else if (index === null || index >= this.blockSize) {
      // grow the tree upwards
      const treeNew = new Node(this.blockSize, this.shrink, this.begin, this.depth + 1);
      if (snapshot) {
        snapshot.add(treeNew);
        snapshot.add(treeNew.bitMap);
      }
      treeNew.bitMapTrees[0] = this;
      if (allSet(this.bitMap)) {
        setBit(treeNew.bitMap, 0);
      }
      treeNew.allocate(counter, callback, snapshot);
    } else {
      // grow the tree downwards
      const beginNew = this.begin + index * this.blockSize ** this.depth;
      const depthNew = this.depth - 1;
      let treeChild;
      if (depthNew === 0) {
        treeChild = new Leaf(this.blockSize, this.shrink, beginNew);
      } else {
        treeChild = new Node(this.blockSize, this.shrink, beginNew, depthNew);
      }
      if (snapshot) {
        snapshot.add(treeChild);
        snapshot.add(treeChild.bitMap);
      }
      let treeNew;
      if (!snapshot || snapshot.has(this)) {
        this.bitMapTrees[index] = treeChild;
        treeNew = this;
      } else {
        const bitMapTreesNew = this.bitMapTrees.slice();
        bitMapTreesNew[index] = treeChild;
        treeNew = new Node(this.blockSize, this.shrink, this.begin, this.depth, this.bitMap, bitMapTreesNew);
        snapshot.add(treeNew);
      }
      const index_ = index; // fix the non-null value
      treeChild.allocate(counter, ({ counter, changed, bitMap: bitMapChild, tree: treeChild }) => {
        let bitMapNew = this.bitMap;
        if (bitMapChild && allSet(bitMapChild)) {
          if (snapshot && !snapshot.has(this.bitMap)) {
            bitMapNew = this.bitMap.clone();
            snapshot.add(bitMapNew);
            treeNew.bitMap = bitMapNew;
          }
          setBit(bitMapNew, index_);
        }
        callback({
          counter: counter,
          changed: changed,
          bitMap: bitMapNew,
          tree: treeNew
        });
      }, snapshot);
    }
  }

  /**
   * Deallocates a counter by deallocating the corresponding child.
   * Passes a continuation to the child deallocate that will
   * unset the current bitmap if the child bitmap was previously all set.
   * It can also shrink the tree if the child node is compeletely empty
   * or if the child leaf is completely unset.
   */
  deallocate(counter, callback, snapshot) {
    const index = Math.floor((counter - this.begin) / this.blockSize ** this.depth);
    if (this.bitMapTrees[index]) {
      const allSetPrior = allSet(this.bitMapTrees[index].bitMap);
      this.bitMapTrees[index].deallocate(counter, ({ exists, changed, bitMap: bitMapChild, tree: treeChild }) => {
        let bitMapNew = this.bitMap;
        let treeNew = this;
        if (!exists) {
          callback({
            exists: exists,
            changed: changed,
            bitMap: bitMapNew,
            tree: treeNew
          });
        } else {
          if (changed) {
            if (!snapshot && allSetPrior) {
              unsetBit(bitMapNew, index);
            } else if (snapshot && snapshot.has(this)) {
              if (allSetPrior) {
                if (!snapshot.has(this.bitMap)) {
                  bitMapNew = this.bitMap.clone();
                  snapshot.add(bitMapNew);
                  this.bitMap = bitMapNew;
                }
                unsetBit(bitMapNew, index);
              }
              treeNew.bitMapTrees[index] = treeChild;
            } else if (snapshot) {
              if (allSetPrior) {
                bitMapNew = this.bitMap.clone();
                snapshot.add(bitMapNew);
                unsetBit(bitMapNew, index);
              }
              const bitMapTreesNew = this.bitMapTrees.slice();
              bitMapTreesNew[index] = treeChild;
              treeNew = new Node(this.blockSize, this.shrink, this.begin, this.depth, bitMapNew, bitMapTreesNew);
              snapshot.add(treeNew);
            }
            if (this.shrink && (treeChild instanceof Leaf && allUnset(bitMapChild, this.blockSize) || treeChild instanceof Node && Object.keys(treeChild.bitMapTrees).length === 0)) {
              delete treeNew.bitMapTrees[index];
            }
          }
          callback({
            exists: true,
            changed: changed,
            bitMap: bitMapNew,
            tree: treeNew
          });
        }
      }, snapshot);
    } else {
      callback({
        exists: false,
        changed: false,
        bitMap: this.bitMap,
        tree: this
      });
    }
  }

  /**
   * Checks if the counter has been set
   */
  check(counter, callback) {
    const index = Math.floor((counter - this.begin) / this.blockSize ** this.depth);
    if (this.bitMapTrees[index]) {
      this.bitMapTrees[index].check(counter, set => {
        callback(set);
      });
    } else {
      callback(null);
    }
  }

}

function allocate(tree, counter, snapshot) {
  let changed;
  let treeNew;
  tree.allocate(counter, ({ counter: counter_, changed: changed_, tree: tree_ }) => {
    counter = counter_;
    changed = changed_;
    treeNew = tree_;
  }, snapshot);
  // $FlowFixMe: changed is initialised
  return [counter, changed, treeNew];
}

function deallocate(tree, counter, snapshot) {
  let changed;
  let treeNew;
  tree.deallocate(counter, ({ changed: changed_, tree: tree_ }) => {
    changed = changed_;
    treeNew = tree_;
  }, snapshot);
  // $FlowFixMe: changed is initialised
  return [changed, treeNew];
}

function check(tree, counter) {
  let set;
  tree.check(counter, set_ => {
    set = set_;
  });
  return !!set;
}

/**
 * Class representing allocatable and deallocatable counters.
 * Counters are allocated in sequential manner, this applies to deallocated counters.
 * Once a counter is deallocated, it will be reused on the next allocation.
 * This is a mutable counter, which doesn't use snapshots.
 */
class Counter {

  /**
   * Creates a counter instance.
   * @throws {RangeError} - If blockSize is not a multiple of 32.
   */
  constructor(begin = 0, blockSize = 32, shrink = true, tree) {
    if (blockSize % 32 !== 0) {
      throw new RangeError('Blocksize for Counter must be a multiple of 32');
    }
    this._begin = begin;
    this._tree = tree || new Leaf(blockSize, shrink, 0);
  }

  /**
   * Allocates a counter sequentially.
   * If a counter is specified, it will allocate it explicitly and return a
   * changed boolean.
   * @throws {RangeError} - If the explicitly allocated counter is out of bounds.
   */
  allocate(counter) {
    if (counter != null) {
      if (counter < this._begin) {
        throw new RangeError('counter needs to be greater or equal to the beginning offset');
      }
      counter = counter - this._begin;
    }
    const [counterAssigned, changed, treeNew] = allocate(this._tree, counter);
    this._tree = treeNew;
    if (counter == null) {
      return counterAssigned + this._begin;
    } else {
      return changed;
    }
  }

  /**
   * Deallocates a number, it makes it available for reuse.
   */
  deallocate(counter) {
    const [changed, treeNew] = deallocate(this._tree, counter - this._begin);
    this._tree = treeNew;
    return changed;
  }

  /**
   * Checks if a number has been allocated or not.
   */
  check(counter) {
    return check(this._tree, counter - this._begin);
  }

}

/** @module Devices */

const MAJOR_BITSIZE = 12;
const MINOR_BITSIZE = 20;
const MAJOR_MAX = 2 ** MAJOR_BITSIZE - 1;
const MINOR_MAX = 2 ** MINOR_BITSIZE - 1;
const MAJOR_MIN = 0;
const MINOR_MIN = 0;

class DeviceError extends Error {

  constructor(code, message) {
    super(message);
    this.code = code;
  }

}

Object.defineProperty(DeviceError, 'ERROR_RANGE', { value: 1 });

Object.defineProperty(DeviceError, 'ERROR_CONFLICT', { value: 2 });

class DeviceManager {

  constructor() {
    this._chrCounterMaj = new Counter(MAJOR_MIN);
    this._chrDevices = new Map();
  }

  getChr(major, minor) {
    const devicesAndCounterMin = this._chrDevices.get(major);
    if (devicesAndCounterMin) {
      const [devicesMin] = devicesAndCounterMin;
      return devicesMin.get(minor);
    }
    return;
  }

  registerChr(device, major, minor) {
    let autoAllocMaj;
    let autoAllocMin;
    let counterMin;
    let devicesMin;
    try {
      if (major === undefined) {
        major = this._chrCounterMaj.allocate();
        autoAllocMaj = major;
      } else {
        const devicesCounterMin = this._chrDevices.get(major);
        if (!devicesCounterMin) {
          this._chrCounterMaj.allocate(major);
          autoAllocMaj = major;
        } else {
          [devicesMin, counterMin] = devicesCounterMin;
        }
      }
      if (!devicesMin || !counterMin) {
        counterMin = new Counter(MINOR_MIN);
        devicesMin = new Map();
      }
      if (minor === undefined) {
        minor = counterMin.allocate();
        autoAllocMin = minor;
      } else {
        if (!devicesMin.has(minor)) {
          counterMin.allocate(minor);
          autoAllocMin = minor;
        } else {
          throw new DeviceError(DeviceError.ERROR_CONFLICT);
        }
      }
      if (major > MAJOR_MAX || major < MAJOR_MIN || minor > MINOR_MAX || minor < MINOR_MIN) {
        throw new DeviceError(DeviceError.ERROR_RANGE);
      }
      devicesMin.set(minor, device);
      this._chrDevices.set(major, [devicesMin, counterMin]);
      return;
    } catch (e) {
      if (autoAllocMaj != null) {
        this._chrCounterMaj.deallocate(autoAllocMaj);
      }
      if (autoAllocMin != null && counterMin) {
        counterMin.deallocate(autoAllocMin);
      }
      throw e;
    }
  }

  deregisterChr(major, minor) {
    const devicesCounterMin = this._chrDevices.get(major);
    if (devicesCounterMin) {
      const [devicesMin, counterMin] = devicesCounterMin;
      if (devicesMin.delete(minor)) {
        counterMin.deallocate(minor);
      }
      if (!devicesMin.size) {
        this._chrDevices.delete(major);
        this._chrCounterMaj.deallocate(major);
      }
    }
    return;
  }

}

function mkDev(major, minor) {
  return major << MINOR_BITSIZE | minor;
}

function unmkDev(dev) {
  const major = dev >> MINOR_BITSIZE;
  const minor = dev & (1 << MINOR_BITSIZE) - 1;
  return [major, minor];
}

function realloc(buffer, size) {
  if (buffer.maxByteLength < size) {
    const __size = 1 << Math.ceil(Math.log2(size));
    const newBuf = new ArrayBuffer(size, { maxByteLength: __size });

    let srcView = new Uint8Array(buffer);
    let dstView = new Uint8Array(newBuf);

    dstView.set(srcView);
    return newBuf;
  }
  if (buffer.byteLength < size) {
    buffer.resize(size);
  }
  return buffer;
}

function concat(buf1, buf2) {
  const sizeNeeded = buf1.byteLength + buf2.byteLength;
  let __bufBase = buf1;

  if (buf1.maxByteLength < sizeNeeded) {
    newBuf = realloc(buf1, sizeNeeded);
    newBuf.set(buf2, buf1.byteLength);
    __bufBase = newBuf;
  }

  let bufBaseView = new Uint8Array(__bufBase);
  let buf2View = new Uint8Array(buf2);

  bufBaseView.set(buf2View, buf1.byteLength);
  return newBuf;
}

var _extends$1 = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

// $FlowFixMe: Buffer exists
/** @module INodes */

/**
 * Class representing an iNode.
 */
class INode {

  /**
   * Creates iNode.
   * INode and INodeManager will recursively call each other.
   */
  constructor(metadata, iNodeMgr) {
    const now = new Date();
    this._metadata = new Stat(_extends$1({}, metadata, {
      mode: metadata.mode,
      nlink: metadata.nlink || 0,
      atime: now,
      mtime: now,
      ctime: now,
      birthtime: now
    }));
    this._iNodeMgr = iNodeMgr;
  }

  /**
   * Gets the Stat metadata instance.
   */
  getMetadata() {
    return this._metadata;
  }

}

/**
 * Class representing a file.
 * @extends INode
 */
class File extends INode {

  /**
   * Creates a file.
   */
  constructor(props, iNodeMgr) {
    super({
      ino: props.ino,
      uid: props.uid,
      gid: props.gid,
      mode: constants.S_IFREG | props.mode & ~constants.S_IFMT,
      size: props.data ? props.data.byteLength : 0
    }, iNodeMgr);
    this._data = props.data ? props.data : new ArrayBuffer(0);
  }

  /**
   * Gets the file buffer.
   */
  getData() {
    return this._data;
  }

  /**
   * Sets the file buffer.
   */
  setData(data) {
    this._data = data;
    return;
  }

  read() {}

  write(buffer, position, append) {
    let data = this._data;
    let bytesWritten;
    if (append) {
      data = concat(data, buffer);
      bytesWritten = buffer.byteLength;
    } else {
      position = data.byteLength < position ? data.byteLength : position;
      const overwrittenLength = data.byteLength - position;
      const extendedLength = buffer.byteLength - overwrittenLength;
      if (extendedLength > 0) {
        data = realloc(data, data.byteLength + extendedLength);
      }
      bytesWritten = buffer.byteLength;
      let view8 = new Uint8Array(data);
      view8.set(new Uint8Array(buffer), position);
    }
    this._data = data;
    this._metadata.size = this._data.byteLength;
    return bytesWritten;
  }

  /**
   * Noop.
   */
  destructor() {
    return;
  }
}

/**
 * Class representing a directory.
 * @extends INode
 */
class Directory extends INode {

  /**
   * Creates a directory.
   * Virtual directories have 0 size.
   * If there's no parent inode, we assume this is the root directory.
   */
  constructor(props, iNodeMgr) {
    // root will start with an nlink of 2 due to '..'
    // otherwise start with an nlink of 1
    if (props.parent === undefined) props.parent = props.ino;
    let nlink;
    if (props.parent === props.ino) {
      nlink = 2;
    } else {
      nlink = 1;
      iNodeMgr.linkINode(iNodeMgr.getINode(props.parent));
    }
    super({
      ino: props.ino,
      mode: constants.S_IFDIR | props.mode & ~constants.S_IFMT,
      uid: props.uid,
      gid: props.gid,
      nlink: nlink,
      size: 4096
    }, iNodeMgr);
    this._dir = new Map([['.', props.ino], ['..', props.parent]]);
  }

  /**
   * Gets an iterator of name to iNode index.
   * This prevents giving out mutability.
   */
  getEntries() {
    this._metadata.atime = new Date();
    return this._dir.entries();
  }

  /**
   * Get the inode index for a name.
   */
  getEntryIndex(name) {
    return this._dir.get(name);
  }

  /**
   * Get inode for a name.
   */
  getEntry(name) {
    const index = this._dir.get(name);
    if (index !== undefined) {
      return this._iNodeMgr.getINode(index);
    }
    return;
  }

  /**
   * Add a name to inode index to this directory.
   * It will increment the link reference to the inode.
   * It is not allowed to add entries with the names `.` and `..`.
   */
  addEntry(name, index) {
    if (name === '.' || name === '..') {
      throw new Error('Not allowed to add `.` or `..` entries');
    }
    const now = new Date();
    this._metadata.mtime = now;
    this._metadata.ctime = now;
    this._iNodeMgr.linkINode(this._iNodeMgr.getINode(index));
    this._dir.set(name, index);
    return;
  }

  /**
   * Delete a name in this directory.
   * It will decrement the link reference to the inode.
   * It is not allowed to delete entries with the names `.` and `..`.
   */
  deleteEntry(name) {
    if (name === '.' || name === '..') {
      throw new Error('Not allowed to delete `.` or `..` entries');
    }
    const index = this._dir.get(name);
    if (index !== undefined) {
      const now = new Date();
      this._metadata.mtime = now;
      this._metadata.ctime = now;
      this._dir.delete(name);
      this._iNodeMgr.unlinkINode(this._iNodeMgr.getINode(index));
    }
    return;
  }

  /**
   * Rename a name in this directory.
   */
  renameEntry(oldName, newName) {
    if (oldName === '.' || oldName === '..' || newName === '.' || oldName === '..') {
      throw new Error('Not allowed to rename `.` or `..` entries');
    }
    const index = this._dir.get(oldName);
    if (index != null) {
      const now = new Date();
      this._metadata.mtime = now;
      this._metadata.ctime = now;
      this._dir.delete(oldName);
      this._dir.set(newName, index);
    }
    return;
  }

  /**
   * This is to be called when all hardlinks and references to this directory reduce to 0.
   * The destructor here is about unlinking the parent directory.
   * Because the `..` will no longer exist.
   */
  destructor() {
    // decrement the parent's nlink due to '..'
    // however do not do this on root otherwise there will be an infinite loop
    if (this._dir.get('.') !== this._dir.get('..')) {
      const parentIndex = this._dir.get('..');
      if (parentIndex != null) {
        this._iNodeMgr.unlinkINode(this._iNodeMgr.getINode(parentIndex));
      }
    }
    return;
  }

}

/**
 * Class representing a Symlink.
 * @extends INode
 */
class Symlink extends INode {

  /**
   * Creates a symlink.
   */
  constructor(props, iNodeMgr) {
    super({
      ino: props.ino,
      mode: constants.S_IFLNK | props.mode & ~constants.S_IFMT,
      uid: props.uid,
      gid: props.gid,
      size: new TextEncoder().encode(props.link).byteLength
    }, iNodeMgr);
    this._link = props.link;
  }

  /**
   * Gets the link string.
   */
  getLink() {
    return this._link;
  }

  /**
   * Noop.
   */
  destructor() {
    return;
  }
}

/**
 * Class representing a character device.
 * @extends INode
 */
class CharacterDev extends INode {
  /**
   * Creates a character device.
   */
  constructor(props, iNodeMgr) {
    super({
      ino: props.ino,
      mode: constants.S_IFCHR | props.mode & ~constants.S_IFMT,
      uid: props.uid,
      gid: props.gid,
      rdev: props.rdev,
      size: 0
    }, iNodeMgr);
    this.teardown = props.teardown;
  }

  getFileDesOps() {
    const [major, minor] = unmkDev(this.getMetadata().rdev);
    return this._iNodeMgr._devMgr.getChr(major, minor);
  }

  destructor() {
    if (this.teardown !== undefined) {
      this.teardown();
    }
  }
}

/**
 * Class representing a named pipe.
 * @extends INode
 */
class Fifo extends INode {
  /**
   * Creates a named pipe.
   */
  constructor(props, iNodeMgr) {
    super({
      ino: props.ino,
      mode: constants.S_IFIFO | props.mode & ~constants.S_IFMT,
      uid: props.uid,
      gid: props.gid,
      size: 0
    }, iNodeMgr);
    this.KERN_W = 0;
    this.KERN_R = 1;
    this.CLOSERM = 2;
    this.teardown = props.teardown;
    this.reader = -1;
    this.writer = -1;
    this.messages = [];
    this.readQueue = [];
    this.pollQueue = [];
    this.mode = 0;
    this.currentOffset = 0;
  }

  setMode(request, state) {
    if (state) this.mode |= 1 << request;else this.mode &= ~(1 << request);
  }

  isKernW() {
    return (this.mode & 1 << this.KERN_W) !== 0;
  }

  isKernR() {
    return (this.mode & 1 << this.KERN_R) !== 0;
  }

  isCloserm() {
    return (this.mode & 1 << this.CLOSERM) !== 0;
  }

  notify(size) {
    for (let poll = this.pollQueue.shift(); poll !== undefined; poll = this.pollQueue.shift()) poll(size);
  }

  sendEof() {
    for (let read = this.readQueue.shift(); read !== undefined; read = this.readQueue.shift()) read(new ArrayBuffer());
    this.notify(0);
  }

  write(buf) {
    const req = this.readQueue.shift();
    if (req !== undefined) {
      req(buf);
      return;
    }
    this.messages.push(buf);
    this.notify(buf.byteLength);
  }

  read(bytes) {
    const buf = this.messages[0];

    if (buf === undefined) {
      if (this.writer === 0) // writer has already closed the fifo
        return new Uint8Array(new ArrayBuffer());

      return new Promise(resolve => {
        this.readQueue.push(resolve);
      });
    }

    if (buf.byteLength - this.currentOffset <= bytes) {
      this.messages.shift();
      const view = new Uint8Array(buf, this.currentOffset);
      this.currentOffset = 0;
      return view;
    }

    const view = new Uint8Array(buf, this.currentOffset, bytes);
    this.currentOffset += bytes;
    return view;
  }

  addPollSub() {
    if (this.messages.length !== 0) return Promise.resolve(this.messages[0].byteLength);

    return new Promise(resolve => {
      this.pollQueue.push(resolve);
    });
  }

  destructor() {
    if (this.teardown !== undefined) {
      this.teardown();
    }
  }
}

/**
 * Class that manages all iNodes including creation and deletion
 */
class INodeManager {

  /**
   * Creates an instance of the INodeManager.
   * It starts the inode counter at 1, as 0 is usually reserved in posix filesystems.
   */
  constructor(devMgr) {
    this._counter = new Counter(1);
    this._iNodes = new Map();
    this._iNodeRefs = new WeakMap();
    this._devMgr = devMgr;
  }

  /**
   * Creates an inode, from a INode constructor function.
   * The returned inode must be used and later manually deallocated.
   */
  createINode(iNodeConstructor, props = {}) {
    props.ino = this._counter.allocate();
    props.mode = typeof props.mode === 'number' ? props.mode : 0;
    props.uid = typeof props.uid === 'number' ? props.uid : DEFAULT_ROOT_UID;
    props.gid = typeof props.gid === 'number' ? props.gid : DEFAULT_ROOT_GID;
    const iNode = new iNodeConstructor(props, this);
    this._iNodes.set(props.ino, iNode);
    this._iNodeRefs.set(iNode, 0);
    return [iNode, props.ino];
  }

  /**
   * Gets the inode.
   */
  getINode(index) {
    return this._iNodes.get(index);
  }

  /**
   * Links an inode, this increments the hardlink reference count.
   */
  linkINode(iNode) {
    if (iNode) {
      ++iNode.getMetadata().nlink;
    }
    return;
  }

  /**
   * Unlinks an inode, this decrements the hardlink reference count.
   */
  unlinkINode(iNode) {
    if (iNode) {
      --iNode.getMetadata().nlink;
      this._gcINode(iNode);
    }
    return;
  }

  /**
   * References an inode, this increments the private reference count.
   * Private reference count can be used by file descriptors and working directory position.
   */
  refINode(iNode) {
    if (iNode) {
      const refCount = this._iNodeRefs.get(iNode);
      if (refCount !== undefined) {
        this._iNodeRefs.set(iNode, refCount + 1);
      }
    }
    return;
  }

  /**
   * Unreferences an inode, this decrements the private reference count.
   */
  unrefINode(iNode) {
    if (iNode) {
      const refCount = this._iNodeRefs.get(iNode);
      if (refCount !== undefined) {
        this._iNodeRefs.set(iNode, refCount - 1);
        this._gcINode(iNode);
      }
    }
    return;
  }

  /**
   * Decides whether to garbage collect the inode.
   * The true usage count is the hardlink count plus the private reference count.
   * Usually if the true usage count is 0, then the inode is garbage collected.
   * However directories are special cased here, due to the `.` circular hardlink.
   * This allows directories to be garbage collected even when their usage count is 1.
   * This is possible also because there cannot be custom hardlinks to directories.
   */
  _gcINode(iNode) {
    const metadata = iNode.getMetadata();
    const useCount = metadata.nlink + this._iNodeRefs.get(iNode);
    if (useCount === 0 || useCount === 1 && iNode instanceof Directory) {
      const index = metadata.ino;
      iNode.destructor();
      this._iNodes.delete(index);
      this._counter.deallocate(index);
    }
  }
}

/** @module VirtualFSError */

/**
 * Class representing a file system error.
 * @extends Error
 */
class VirtualFSError extends Error {

  /**
   * Creates VirtualFSError.
   */
  constructor(errnoObj, path, dest, syscall) {
    let message = errnoObj.code + ': ' + errnoObj.description;
    if (path != null) {
      message += ', ' + path;
      if (dest != null) message += ' -> ' + dest;
    }
    super(message);
    this.errno = errnoObj.errno;
    this.code = errnoObj.code;
    this.errnoDescription = errnoObj.description;
    if (syscall != null) {
      this.syscall = syscall;
    }
  }

  setPaths(src, dst) {
    let message = this.code + ': ' + this.errnoDescription + ', ' + src;
    if (dst != null) message += ' -> ' + dst;
    this.message = message;
    return;
  }

  setSyscall(syscall) {
    this.syscall = syscall;
  }
}

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

// $FlowFixMe: nextTick exists
/** @module VirtualFS */

/**
 * Prefer the posix join function if it exists.
 * Browser polyfills of the path module may not have the posix property.
 */
const pathJoin = pathNode.posix ? pathNode.posix.join : pathNode.join;

/**
 * Asynchronous callback backup.
 */
const callbackUp = err => {
  if (err) throw err;
};

/**
 * Class representing a virtual filesystem.
 */
class VirtualFS {

  /**
   * Creates VirtualFS.
   */
  constructor(umask$$1 = 0o022, rootIndex = null, devMgr = new DeviceManager(), iNodeMgr = new INodeManager(devMgr), fdMgr = new FileDescriptorManager(iNodeMgr)) {
    let rootNode;
    if (typeof rootIndex === 'number') {
      rootNode = iNodeMgr.getINode(rootIndex);
      if (!(rootNode instanceof Directory)) {
        throw TypeError('rootIndex must point to a root directory');
      }
    } else {
      [rootNode] = iNodeMgr.createINode(Directory, { mode: DEFAULT_ROOT_PERM, uid: DEFAULT_ROOT_UID, gid: DEFAULT_ROOT_GID });
    }
    this._uid = DEFAULT_ROOT_UID;
    this._gid = DEFAULT_ROOT_GID;
    this._umask = umask$$1;
    this._devMgr = devMgr;
    this._iNodeMgr = iNodeMgr;
    this._fdMgr = fdMgr;
    this._root = rootNode;
    this._cwd = new CurrentDirectory(iNodeMgr, rootNode);
    this.constants = constants;
  }

  getUmask() {
    return this._umask;
  }

  setUmask(umask$$1) {
    this._umask = umask$$1;
  }

  getUid() {
    return this._uid;
  }

  setUid(uid) {
    this._uid = uid;
  }

  getGid() {
    return this._gid;
  }

  setGid(gid) {
    this._gid = gid;
  }

  getCwd() {
    return this._cwd.getPath();
  }

  stat(path, callback = callbackUp) {
    this._callAsync(this.statSync.bind(this), [path], stat => callback(null, stat), callback);
    return;
  }

  statSync(path) {
    path = this._getPath(path);
    const target = this._navigate(path, true).target;
    if (target) {
      return new Stat(_extends({}, target.getMetadata()));
    } else {
      throw new VirtualFSError({ errno: 44 }, path);
    }
  }

  /**
   * Sets up an asynchronous call in accordance with Node behaviour.
   * This function should be implemented with microtask semantics.
   * Because the internal readable-stream package uses process.nextTick.
   * This must also use process.nextTick as well to be on the same queue.
   * It is required to polyfill the process.nextTick for browsers.
   * @private
   */
  _callAsync(syncFn, args, successCall, failCall) {
    nextTick(() => {
      try {
        let result = syncFn(...args);
        result = result === undefined ? null : result;
        successCall(result);
      } catch (e) {
        failCall(e);
      }
    });
    return;
  }

  /**
   * Processes path types and collapses it to a string.
   * The path types can be string or Buffer or URL.
   * @private
   */
  _getPath(path) {
    if (typeof path === 'string') {
      return path;
    }
    if (path instanceof ArrayBuffer) {
      return new TextDecoder().decode(path);
    }
    if (typeof path === 'object' && typeof path.pathname === 'string') {
      return this._getPathFromURL(path);
    }
    throw new TypeError('path must be a string or Buffer or URL');
  }

  /**
   * Acquires the file path from an URL object.
   * @private
   */
  _getPathFromURL(url) {
    if (url.hostname) {
      throw new TypeError('ERR_INVALID_FILE_URL_HOST');
    }
    const pathname = url.pathname;
    if (pathname.match(/%2[fF]/)) {
      // must not allow encoded slashes
      throw new TypeError('ERR_INVALID_FILE_URL_PATH');
    }
    return decodeURIComponent(pathname);
  }

  /**
   * Takes a default set of options, and merges them shallowly into the user provided options.
   * Object spread syntax will ignore an undefined or null options object.
   * @private
   */
  _getOptions(defaultOptions, options) {
    if (typeof options === 'string') {
      return _extends({}, defaultOptions, { encoding: options });
    } else {
      return _extends({}, defaultOptions, options);
    }
  }

  /**
   * Checks the permissions fixng the current uid and gid.
   * If the user is root, they can access anything.
   * @private
   */
  _checkPermissions(access, stat) {
    if (this._uid !== DEFAULT_ROOT_UID) {
      return checkPermissions(access, this._uid, this._gid, stat);
    } else {
      return true;
    }
  }

  /**
   * Parses and extracts the first path segment.
   * @private
   */
  _parsePath(pathS) {
    const matches = pathS.match(/^([\s\S]*?)(?:\/+|$)([\s\S]*)/);
    if (matches) {
      let segment = matches[1] || '';
      let rest = matches[2] || '';
      return {
        segment: segment,
        rest: rest
      };
    } else {
      // this should not happen
      throw new Error('Could not parse pathS: ' + pathS);
    }
  }

  /**
   * Navigates the filesystem tree from root.
   * You can interpret the results like:
   *   !target       => Non-existent segment
   *   name === ''   => Target is at root
   *   name === '.'  => dir is the same as target
   *   name === '..' => dir is a child directory
   * @private
   */
  _navigate(pathS, resolveLinks = true, origPathS = pathS) {
    if (pathS === undefined) {
      throw new VirtualFSError({ errno: 1 }, origPathS);
    }
    // multiple consecutive slashes are considered to be 1 slash
    pathS = pathS.replace(/\/+/, '/');
    // a trailing slash is considered to refer to a directory, thus it is converted to /.
    // functions that expect and specially handle missing directories should trim it away
    pathS = pathS.replace(/\/$/, '/.');
    if (pathS[0] === '/' || pathS === "") {
      pathS = pathS.substring(1);
      if (!pathS) {
        return {
          dir: this._root,
          target: this._root,
          name: '', // root is the only situation where the name is empty
          remaining: '',
          pathStack: []
        };
      } else {
        return this._navigateFrom(this._root, pathS, resolveLinks, [], origPathS);
      }
    } else {
      return this._navigateFrom(this._cwd.getINode(), pathS, resolveLinks, this._cwd.getPathStack(), origPathS);
    }
  }

  /**
   * Navigates the filesystem tree from a given directory.
   * You should not use this directly unless you first call _navigate and pass the remaining path to _navigateFrom.
   * Note that the pathStack is always the full path to the target.
   * @private
   */
  _navigateFrom(curdir, pathS, resolveLinks = true, pathStack = [], origPathS = pathS) {
    if (!pathS) {
      throw new VirtualFSError({ errno: 2 }, origPathS);
    }
    if (!this._checkPermissions(constants.X_OK, curdir.getMetadata())) {
      throw new VirtualFSError({ errno: 3 }, origPathS);
    }
    let parse = this._parsePath(pathS);
    if (parse.segment !== '.') {
      if (parse.segment === '..') {
        pathStack.pop(); // this is a noop if the pathStack is empty
      } else {
        pathStack.push(parse.segment);
      }
    }
    let nextDir;
    let nextPath;
    let target = curdir.getEntry(parse.segment);
    if (target instanceof File || target instanceof CharacterDev || target instanceof Fifo) {
      if (!parse.rest) {
        return {
          dir: curdir,
          target: target,
          name: parse.segment,
          remaining: '',
          pathStack: pathStack
        };
      }
      throw new VirtualFSError({ errno: 4 }, origPathS);
    } else if (target instanceof Directory) {
      if (!parse.rest) {
        // if parse.segment is ., dir is not the same directory as target
        // if parse.segment is .., dir is the child directory
        return {
          dir: curdir,
          target: target,
          name: parse.segment,
          remaining: '',
          pathStack: pathStack
        };
      }
      nextDir = target;
      nextPath = parse.rest;
    } else if (target instanceof Symlink) {
      if (!resolveLinks) {
        return {
          dir: curdir,
          target: target,
          name: parse.segment,
          remaining: parse.rest,
          pathStack: pathStack
        };
      }
      // although symlinks should not have an empty links, it's still handled correctly here
      nextPath = pathJoin(target.getLink(), parse.rest);
      if (nextPath[0] === '/') {
        return this._navigate(nextPath, resolveLinks, origPathS);
      } else {
        pathStack.pop();
        nextDir = curdir;
      }
    } else {
      return {
        dir: curdir,
        target: null,
        name: parse.segment,
        remaining: parse.rest,
        pathStack: pathStack
      };
    }
    return this._navigateFrom(nextDir, nextPath, resolveLinks, pathStack, origPathS);
  }
}

/** @module FileDescriptors */

/**
 * Class representing a File Descriptor
 */
class FileDescriptor {

  /**
   * Creates FileDescriptor
   * Starts the seek position at 0
   */
  constructor(iNode, flags) {
    this._iNode = iNode;
    this._flags = flags;
    this._pos = 0;
  }

  /**
   * Gets an INode.
   */
  getINode() {
    return this._iNode;
  }

  /**
   * Gets the file descriptor flags.
   * Unlike Linux filesystems, this retains creation and status flags.
   */
  getFlags() {
    return this._flags;
  }

  /**
   * Sets the file descriptor flags.
   */
  setFlags(flags) {
    this._flags = flags;
    return;
  }

  /**
   * Gets the file descriptor position.
   */
  getPos() {
    return this._pos;
  }
}

/**
 * Class that manages all FileDescriptors
 */
class FileDescriptorManager$1 {

  /**
   * Creates an instance of the FileDescriptorManager.
   * It starts the fd counter at 0.
   * Make sure not get real fd numbers confused with these fd numbers.
   */
  constructor(iNodeMgr) {
    this._counter = new Counter(0);
    this._fds = new Map();
    this._iNodeMgr = iNodeMgr;
  }

  /**
   * Creates a file descriptor.
   * This will increment the reference to the iNode preventing garbage collection by the INodeManager.
   */
  createFd(iNode, flags) {
    this._iNodeMgr.refINode(iNode);
    const index = this._counter.allocate();
    const fd = new FileDescriptor(iNode, flags);
    if (iNode instanceof CharacterDev) {
      const fops = iNode.getFileDesOps();
      fops.open(fd);
    }

    this._fds.set(index, fd);

    return [fd, index];
  }

  /**
   * Gets the file descriptor object.
   */
  getFd(index) {
    return this._fds.get(index);
  }

  /**
   * Duplicates file descriptor index.
   * It may return a new file descriptor index that points to the same file descriptor.
   */
  dupFd(index) {
    const fd = this._fds.get(index);
    if (fd) {
      this._iNodeMgr.refINode(fd.getINode());
      const dupIndex = this._counter.allocate();
      this._fds.set(dupIndex, fd);
      return index;
    }
  }

  /**
   * Deletes a file descriptor.
   * This effectively closes the file descriptor.
   * This will decrement the reference to the iNode allowing garbage collection by the INodeManager.
   */
  deleteFd(fdIndex) {
    const fd = this._fds.get(fdIndex);
    if (fd) {
      const iNode = fd.getINode();
      if (iNode instanceof CharacterDev) {
        const fops = iNode.getFileDesOps();
        fops.close(fd);
      }
      this._fds.delete(fdIndex);
      this._counter.deallocate(fdIndex);
      this._iNodeMgr.unrefINode(iNode);
    }
    return;
  }
}

export { VirtualFS, Stat, constants, VirtualFSError, MAJOR_BITSIZE, MINOR_BITSIZE, MAJOR_MAX, MINOR_MAX, MAJOR_MIN, MINOR_MIN, DeviceManager, DeviceError, mkDev, unmkDev, File, Directory, Symlink, CharacterDev, INodeManager, Fifo, FileDescriptor, FileDescriptorManager$1 as FileDescriptorManager };
