var global$1 = (typeof global !== "undefined" ? global :
            typeof self !== "undefined" ? self :
            typeof window !== "undefined" ? window : {});

var lookup = [];
var revLookup = [];
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array;
var inited = false;
function init () {
  inited = true;
  var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (var i = 0, len = code.length; i < len; ++i) {
    lookup[i] = code[i];
    revLookup[code.charCodeAt(i)] = i;
  }

  revLookup['-'.charCodeAt(0)] = 62;
  revLookup['_'.charCodeAt(0)] = 63;
}

function toByteArray (b64) {
  if (!inited) {
    init();
  }
  var i, j, l, tmp, placeHolders, arr;
  var len = b64.length;

  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // the number of equal signs (place holders)
  // if there are two placeholders, than the two characters before it
  // represent one byte
  // if there is only one, then the three characters before it represent 2 bytes
  // this is just a cheap hack to not do indexOf twice
  placeHolders = b64[len - 2] === '=' ? 2 : b64[len - 1] === '=' ? 1 : 0;

  // base64 is 4/3 + up to two characters of the original data
  arr = new Arr(len * 3 / 4 - placeHolders);

  // if there are placeholders, only get up to the last complete 4 chars
  l = placeHolders > 0 ? len - 4 : len;

  var L = 0;

  for (i = 0, j = 0; i < l; i += 4, j += 3) {
    tmp = (revLookup[b64.charCodeAt(i)] << 18) | (revLookup[b64.charCodeAt(i + 1)] << 12) | (revLookup[b64.charCodeAt(i + 2)] << 6) | revLookup[b64.charCodeAt(i + 3)];
    arr[L++] = (tmp >> 16) & 0xFF;
    arr[L++] = (tmp >> 8) & 0xFF;
    arr[L++] = tmp & 0xFF;
  }

  if (placeHolders === 2) {
    tmp = (revLookup[b64.charCodeAt(i)] << 2) | (revLookup[b64.charCodeAt(i + 1)] >> 4);
    arr[L++] = tmp & 0xFF;
  } else if (placeHolders === 1) {
    tmp = (revLookup[b64.charCodeAt(i)] << 10) | (revLookup[b64.charCodeAt(i + 1)] << 4) | (revLookup[b64.charCodeAt(i + 2)] >> 2);
    arr[L++] = (tmp >> 8) & 0xFF;
    arr[L++] = tmp & 0xFF;
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp;
  var output = [];
  for (var i = start; i < end; i += 3) {
    tmp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2]);
    output.push(tripletToBase64(tmp));
  }
  return output.join('')
}

function fromByteArray (uint8) {
  if (!inited) {
    init();
  }
  var tmp;
  var len = uint8.length;
  var extraBytes = len % 3; // if we have 1 byte left, pad 2 bytes
  var output = '';
  var parts = [];
  var maxChunkLength = 16383; // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)));
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1];
    output += lookup[tmp >> 2];
    output += lookup[(tmp << 4) & 0x3F];
    output += '==';
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + (uint8[len - 1]);
    output += lookup[tmp >> 10];
    output += lookup[(tmp >> 4) & 0x3F];
    output += lookup[(tmp << 2) & 0x3F];
    output += '=';
  }

  parts.push(output);

  return parts.join('')
}

function read (buffer, offset, isLE, mLen, nBytes) {
  var e, m;
  var eLen = nBytes * 8 - mLen - 1;
  var eMax = (1 << eLen) - 1;
  var eBias = eMax >> 1;
  var nBits = -7;
  var i = isLE ? (nBytes - 1) : 0;
  var d = isLE ? -1 : 1;
  var s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

function write (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c;
  var eLen = nBytes * 8 - mLen - 1;
  var eMax = (1 << eLen) - 1;
  var eBias = eMax >> 1;
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0);
  var i = isLE ? 0 : (nBytes - 1);
  var d = isLE ? 1 : -1;
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128;
}

var toString = {}.toString;

var isArray = Array.isArray || function (arr) {
  return toString.call(arr) == '[object Array]';
};

/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */


var INSPECT_MAX_BYTES = 50;

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = global$1.TYPED_ARRAY_SUPPORT !== undefined
  ? global$1.TYPED_ARRAY_SUPPORT
  : true;

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

function createBuffer (that, length) {
  if (kMaxLength() < length) {
    throw new RangeError('Invalid typed array length')
  }
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = new Uint8Array(length);
    that.__proto__ = Buffer.prototype;
  } else {
    // Fallback: Return an object instance of the Buffer class
    if (that === null) {
      that = new Buffer(length);
    }
    that.length = length;
  }

  return that
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  if (!Buffer.TYPED_ARRAY_SUPPORT && !(this instanceof Buffer)) {
    return new Buffer(arg, encodingOrOffset, length)
  }

  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new Error(
        'If encoding is specified then the first argument must be a string'
      )
    }
    return allocUnsafe(this, arg)
  }
  return from(this, arg, encodingOrOffset, length)
}

Buffer.poolSize = 8192; // not used by this implementation

// TODO: Legacy, not needed anymore. Remove in next major version.
Buffer._augment = function (arr) {
  arr.__proto__ = Buffer.prototype;
  return arr
};

function from (that, value, encodingOrOffset, length) {
  if (typeof value === 'number') {
    throw new TypeError('"value" argument must not be a number')
  }

  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return fromArrayBuffer(that, value, encodingOrOffset, length)
  }

  if (typeof value === 'string') {
    return fromString(that, value, encodingOrOffset)
  }

  return fromObject(that, value)
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(null, value, encodingOrOffset, length)
};

if (Buffer.TYPED_ARRAY_SUPPORT) {
  Buffer.prototype.__proto__ = Uint8Array.prototype;
  Buffer.__proto__ = Uint8Array;
  
}

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be a number')
  } else if (size < 0) {
    throw new RangeError('"size" argument must not be negative')
  }
}

function alloc (that, size, fill, encoding) {
  assertSize(size);
  if (size <= 0) {
    return createBuffer(that, size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(that, size).fill(fill, encoding)
      : createBuffer(that, size).fill(fill)
  }
  return createBuffer(that, size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(null, size, fill, encoding)
};

function allocUnsafe (that, size) {
  assertSize(size);
  that = createBuffer(that, size < 0 ? 0 : checked(size) | 0);
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < size; ++i) {
      that[i] = 0;
    }
  }
  return that
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(null, size)
};
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(null, size)
};

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8';
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('"encoding" must be a valid string encoding')
  }

  var length = byteLength(string, encoding) | 0;
  that = createBuffer(that, length);

  var actual = that.write(string, encoding);

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    that = that.slice(0, actual);
  }

  return that
}

function fromArrayLike (that, array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0;
  that = createBuffer(that, length);
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255;
  }
  return that
}

function fromArrayBuffer (that, array, byteOffset, length) {
  array.byteLength; // this throws if `array` is not a valid ArrayBuffer

  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('\'offset\' is out of bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('\'length\' is out of bounds')
  }

  if (byteOffset === undefined && length === undefined) {
    array = new Uint8Array(array);
  } else if (length === undefined) {
    array = new Uint8Array(array, byteOffset);
  } else {
    array = new Uint8Array(array, byteOffset, length);
  }

  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = array;
    that.__proto__ = Buffer.prototype;
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromArrayLike(that, array);
  }
  return that
}

function fromObject (that, obj) {
  if (internalIsBuffer(obj)) {
    var len = checked(obj.length) | 0;
    that = createBuffer(that, len);

    if (that.length === 0) {
      return that
    }

    obj.copy(that, 0, 0, len);
    return that
  }

  if (obj) {
    if ((typeof ArrayBuffer !== 'undefined' &&
        obj.buffer instanceof ArrayBuffer) || 'length' in obj) {
      if (typeof obj.length !== 'number' || isnan(obj.length)) {
        return createBuffer(that, 0)
      }
      return fromArrayLike(that, obj)
    }

    if (obj.type === 'Buffer' && isArray(obj.data)) {
      return fromArrayLike(that, obj.data)
    }
  }

  throw new TypeError('First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.')
}

function checked (length) {
  // Note: cannot use `length < kMaxLength()` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}


Buffer.isBuffer = isBuffer;
function internalIsBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!internalIsBuffer(a) || !internalIsBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length;
  var y = b.length;

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i];
      y = b[i];
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
};

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
};

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i;
  if (length === undefined) {
    length = 0;
    for (i = 0; i < list.length; ++i) {
      length += list[i].length;
    }
  }

  var buffer = Buffer.allocUnsafe(length);
  var pos = 0;
  for (i = 0; i < list.length; ++i) {
    var buf = list[i];
    if (!internalIsBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos);
    pos += buf.length;
  }
  return buffer
};

function byteLength (string, encoding) {
  if (internalIsBuffer(string)) {
    return string.length
  }
  if (typeof ArrayBuffer !== 'undefined' && typeof ArrayBuffer.isView === 'function' &&
      (ArrayBuffer.isView(string) || string instanceof ArrayBuffer)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    string = '' + string;
  }

  var len = string.length;
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false;
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
      case undefined:
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase();
        loweredCase = true;
    }
  }
}
Buffer.byteLength = byteLength;

function slowToString (encoding, start, end) {
  var loweredCase = false;

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0;
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length;
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0;
  start >>>= 0;

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8';

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase();
        loweredCase = true;
    }
  }
}

// The property is used by `Buffer.isBuffer` and `is-buffer` (in Safari 5-7) to detect
// Buffer instances.
Buffer.prototype._isBuffer = true;

function swap (b, n, m) {
  var i = b[n];
  b[n] = b[m];
  b[m] = i;
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length;
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1);
  }
  return this
};

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length;
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3);
    swap(this, i + 1, i + 2);
  }
  return this
};

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length;
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7);
    swap(this, i + 1, i + 6);
    swap(this, i + 2, i + 5);
    swap(this, i + 3, i + 4);
  }
  return this
};

Buffer.prototype.toString = function toString () {
  var length = this.length | 0;
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
};

Buffer.prototype.equals = function equals (b) {
  if (!internalIsBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
};

Buffer.prototype.inspect = function inspect () {
  var str = '';
  var max = INSPECT_MAX_BYTES;
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ');
    if (this.length > max) str += ' ... ';
  }
  return '<Buffer ' + str + '>'
};

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (!internalIsBuffer(target)) {
    throw new TypeError('Argument must be a Buffer')
  }

  if (start === undefined) {
    start = 0;
  }
  if (end === undefined) {
    end = target ? target.length : 0;
  }
  if (thisStart === undefined) {
    thisStart = 0;
  }
  if (thisEnd === undefined) {
    thisEnd = this.length;
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0;
  end >>>= 0;
  thisStart >>>= 0;
  thisEnd >>>= 0;

  if (this === target) return 0

  var x = thisEnd - thisStart;
  var y = end - start;
  var len = Math.min(x, y);

  var thisCopy = this.slice(thisStart, thisEnd);
  var targetCopy = target.slice(start, end);

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i];
      y = targetCopy[i];
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
};

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset;
    byteOffset = 0;
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff;
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000;
  }
  byteOffset = +byteOffset;  // Coerce to Number.
  if (isNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1);
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1;
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0;
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding);
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (internalIsBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF; // Search for a byte value [0-255]
    if (Buffer.TYPED_ARRAY_SUPPORT &&
        typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1;
  var arrLength = arr.length;
  var valLength = val.length;

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase();
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2;
      arrLength /= 2;
      valLength /= 2;
      byteOffset /= 2;
    }
  }

  function read$$1 (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i;
  if (dir) {
    var foundIndex = -1;
    for (i = byteOffset; i < arrLength; i++) {
      if (read$$1(arr, i) === read$$1(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i;
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex;
        foundIndex = -1;
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
    for (i = byteOffset; i >= 0; i--) {
      var found = true;
      for (var j = 0; j < valLength; j++) {
        if (read$$1(arr, i + j) !== read$$1(val, j)) {
          found = false;
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
};

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
};

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
};

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0;
  var remaining = buf.length - offset;
  if (!length) {
    length = remaining;
  } else {
    length = Number(length);
    if (length > remaining) {
      length = remaining;
    }
  }

  // must be an even number of digits
  var strLen = string.length;
  if (strLen % 2 !== 0) throw new TypeError('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2;
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16);
    if (isNaN(parsed)) return i
    buf[offset + i] = parsed;
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write$$1 (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8';
    length = this.length;
    offset = 0;
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset;
    length = this.length;
    offset = 0;
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0;
    if (isFinite(length)) {
      length = length | 0;
      if (encoding === undefined) encoding = 'utf8';
    } else {
      encoding = length;
      length = undefined;
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset;
  if (length === undefined || length > remaining) length = remaining;

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8';

  var loweredCase = false;
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase();
        loweredCase = true;
    }
  }
};

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
};

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return fromByteArray(buf)
  } else {
    return fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end);
  var res = [];

  var i = start;
  while (i < end) {
    var firstByte = buf[i];
    var codePoint = null;
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1;

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint;

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte;
          }
          break
        case 2:
          secondByte = buf[i + 1];
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F);
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint;
            }
          }
          break
        case 3:
          secondByte = buf[i + 1];
          thirdByte = buf[i + 2];
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F);
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint;
            }
          }
          break
        case 4:
          secondByte = buf[i + 1];
          thirdByte = buf[i + 2];
          fourthByte = buf[i + 3];
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F);
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint;
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD;
      bytesPerSequence = 1;
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000;
      res.push(codePoint >>> 10 & 0x3FF | 0xD800);
      codePoint = 0xDC00 | codePoint & 0x3FF;
    }

    res.push(codePoint);
    i += bytesPerSequence;
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000;

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length;
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = '';
  var i = 0;
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    );
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = '';
  end = Math.min(buf.length, end);

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F);
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = '';
  end = Math.min(buf.length, end);

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i]);
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length;

  if (!start || start < 0) start = 0;
  if (!end || end < 0 || end > len) end = len;

  var out = '';
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i]);
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end);
  var res = '';
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length;
  start = ~~start;
  end = end === undefined ? len : ~~end;

  if (start < 0) {
    start += len;
    if (start < 0) start = 0;
  } else if (start > len) {
    start = len;
  }

  if (end < 0) {
    end += len;
    if (end < 0) end = 0;
  } else if (end > len) {
    end = len;
  }

  if (end < start) end = start;

  var newBuf;
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = this.subarray(start, end);
    newBuf.__proto__ = Buffer.prototype;
  } else {
    var sliceLen = end - start;
    newBuf = new Buffer(sliceLen, undefined);
    for (var i = 0; i < sliceLen; ++i) {
      newBuf[i] = this[i + start];
    }
  }

  return newBuf
};

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0;
  byteLength = byteLength | 0;
  if (!noAssert) checkOffset(offset, byteLength, this.length);

  var val = this[offset];
  var mul = 1;
  var i = 0;
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul;
  }

  return val
};

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0;
  byteLength = byteLength | 0;
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length);
  }

  var val = this[offset + --byteLength];
  var mul = 1;
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul;
  }

  return val
};

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length);
  return this[offset]
};

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length);
  return this[offset] | (this[offset + 1] << 8)
};

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length);
  return (this[offset] << 8) | this[offset + 1]
};

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length);

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
};

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length);

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
};

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0;
  byteLength = byteLength | 0;
  if (!noAssert) checkOffset(offset, byteLength, this.length);

  var val = this[offset];
  var mul = 1;
  var i = 0;
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul;
  }
  mul *= 0x80;

  if (val >= mul) val -= Math.pow(2, 8 * byteLength);

  return val
};

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0;
  byteLength = byteLength | 0;
  if (!noAssert) checkOffset(offset, byteLength, this.length);

  var i = byteLength;
  var mul = 1;
  var val = this[offset + --i];
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul;
  }
  mul *= 0x80;

  if (val >= mul) val -= Math.pow(2, 8 * byteLength);

  return val
};

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length);
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
};

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length);
  var val = this[offset] | (this[offset + 1] << 8);
  return (val & 0x8000) ? val | 0xFFFF0000 : val
};

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length);
  var val = this[offset + 1] | (this[offset] << 8);
  return (val & 0x8000) ? val | 0xFFFF0000 : val
};

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length);

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
};

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length);

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
};

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length);
  return read(this, offset, true, 23, 4)
};

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length);
  return read(this, offset, false, 23, 4)
};

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length);
  return read(this, offset, true, 52, 8)
};

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length);
  return read(this, offset, false, 52, 8)
};

function checkInt (buf, value, offset, ext, max, min) {
  if (!internalIsBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value;
  offset = offset | 0;
  byteLength = byteLength | 0;
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1;
    checkInt(this, value, offset, byteLength, maxBytes, 0);
  }

  var mul = 1;
  var i = 0;
  this[offset] = value & 0xFF;
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF;
  }

  return offset + byteLength
};

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value;
  offset = offset | 0;
  byteLength = byteLength | 0;
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1;
    checkInt(this, value, offset, byteLength, maxBytes, 0);
  }

  var i = byteLength - 1;
  var mul = 1;
  this[offset + i] = value & 0xFF;
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF;
  }

  return offset + byteLength
};

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value;
  offset = offset | 0;
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0);
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value);
  this[offset] = (value & 0xff);
  return offset + 1
};

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1;
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; ++i) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8;
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value;
  offset = offset | 0;
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0);
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff);
    this[offset + 1] = (value >>> 8);
  } else {
    objectWriteUInt16(this, value, offset, true);
  }
  return offset + 2
};

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value;
  offset = offset | 0;
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0);
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8);
    this[offset + 1] = (value & 0xff);
  } else {
    objectWriteUInt16(this, value, offset, false);
  }
  return offset + 2
};

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1;
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; ++i) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff;
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value;
  offset = offset | 0;
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0);
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24);
    this[offset + 2] = (value >>> 16);
    this[offset + 1] = (value >>> 8);
    this[offset] = (value & 0xff);
  } else {
    objectWriteUInt32(this, value, offset, true);
  }
  return offset + 4
};

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value;
  offset = offset | 0;
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0);
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24);
    this[offset + 1] = (value >>> 16);
    this[offset + 2] = (value >>> 8);
    this[offset + 3] = (value & 0xff);
  } else {
    objectWriteUInt32(this, value, offset, false);
  }
  return offset + 4
};

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value;
  offset = offset | 0;
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1);

    checkInt(this, value, offset, byteLength, limit - 1, -limit);
  }

  var i = 0;
  var mul = 1;
  var sub = 0;
  this[offset] = value & 0xFF;
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1;
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF;
  }

  return offset + byteLength
};

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value;
  offset = offset | 0;
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1);

    checkInt(this, value, offset, byteLength, limit - 1, -limit);
  }

  var i = byteLength - 1;
  var mul = 1;
  var sub = 0;
  this[offset + i] = value & 0xFF;
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1;
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF;
  }

  return offset + byteLength
};

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value;
  offset = offset | 0;
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80);
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value);
  if (value < 0) value = 0xff + value + 1;
  this[offset] = (value & 0xff);
  return offset + 1
};

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value;
  offset = offset | 0;
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000);
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff);
    this[offset + 1] = (value >>> 8);
  } else {
    objectWriteUInt16(this, value, offset, true);
  }
  return offset + 2
};

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value;
  offset = offset | 0;
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000);
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8);
    this[offset + 1] = (value & 0xff);
  } else {
    objectWriteUInt16(this, value, offset, false);
  }
  return offset + 2
};

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value;
  offset = offset | 0;
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000);
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff);
    this[offset + 1] = (value >>> 8);
    this[offset + 2] = (value >>> 16);
    this[offset + 3] = (value >>> 24);
  } else {
    objectWriteUInt32(this, value, offset, true);
  }
  return offset + 4
};

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value;
  offset = offset | 0;
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000);
  if (value < 0) value = 0xffffffff + value + 1;
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24);
    this[offset + 1] = (value >>> 16);
    this[offset + 2] = (value >>> 8);
    this[offset + 3] = (value & 0xff);
  } else {
    objectWriteUInt32(this, value, offset, false);
  }
  return offset + 4
};

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38);
  }
  write(buf, value, offset, littleEndian, 23, 4);
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
};

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
};

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308);
  }
  write(buf, value, offset, littleEndian, 52, 8);
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
};

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
};

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0;
  if (!end && end !== 0) end = this.length;
  if (targetStart >= target.length) targetStart = target.length;
  if (!targetStart) targetStart = 0;
  if (end > 0 && end < start) end = start;

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length;
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start;
  }

  var len = end - start;
  var i;

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start];
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; ++i) {
      target[i + targetStart] = this[i + start];
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, start + len),
      targetStart
    );
  }

  return len
};

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start;
      start = 0;
      end = this.length;
    } else if (typeof end === 'string') {
      encoding = end;
      end = this.length;
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0);
      if (code < 256) {
        val = code;
      }
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
  } else if (typeof val === 'number') {
    val = val & 255;
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0;
  end = end === undefined ? this.length : end >>> 0;

  if (!val) val = 0;

  var i;
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val;
    }
  } else {
    var bytes = internalIsBuffer(val)
      ? val
      : utf8ToBytes(new Buffer(val, encoding).toString());
    var len = bytes.length;
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len];
    }
  }

  return this
};

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g;

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '');
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '=';
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity;
  var codePoint;
  var length = string.length;
  var leadSurrogate = null;
  var bytes = [];

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i);

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
          continue
        }

        // valid lead
        leadSurrogate = codePoint;

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
        leadSurrogate = codePoint;
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000;
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
    }

    leadSurrogate = null;

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      );
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      );
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      );
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = [];
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF);
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo;
  var byteArray = [];
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i);
    hi = c >> 8;
    lo = c % 256;
    byteArray.push(lo);
    byteArray.push(hi);
  }

  return byteArray
}


function base64ToBytes (str) {
  return toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i];
  }
  return i
}

function isnan (val) {
  return val !== val // eslint-disable-line no-self-compare
}


// the following is from is-buffer, also by Feross Aboukhadijeh and with same lisence
// The _isBuffer check is for Safari 5-7 support, because it's missing
// Object.prototype.constructor. Remove this eventually
function isBuffer(obj) {
  return obj != null && (!!obj._isBuffer || isFastBuffer(obj) || isSlowBuffer(obj))
}

function isFastBuffer (obj) {
  return !!obj.constructor && typeof obj.constructor.isBuffer === 'function' && obj.constructor.isBuffer(obj)
}

// For Node v0.10 support. Remove this eventually.
function isSlowBuffer (obj) {
  return typeof obj.readFloatLE === 'function' && typeof obj.slice === 'function' && isFastBuffer(obj.slice(0, 0))
}

var commonjsGlobal = typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};



function unwrapExports (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

function createCommonjsModule(fn, module) {
	return module = { exports: {} }, fn(module, module.exports), module.exports;
}

// 7.1.4 ToInteger
var ceil = Math.ceil;
var floor = Math.floor;
var _toInteger = function (it) {
  return isNaN(it = +it) ? 0 : (it > 0 ? floor : ceil)(it);
};

// 7.2.1 RequireObjectCoercible(argument)
var _defined = function (it) {
  if (it == undefined) throw TypeError("Can't call method on  " + it);
  return it;
};

// true  -> String#at
// false -> String#codePointAt
var _stringAt = function (TO_STRING) {
  return function (that, pos) {
    var s = String(_defined(that));
    var i = _toInteger(pos);
    var l = s.length;
    var a, b;
    if (i < 0 || i >= l) return TO_STRING ? '' : undefined;
    a = s.charCodeAt(i);
    return a < 0xd800 || a > 0xdbff || i + 1 === l || (b = s.charCodeAt(i + 1)) < 0xdc00 || b > 0xdfff
      ? TO_STRING ? s.charAt(i) : a
      : TO_STRING ? s.slice(i, i + 2) : (a - 0xd800 << 10) + (b - 0xdc00) + 0x10000;
  };
};

var _library = true;

var _global = createCommonjsModule(function (module) {
// https://github.com/zloirock/core-js/issues/86#issuecomment-115759028
var global = module.exports = typeof window != 'undefined' && window.Math == Math
  ? window : typeof self != 'undefined' && self.Math == Math ? self
  // eslint-disable-next-line no-new-func
  : Function('return this')();
if (typeof __g == 'number') __g = global; // eslint-disable-line no-undef
});

var _core = createCommonjsModule(function (module) {
var core = module.exports = { version: '2.6.12' };
if (typeof __e == 'number') __e = core; // eslint-disable-line no-undef
});

var _core_1 = _core.version;

var _aFunction = function (it) {
  if (typeof it != 'function') throw TypeError(it + ' is not a function!');
  return it;
};

// optional / simple context binding

var _ctx = function (fn, that, length) {
  _aFunction(fn);
  if (that === undefined) return fn;
  switch (length) {
    case 1: return function (a) {
      return fn.call(that, a);
    };
    case 2: return function (a, b) {
      return fn.call(that, a, b);
    };
    case 3: return function (a, b, c) {
      return fn.call(that, a, b, c);
    };
  }
  return function (/* ...args */) {
    return fn.apply(that, arguments);
  };
};

var _isObject = function (it) {
  return typeof it === 'object' ? it !== null : typeof it === 'function';
};

var _anObject = function (it) {
  if (!_isObject(it)) throw TypeError(it + ' is not an object!');
  return it;
};

var _fails = function (exec) {
  try {
    return !!exec();
  } catch (e) {
    return true;
  }
};

// Thank's IE8 for his funny defineProperty
var _descriptors = !_fails(function () {
  return Object.defineProperty({}, 'a', { get: function () { return 7; } }).a != 7;
});

var document$1 = _global.document;
// typeof document.createElement is 'object' in old IE
var is = _isObject(document$1) && _isObject(document$1.createElement);
var _domCreate = function (it) {
  return is ? document$1.createElement(it) : {};
};

var _ie8DomDefine = !_descriptors && !_fails(function () {
  return Object.defineProperty(_domCreate('div'), 'a', { get: function () { return 7; } }).a != 7;
});

// 7.1.1 ToPrimitive(input [, PreferredType])

// instead of the ES6 spec version, we didn't implement @@toPrimitive case
// and the second argument - flag - preferred type is a string
var _toPrimitive = function (it, S) {
  if (!_isObject(it)) return it;
  var fn, val;
  if (S && typeof (fn = it.toString) == 'function' && !_isObject(val = fn.call(it))) return val;
  if (typeof (fn = it.valueOf) == 'function' && !_isObject(val = fn.call(it))) return val;
  if (!S && typeof (fn = it.toString) == 'function' && !_isObject(val = fn.call(it))) return val;
  throw TypeError("Can't convert object to primitive value");
};

var dP = Object.defineProperty;

var f = _descriptors ? Object.defineProperty : function defineProperty(O, P, Attributes) {
  _anObject(O);
  P = _toPrimitive(P, true);
  _anObject(Attributes);
  if (_ie8DomDefine) try {
    return dP(O, P, Attributes);
  } catch (e) { /* empty */ }
  if ('get' in Attributes || 'set' in Attributes) throw TypeError('Accessors not supported!');
  if ('value' in Attributes) O[P] = Attributes.value;
  return O;
};

var _objectDp = {
	f: f
};

var _propertyDesc = function (bitmap, value) {
  return {
    enumerable: !(bitmap & 1),
    configurable: !(bitmap & 2),
    writable: !(bitmap & 4),
    value: value
  };
};

var _hide = _descriptors ? function (object, key, value) {
  return _objectDp.f(object, key, _propertyDesc(1, value));
} : function (object, key, value) {
  object[key] = value;
  return object;
};

var hasOwnProperty = {}.hasOwnProperty;
var _has = function (it, key) {
  return hasOwnProperty.call(it, key);
};

var PROTOTYPE = 'prototype';

var $export = function (type, name, source) {
  var IS_FORCED = type & $export.F;
  var IS_GLOBAL = type & $export.G;
  var IS_STATIC = type & $export.S;
  var IS_PROTO = type & $export.P;
  var IS_BIND = type & $export.B;
  var IS_WRAP = type & $export.W;
  var exports = IS_GLOBAL ? _core : _core[name] || (_core[name] = {});
  var expProto = exports[PROTOTYPE];
  var target = IS_GLOBAL ? _global : IS_STATIC ? _global[name] : (_global[name] || {})[PROTOTYPE];
  var key, own, out;
  if (IS_GLOBAL) source = name;
  for (key in source) {
    // contains in native
    own = !IS_FORCED && target && target[key] !== undefined;
    if (own && _has(exports, key)) continue;
    // export native or passed
    out = own ? target[key] : source[key];
    // prevent global pollution for namespaces
    exports[key] = IS_GLOBAL && typeof target[key] != 'function' ? source[key]
    // bind timers to global for call from export context
    : IS_BIND && own ? _ctx(out, _global)
    // wrap global constructors for prevent change them in library
    : IS_WRAP && target[key] == out ? (function (C) {
      var F = function (a, b, c) {
        if (this instanceof C) {
          switch (arguments.length) {
            case 0: return new C();
            case 1: return new C(a);
            case 2: return new C(a, b);
          } return new C(a, b, c);
        } return C.apply(this, arguments);
      };
      F[PROTOTYPE] = C[PROTOTYPE];
      return F;
    // make static versions for prototype methods
    })(out) : IS_PROTO && typeof out == 'function' ? _ctx(Function.call, out) : out;
    // export proto methods to core.%CONSTRUCTOR%.methods.%NAME%
    if (IS_PROTO) {
      (exports.virtual || (exports.virtual = {}))[key] = out;
      // export proto methods to core.%CONSTRUCTOR%.prototype.%NAME%
      if (type & $export.R && expProto && !expProto[key]) _hide(expProto, key, out);
    }
  }
};
// type bitmap
$export.F = 1;   // forced
$export.G = 2;   // global
$export.S = 4;   // static
$export.P = 8;   // proto
$export.B = 16;  // bind
$export.W = 32;  // wrap
$export.U = 64;  // safe
$export.R = 128; // real proto method for `library`
var _export = $export;

var _redefine = _hide;

var _iterators = {};

var toString$1 = {}.toString;

var _cof = function (it) {
  return toString$1.call(it).slice(8, -1);
};

// fallback for non-array-like ES3 and non-enumerable old V8 strings

// eslint-disable-next-line no-prototype-builtins
var _iobject = Object('z').propertyIsEnumerable(0) ? Object : function (it) {
  return _cof(it) == 'String' ? it.split('') : Object(it);
};

// to indexed object, toObject with fallback for non-array-like ES3 strings


var _toIobject = function (it) {
  return _iobject(_defined(it));
};

// 7.1.15 ToLength

var min = Math.min;
var _toLength = function (it) {
  return it > 0 ? min(_toInteger(it), 0x1fffffffffffff) : 0; // pow(2, 53) - 1 == 9007199254740991
};

var max = Math.max;
var min$1 = Math.min;
var _toAbsoluteIndex = function (index, length) {
  index = _toInteger(index);
  return index < 0 ? max(index + length, 0) : min$1(index, length);
};

// false -> Array#indexOf
// true  -> Array#includes



var _arrayIncludes = function (IS_INCLUDES) {
  return function ($this, el, fromIndex) {
    var O = _toIobject($this);
    var length = _toLength(O.length);
    var index = _toAbsoluteIndex(fromIndex, length);
    var value;
    // Array#includes uses SameValueZero equality algorithm
    // eslint-disable-next-line no-self-compare
    if (IS_INCLUDES && el != el) while (length > index) {
      value = O[index++];
      // eslint-disable-next-line no-self-compare
      if (value != value) return true;
    // Array#indexOf ignores holes, Array#includes - not
    } else for (;length > index; index++) if (IS_INCLUDES || index in O) {
      if (O[index] === el) return IS_INCLUDES || index || 0;
    } return !IS_INCLUDES && -1;
  };
};

var _shared = createCommonjsModule(function (module) {
var SHARED = '__core-js_shared__';
var store = _global[SHARED] || (_global[SHARED] = {});

(module.exports = function (key, value) {
  return store[key] || (store[key] = value !== undefined ? value : {});
})('versions', []).push({
  version: _core.version,
  mode: _library ? 'pure' : 'global',
  copyright: '© 2020 Denis Pushkarev (zloirock.ru)'
});
});

var id = 0;
var px = Math.random();
var _uid = function (key) {
  return 'Symbol('.concat(key === undefined ? '' : key, ')_', (++id + px).toString(36));
};

var shared = _shared('keys');

var _sharedKey = function (key) {
  return shared[key] || (shared[key] = _uid(key));
};

var arrayIndexOf$1 = _arrayIncludes(false);
var IE_PROTO$1 = _sharedKey('IE_PROTO');

var _objectKeysInternal = function (object, names) {
  var O = _toIobject(object);
  var i = 0;
  var result = [];
  var key;
  for (key in O) if (key != IE_PROTO$1) _has(O, key) && result.push(key);
  // Don't enum bug & hidden keys
  while (names.length > i) if (_has(O, key = names[i++])) {
    ~arrayIndexOf$1(result, key) || result.push(key);
  }
  return result;
};

// IE 8- don't enum bug keys
var _enumBugKeys = (
  'constructor,hasOwnProperty,isPrototypeOf,propertyIsEnumerable,toLocaleString,toString,valueOf'
).split(',');

// 19.1.2.14 / 15.2.3.14 Object.keys(O)



var _objectKeys = Object.keys || function keys(O) {
  return _objectKeysInternal(O, _enumBugKeys);
};

var _objectDps = _descriptors ? Object.defineProperties : function defineProperties(O, Properties) {
  _anObject(O);
  var keys = _objectKeys(Properties);
  var length = keys.length;
  var i = 0;
  var P;
  while (length > i) _objectDp.f(O, P = keys[i++], Properties[P]);
  return O;
};

var document$2 = _global.document;
var _html = document$2 && document$2.documentElement;

// 19.1.2.2 / 15.2.3.5 Object.create(O [, Properties])



var IE_PROTO = _sharedKey('IE_PROTO');
var Empty = function () { /* empty */ };
var PROTOTYPE$1 = 'prototype';

// Create object with fake `null` prototype: use iframe Object with cleared prototype
var createDict = function () {
  // Thrash, waste and sodomy: IE GC bug
  var iframe = _domCreate('iframe');
  var i = _enumBugKeys.length;
  var lt = '<';
  var gt = '>';
  var iframeDocument;
  iframe.style.display = 'none';
  _html.appendChild(iframe);
  iframe.src = 'javascript:'; // eslint-disable-line no-script-url
  // createDict = iframe.contentWindow.Object;
  // html.removeChild(iframe);
  iframeDocument = iframe.contentWindow.document;
  iframeDocument.open();
  iframeDocument.write(lt + 'script' + gt + 'document.F=Object' + lt + '/script' + gt);
  iframeDocument.close();
  createDict = iframeDocument.F;
  while (i--) delete createDict[PROTOTYPE$1][_enumBugKeys[i]];
  return createDict();
};

var _objectCreate = Object.create || function create(O, Properties) {
  var result;
  if (O !== null) {
    Empty[PROTOTYPE$1] = _anObject(O);
    result = new Empty();
    Empty[PROTOTYPE$1] = null;
    // add "__proto__" for Object.getPrototypeOf polyfill
    result[IE_PROTO] = O;
  } else result = createDict();
  return Properties === undefined ? result : _objectDps(result, Properties);
};

var _wks = createCommonjsModule(function (module) {
var store = _shared('wks');

var Symbol = _global.Symbol;
var USE_SYMBOL = typeof Symbol == 'function';

var $exports = module.exports = function (name) {
  return store[name] || (store[name] =
    USE_SYMBOL && Symbol[name] || (USE_SYMBOL ? Symbol : _uid)('Symbol.' + name));
};

$exports.store = store;
});

var def = _objectDp.f;

var TAG = _wks('toStringTag');

var _setToStringTag = function (it, tag, stat) {
  if (it && !_has(it = stat ? it : it.prototype, TAG)) def(it, TAG, { configurable: true, value: tag });
};

var IteratorPrototype = {};

// 25.1.2.1.1 %IteratorPrototype%[@@iterator]()
_hide(IteratorPrototype, _wks('iterator'), function () { return this; });

var _iterCreate = function (Constructor, NAME, next) {
  Constructor.prototype = _objectCreate(IteratorPrototype, { next: _propertyDesc(1, next) });
  _setToStringTag(Constructor, NAME + ' Iterator');
};

// 7.1.13 ToObject(argument)

var _toObject = function (it) {
  return Object(_defined(it));
};

// 19.1.2.9 / 15.2.3.2 Object.getPrototypeOf(O)


var IE_PROTO$2 = _sharedKey('IE_PROTO');
var ObjectProto = Object.prototype;

var _objectGpo = Object.getPrototypeOf || function (O) {
  O = _toObject(O);
  if (_has(O, IE_PROTO$2)) return O[IE_PROTO$2];
  if (typeof O.constructor == 'function' && O instanceof O.constructor) {
    return O.constructor.prototype;
  } return O instanceof Object ? ObjectProto : null;
};

var ITERATOR = _wks('iterator');
var BUGGY = !([].keys && 'next' in [].keys()); // Safari has buggy iterators w/o `next`
var FF_ITERATOR = '@@iterator';
var KEYS = 'keys';
var VALUES = 'values';

var returnThis = function () { return this; };

var _iterDefine = function (Base, NAME, Constructor, next, DEFAULT, IS_SET, FORCED) {
  _iterCreate(Constructor, NAME, next);
  var getMethod = function (kind) {
    if (!BUGGY && kind in proto) return proto[kind];
    switch (kind) {
      case KEYS: return function keys() { return new Constructor(this, kind); };
      case VALUES: return function values() { return new Constructor(this, kind); };
    } return function entries() { return new Constructor(this, kind); };
  };
  var TAG = NAME + ' Iterator';
  var DEF_VALUES = DEFAULT == VALUES;
  var VALUES_BUG = false;
  var proto = Base.prototype;
  var $native = proto[ITERATOR] || proto[FF_ITERATOR] || DEFAULT && proto[DEFAULT];
  var $default = $native || getMethod(DEFAULT);
  var $entries = DEFAULT ? !DEF_VALUES ? $default : getMethod('entries') : undefined;
  var $anyNative = NAME == 'Array' ? proto.entries || $native : $native;
  var methods, key, IteratorPrototype;
  // Fix native
  if ($anyNative) {
    IteratorPrototype = _objectGpo($anyNative.call(new Base()));
    if (IteratorPrototype !== Object.prototype && IteratorPrototype.next) {
      // Set @@toStringTag to native iterators
      _setToStringTag(IteratorPrototype, TAG, true);
      // fix for some old engines
      if (!_library && typeof IteratorPrototype[ITERATOR] != 'function') _hide(IteratorPrototype, ITERATOR, returnThis);
    }
  }
  // fix Array#{values, @@iterator}.name in V8 / FF
  if (DEF_VALUES && $native && $native.name !== VALUES) {
    VALUES_BUG = true;
    $default = function values() { return $native.call(this); };
  }
  // Define iterator
  if ((!_library || FORCED) && (BUGGY || VALUES_BUG || !proto[ITERATOR])) {
    _hide(proto, ITERATOR, $default);
  }
  // Plug for library
  _iterators[NAME] = $default;
  _iterators[TAG] = returnThis;
  if (DEFAULT) {
    methods = {
      values: DEF_VALUES ? $default : getMethod(VALUES),
      keys: IS_SET ? $default : getMethod(KEYS),
      entries: $entries
    };
    if (FORCED) for (key in methods) {
      if (!(key in proto)) _redefine(proto, key, methods[key]);
    } else _export(_export.P + _export.F * (BUGGY || VALUES_BUG), NAME, methods);
  }
  return methods;
};

var $at = _stringAt(true);

// 21.1.3.27 String.prototype[@@iterator]()
_iterDefine(String, 'String', function (iterated) {
  this._t = String(iterated); // target
  this._i = 0;                // next index
// 21.1.5.2.1 %StringIteratorPrototype%.next()
}, function () {
  var O = this._t;
  var index = this._i;
  var point;
  if (index >= O.length) return { value: undefined, done: true };
  point = $at(O, index);
  this._i += point.length;
  return { value: point, done: false };
});

var _iterStep = function (done, value) {
  return { value: value, done: !!done };
};

// 22.1.3.4 Array.prototype.entries()
// 22.1.3.13 Array.prototype.keys()
// 22.1.3.29 Array.prototype.values()
// 22.1.3.30 Array.prototype[@@iterator]()
var es6_array_iterator = _iterDefine(Array, 'Array', function (iterated, kind) {
  this._t = _toIobject(iterated); // target
  this._i = 0;                   // next index
  this._k = kind;                // kind
// 22.1.5.2.1 %ArrayIteratorPrototype%.next()
}, function () {
  var O = this._t;
  var kind = this._k;
  var index = this._i++;
  if (!O || index >= O.length) {
    this._t = undefined;
    return _iterStep(1);
  }
  if (kind == 'keys') return _iterStep(0, index);
  if (kind == 'values') return _iterStep(0, O[index]);
  return _iterStep(0, [index, O[index]]);
}, 'values');

// argumentsList[@@iterator] is %ArrayProto_values% (9.4.4.6, 9.4.4.7)
_iterators.Arguments = _iterators.Array;

var TO_STRING_TAG = _wks('toStringTag');

var DOMIterables = ('CSSRuleList,CSSStyleDeclaration,CSSValueList,ClientRectList,DOMRectList,DOMStringList,' +
  'DOMTokenList,DataTransferItemList,FileList,HTMLAllCollection,HTMLCollection,HTMLFormElement,HTMLSelectElement,' +
  'MediaList,MimeTypeArray,NamedNodeMap,NodeList,PaintRequestList,Plugin,PluginArray,SVGLengthList,SVGNumberList,' +
  'SVGPathSegList,SVGPointList,SVGStringList,SVGTransformList,SourceBufferList,StyleSheetList,TextTrackCueList,' +
  'TextTrackList,TouchList').split(',');

for (var i = 0; i < DOMIterables.length; i++) {
  var NAME = DOMIterables[i];
  var Collection = _global[NAME];
  var proto = Collection && Collection.prototype;
  if (proto && !proto[TO_STRING_TAG]) _hide(proto, TO_STRING_TAG, NAME);
  _iterators[NAME] = _iterators.Array;
}

var f$1 = _wks;

var _wksExt = {
	f: f$1
};

var iterator$2 = _wksExt.f('iterator');

var iterator = createCommonjsModule(function (module) {
module.exports = { "default": iterator$2, __esModule: true };
});

unwrapExports(iterator);

var _meta = createCommonjsModule(function (module) {
var META = _uid('meta');


var setDesc = _objectDp.f;
var id = 0;
var isExtensible = Object.isExtensible || function () {
  return true;
};
var FREEZE = !_fails(function () {
  return isExtensible(Object.preventExtensions({}));
});
var setMeta = function (it) {
  setDesc(it, META, { value: {
    i: 'O' + ++id, // object ID
    w: {}          // weak collections IDs
  } });
};
var fastKey = function (it, create) {
  // return primitive with prefix
  if (!_isObject(it)) return typeof it == 'symbol' ? it : (typeof it == 'string' ? 'S' : 'P') + it;
  if (!_has(it, META)) {
    // can't set metadata to uncaught frozen object
    if (!isExtensible(it)) return 'F';
    // not necessary to add metadata
    if (!create) return 'E';
    // add missing metadata
    setMeta(it);
  // return object ID
  } return it[META].i;
};
var getWeak = function (it, create) {
  if (!_has(it, META)) {
    // can't set metadata to uncaught frozen object
    if (!isExtensible(it)) return true;
    // not necessary to add metadata
    if (!create) return false;
    // add missing metadata
    setMeta(it);
  // return hash weak collections IDs
  } return it[META].w;
};
// add metadata on freeze-family methods calling
var onFreeze = function (it) {
  if (FREEZE && meta.NEED && isExtensible(it) && !_has(it, META)) setMeta(it);
  return it;
};
var meta = module.exports = {
  KEY: META,
  NEED: false,
  fastKey: fastKey,
  getWeak: getWeak,
  onFreeze: onFreeze
};
});

var _meta_1 = _meta.KEY;
var _meta_2 = _meta.NEED;
var _meta_3 = _meta.fastKey;
var _meta_4 = _meta.getWeak;
var _meta_5 = _meta.onFreeze;

var defineProperty = _objectDp.f;
var _wksDefine = function (name) {
  var $Symbol = _core.Symbol || (_core.Symbol = _library ? {} : _global.Symbol || {});
  if (name.charAt(0) != '_' && !(name in $Symbol)) defineProperty($Symbol, name, { value: _wksExt.f(name) });
};

var f$2 = Object.getOwnPropertySymbols;

var _objectGops = {
	f: f$2
};

var f$3 = {}.propertyIsEnumerable;

var _objectPie = {
	f: f$3
};

// all enumerable object keys, includes symbols



var _enumKeys = function (it) {
  var result = _objectKeys(it);
  var getSymbols = _objectGops.f;
  if (getSymbols) {
    var symbols = getSymbols(it);
    var isEnum = _objectPie.f;
    var i = 0;
    var key;
    while (symbols.length > i) if (isEnum.call(it, key = symbols[i++])) result.push(key);
  } return result;
};

// 7.2.2 IsArray(argument)

var _isArray = Array.isArray || function isArray(arg) {
  return _cof(arg) == 'Array';
};

// 19.1.2.7 / 15.2.3.4 Object.getOwnPropertyNames(O)

var hiddenKeys = _enumBugKeys.concat('length', 'prototype');

var f$5 = Object.getOwnPropertyNames || function getOwnPropertyNames(O) {
  return _objectKeysInternal(O, hiddenKeys);
};

var _objectGopn = {
	f: f$5
};

// fallback for IE11 buggy Object.getOwnPropertyNames with iframe and window

var gOPN$1 = _objectGopn.f;
var toString$2 = {}.toString;

var windowNames = typeof window == 'object' && window && Object.getOwnPropertyNames
  ? Object.getOwnPropertyNames(window) : [];

var getWindowNames = function (it) {
  try {
    return gOPN$1(it);
  } catch (e) {
    return windowNames.slice();
  }
};

var f$4 = function getOwnPropertyNames(it) {
  return windowNames && toString$2.call(it) == '[object Window]' ? getWindowNames(it) : gOPN$1(_toIobject(it));
};

var _objectGopnExt = {
	f: f$4
};

var gOPD$1 = Object.getOwnPropertyDescriptor;

var f$6 = _descriptors ? gOPD$1 : function getOwnPropertyDescriptor(O, P) {
  O = _toIobject(O);
  P = _toPrimitive(P, true);
  if (_ie8DomDefine) try {
    return gOPD$1(O, P);
  } catch (e) { /* empty */ }
  if (_has(O, P)) return _propertyDesc(!_objectPie.f.call(O, P), O[P]);
};

var _objectGopd = {
	f: f$6
};

// ECMAScript 6 symbols shim





var META = _meta.KEY;





















var gOPD = _objectGopd.f;
var dP$1 = _objectDp.f;
var gOPN = _objectGopnExt.f;
var $Symbol = _global.Symbol;
var $JSON = _global.JSON;
var _stringify = $JSON && $JSON.stringify;
var PROTOTYPE$2 = 'prototype';
var HIDDEN = _wks('_hidden');
var TO_PRIMITIVE = _wks('toPrimitive');
var isEnum = {}.propertyIsEnumerable;
var SymbolRegistry = _shared('symbol-registry');
var AllSymbols = _shared('symbols');
var OPSymbols = _shared('op-symbols');
var ObjectProto$1 = Object[PROTOTYPE$2];
var USE_NATIVE = typeof $Symbol == 'function' && !!_objectGops.f;
var QObject = _global.QObject;
// Don't use setters in Qt Script, https://github.com/zloirock/core-js/issues/173
var setter = !QObject || !QObject[PROTOTYPE$2] || !QObject[PROTOTYPE$2].findChild;

// fallback for old Android, https://code.google.com/p/v8/issues/detail?id=687
var setSymbolDesc = _descriptors && _fails(function () {
  return _objectCreate(dP$1({}, 'a', {
    get: function () { return dP$1(this, 'a', { value: 7 }).a; }
  })).a != 7;
}) ? function (it, key, D) {
  var protoDesc = gOPD(ObjectProto$1, key);
  if (protoDesc) delete ObjectProto$1[key];
  dP$1(it, key, D);
  if (protoDesc && it !== ObjectProto$1) dP$1(ObjectProto$1, key, protoDesc);
} : dP$1;

var wrap = function (tag) {
  var sym = AllSymbols[tag] = _objectCreate($Symbol[PROTOTYPE$2]);
  sym._k = tag;
  return sym;
};

var isSymbol = USE_NATIVE && typeof $Symbol.iterator == 'symbol' ? function (it) {
  return typeof it == 'symbol';
} : function (it) {
  return it instanceof $Symbol;
};

var $defineProperty = function defineProperty(it, key, D) {
  if (it === ObjectProto$1) $defineProperty(OPSymbols, key, D);
  _anObject(it);
  key = _toPrimitive(key, true);
  _anObject(D);
  if (_has(AllSymbols, key)) {
    if (!D.enumerable) {
      if (!_has(it, HIDDEN)) dP$1(it, HIDDEN, _propertyDesc(1, {}));
      it[HIDDEN][key] = true;
    } else {
      if (_has(it, HIDDEN) && it[HIDDEN][key]) it[HIDDEN][key] = false;
      D = _objectCreate(D, { enumerable: _propertyDesc(0, false) });
    } return setSymbolDesc(it, key, D);
  } return dP$1(it, key, D);
};
var $defineProperties = function defineProperties(it, P) {
  _anObject(it);
  var keys = _enumKeys(P = _toIobject(P));
  var i = 0;
  var l = keys.length;
  var key;
  while (l > i) $defineProperty(it, key = keys[i++], P[key]);
  return it;
};
var $create = function create(it, P) {
  return P === undefined ? _objectCreate(it) : $defineProperties(_objectCreate(it), P);
};
var $propertyIsEnumerable = function propertyIsEnumerable(key) {
  var E = isEnum.call(this, key = _toPrimitive(key, true));
  if (this === ObjectProto$1 && _has(AllSymbols, key) && !_has(OPSymbols, key)) return false;
  return E || !_has(this, key) || !_has(AllSymbols, key) || _has(this, HIDDEN) && this[HIDDEN][key] ? E : true;
};
var $getOwnPropertyDescriptor = function getOwnPropertyDescriptor(it, key) {
  it = _toIobject(it);
  key = _toPrimitive(key, true);
  if (it === ObjectProto$1 && _has(AllSymbols, key) && !_has(OPSymbols, key)) return;
  var D = gOPD(it, key);
  if (D && _has(AllSymbols, key) && !(_has(it, HIDDEN) && it[HIDDEN][key])) D.enumerable = true;
  return D;
};
var $getOwnPropertyNames = function getOwnPropertyNames(it) {
  var names = gOPN(_toIobject(it));
  var result = [];
  var i = 0;
  var key;
  while (names.length > i) {
    if (!_has(AllSymbols, key = names[i++]) && key != HIDDEN && key != META) result.push(key);
  } return result;
};
var $getOwnPropertySymbols = function getOwnPropertySymbols(it) {
  var IS_OP = it === ObjectProto$1;
  var names = gOPN(IS_OP ? OPSymbols : _toIobject(it));
  var result = [];
  var i = 0;
  var key;
  while (names.length > i) {
    if (_has(AllSymbols, key = names[i++]) && (IS_OP ? _has(ObjectProto$1, key) : true)) result.push(AllSymbols[key]);
  } return result;
};

// 19.4.1.1 Symbol([description])
if (!USE_NATIVE) {
  $Symbol = function Symbol() {
    if (this instanceof $Symbol) throw TypeError('Symbol is not a constructor!');
    var tag = _uid(arguments.length > 0 ? arguments[0] : undefined);
    var $set = function (value) {
      if (this === ObjectProto$1) $set.call(OPSymbols, value);
      if (_has(this, HIDDEN) && _has(this[HIDDEN], tag)) this[HIDDEN][tag] = false;
      setSymbolDesc(this, tag, _propertyDesc(1, value));
    };
    if (_descriptors && setter) setSymbolDesc(ObjectProto$1, tag, { configurable: true, set: $set });
    return wrap(tag);
  };
  _redefine($Symbol[PROTOTYPE$2], 'toString', function toString() {
    return this._k;
  });

  _objectGopd.f = $getOwnPropertyDescriptor;
  _objectDp.f = $defineProperty;
  _objectGopn.f = _objectGopnExt.f = $getOwnPropertyNames;
  _objectPie.f = $propertyIsEnumerable;
  _objectGops.f = $getOwnPropertySymbols;

  if (_descriptors && !_library) {
    _redefine(ObjectProto$1, 'propertyIsEnumerable', $propertyIsEnumerable, true);
  }

  _wksExt.f = function (name) {
    return wrap(_wks(name));
  };
}

_export(_export.G + _export.W + _export.F * !USE_NATIVE, { Symbol: $Symbol });

for (var es6Symbols = (
  // 19.4.2.2, 19.4.2.3, 19.4.2.4, 19.4.2.6, 19.4.2.8, 19.4.2.9, 19.4.2.10, 19.4.2.11, 19.4.2.12, 19.4.2.13, 19.4.2.14
  'hasInstance,isConcatSpreadable,iterator,match,replace,search,species,split,toPrimitive,toStringTag,unscopables'
).split(','), j = 0; es6Symbols.length > j;)_wks(es6Symbols[j++]);

for (var wellKnownSymbols = _objectKeys(_wks.store), k = 0; wellKnownSymbols.length > k;) _wksDefine(wellKnownSymbols[k++]);

_export(_export.S + _export.F * !USE_NATIVE, 'Symbol', {
  // 19.4.2.1 Symbol.for(key)
  'for': function (key) {
    return _has(SymbolRegistry, key += '')
      ? SymbolRegistry[key]
      : SymbolRegistry[key] = $Symbol(key);
  },
  // 19.4.2.5 Symbol.keyFor(sym)
  keyFor: function keyFor(sym) {
    if (!isSymbol(sym)) throw TypeError(sym + ' is not a symbol!');
    for (var key in SymbolRegistry) if (SymbolRegistry[key] === sym) return key;
  },
  useSetter: function () { setter = true; },
  useSimple: function () { setter = false; }
});

_export(_export.S + _export.F * !USE_NATIVE, 'Object', {
  // 19.1.2.2 Object.create(O [, Properties])
  create: $create,
  // 19.1.2.4 Object.defineProperty(O, P, Attributes)
  defineProperty: $defineProperty,
  // 19.1.2.3 Object.defineProperties(O, Properties)
  defineProperties: $defineProperties,
  // 19.1.2.6 Object.getOwnPropertyDescriptor(O, P)
  getOwnPropertyDescriptor: $getOwnPropertyDescriptor,
  // 19.1.2.7 Object.getOwnPropertyNames(O)
  getOwnPropertyNames: $getOwnPropertyNames,
  // 19.1.2.8 Object.getOwnPropertySymbols(O)
  getOwnPropertySymbols: $getOwnPropertySymbols
});

// Chrome 38 and 39 `Object.getOwnPropertySymbols` fails on primitives
// https://bugs.chromium.org/p/v8/issues/detail?id=3443
var FAILS_ON_PRIMITIVES = _fails(function () { _objectGops.f(1); });

_export(_export.S + _export.F * FAILS_ON_PRIMITIVES, 'Object', {
  getOwnPropertySymbols: function getOwnPropertySymbols(it) {
    return _objectGops.f(_toObject(it));
  }
});

// 24.3.2 JSON.stringify(value [, replacer [, space]])
$JSON && _export(_export.S + _export.F * (!USE_NATIVE || _fails(function () {
  var S = $Symbol();
  // MS Edge converts symbol values to JSON as {}
  // WebKit converts symbol values to JSON as null
  // V8 throws on boxed symbols
  return _stringify([S]) != '[null]' || _stringify({ a: S }) != '{}' || _stringify(Object(S)) != '{}';
})), 'JSON', {
  stringify: function stringify(it) {
    var args = [it];
    var i = 1;
    var replacer, $replacer;
    while (arguments.length > i) args.push(arguments[i++]);
    $replacer = replacer = args[1];
    if (!_isObject(replacer) && it === undefined || isSymbol(it)) return; // IE8 returns string on undefined
    if (!_isArray(replacer)) replacer = function (key, value) {
      if (typeof $replacer == 'function') value = $replacer.call(this, key, value);
      if (!isSymbol(value)) return value;
    };
    args[1] = replacer;
    return _stringify.apply($JSON, args);
  }
});

// 19.4.3.4 Symbol.prototype[@@toPrimitive](hint)
$Symbol[PROTOTYPE$2][TO_PRIMITIVE] || _hide($Symbol[PROTOTYPE$2], TO_PRIMITIVE, $Symbol[PROTOTYPE$2].valueOf);
// 19.4.3.5 Symbol.prototype[@@toStringTag]
_setToStringTag($Symbol, 'Symbol');
// 20.2.1.9 Math[@@toStringTag]
_setToStringTag(Math, 'Math', true);
// 24.3.3 JSON[@@toStringTag]
_setToStringTag(_global.JSON, 'JSON', true);

_wksDefine('asyncIterator');

_wksDefine('observable');

var symbol$2 = _core.Symbol;

var symbol = createCommonjsModule(function (module) {
module.exports = { "default": symbol$2, __esModule: true };
});

unwrapExports(symbol);

var _typeof_1 = createCommonjsModule(function (module, exports) {
exports.__esModule = true;



var _iterator2 = _interopRequireDefault(iterator);



var _symbol2 = _interopRequireDefault(symbol);

var _typeof = typeof _symbol2.default === "function" && typeof _iterator2.default === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof _symbol2.default === "function" && obj.constructor === _symbol2.default && obj !== _symbol2.default.prototype ? "symbol" : typeof obj; };

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = typeof _symbol2.default === "function" && _typeof(_iterator2.default) === "symbol" ? function (obj) {
  return typeof obj === "undefined" ? "undefined" : _typeof(obj);
} : function (obj) {
  return obj && typeof _symbol2.default === "function" && obj.constructor === _symbol2.default && obj !== _symbol2.default.prototype ? "symbol" : typeof obj === "undefined" ? "undefined" : _typeof(obj);
};
});

var _typeof = unwrapExports(_typeof_1);

// 19.1.2.1 Object.assign(target, source, ...)






var $assign = Object.assign;

// should work with symbols and should have deterministic property order (V8 bug)
var _objectAssign = !$assign || _fails(function () {
  var A = {};
  var B = {};
  // eslint-disable-next-line no-undef
  var S = Symbol();
  var K = 'abcdefghijklmnopqrst';
  A[S] = 7;
  K.split('').forEach(function (k) { B[k] = k; });
  return $assign({}, A)[S] != 7 || Object.keys($assign({}, B)).join('') != K;
}) ? function assign(target, source) { // eslint-disable-line no-unused-vars
  var T = _toObject(target);
  var aLen = arguments.length;
  var index = 1;
  var getSymbols = _objectGops.f;
  var isEnum = _objectPie.f;
  while (aLen > index) {
    var S = _iobject(arguments[index++]);
    var keys = getSymbols ? _objectKeys(S).concat(getSymbols(S)) : _objectKeys(S);
    var length = keys.length;
    var j = 0;
    var key;
    while (length > j) {
      key = keys[j++];
      if (!_descriptors || isEnum.call(S, key)) T[key] = S[key];
    }
  } return T;
} : $assign;

// 19.1.3.1 Object.assign(target, source)


_export(_export.S + _export.F, 'Object', { assign: _objectAssign });

var assign$2 = _core.Object.assign;

var assign = createCommonjsModule(function (module) {
module.exports = { "default": assign$2, __esModule: true };
});

unwrapExports(assign);

var _extends = createCommonjsModule(function (module, exports) {
exports.__esModule = true;



var _assign2 = _interopRequireDefault(assign);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = _assign2.default || function (target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i];

    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        target[key] = source[key];
      }
    }
  }

  return target;
};
});

var _extends$1 = unwrapExports(_extends);

// call something on iterator step with safe closing on error

var _iterCall = function (iterator, fn, value, entries) {
  try {
    return entries ? fn(_anObject(value)[0], value[1]) : fn(value);
  // 7.4.6 IteratorClose(iterator, completion)
  } catch (e) {
    var ret = iterator['return'];
    if (ret !== undefined) _anObject(ret.call(iterator));
    throw e;
  }
};

// check on default Array iterator

var ITERATOR$1 = _wks('iterator');
var ArrayProto = Array.prototype;

var _isArrayIter = function (it) {
  return it !== undefined && (_iterators.Array === it || ArrayProto[ITERATOR$1] === it);
};

var _createProperty = function (object, index, value) {
  if (index in object) _objectDp.f(object, index, _propertyDesc(0, value));
  else object[index] = value;
};

// getting tag from 19.1.3.6 Object.prototype.toString()

var TAG$1 = _wks('toStringTag');
// ES3 wrong here
var ARG = _cof(function () { return arguments; }()) == 'Arguments';

// fallback for IE11 Script Access Denied error
var tryGet = function (it, key) {
  try {
    return it[key];
  } catch (e) { /* empty */ }
};

var _classof = function (it) {
  var O, T, B;
  return it === undefined ? 'Undefined' : it === null ? 'Null'
    // @@toStringTag case
    : typeof (T = tryGet(O = Object(it), TAG$1)) == 'string' ? T
    // builtinTag case
    : ARG ? _cof(O)
    // ES3 arguments fallback
    : (B = _cof(O)) == 'Object' && typeof O.callee == 'function' ? 'Arguments' : B;
};

var ITERATOR$2 = _wks('iterator');

var core_getIteratorMethod = _core.getIteratorMethod = function (it) {
  if (it != undefined) return it[ITERATOR$2]
    || it['@@iterator']
    || _iterators[_classof(it)];
};

var ITERATOR$3 = _wks('iterator');
var SAFE_CLOSING = false;

try {
  var riter = [7][ITERATOR$3]();
  riter['return'] = function () { SAFE_CLOSING = true; };
  // eslint-disable-next-line no-throw-literal
  
} catch (e) { /* empty */ }

var _iterDetect = function (exec, skipClosing) {
  if (!skipClosing && !SAFE_CLOSING) return false;
  var safe = false;
  try {
    var arr = [7];
    var iter = arr[ITERATOR$3]();
    iter.next = function () { return { done: safe = true }; };
    arr[ITERATOR$3] = function () { return iter; };
    exec(arr);
  } catch (e) { /* empty */ }
  return safe;
};

_export(_export.S + _export.F * !_iterDetect(function (iter) {  }), 'Array', {
  // 22.1.2.1 Array.from(arrayLike, mapfn = undefined, thisArg = undefined)
  from: function from(arrayLike /* , mapfn = undefined, thisArg = undefined */) {
    var O = _toObject(arrayLike);
    var C = typeof this == 'function' ? this : Array;
    var aLen = arguments.length;
    var mapfn = aLen > 1 ? arguments[1] : undefined;
    var mapping = mapfn !== undefined;
    var index = 0;
    var iterFn = core_getIteratorMethod(O);
    var length, result, step, iterator;
    if (mapping) mapfn = _ctx(mapfn, aLen > 2 ? arguments[2] : undefined, 2);
    // if object isn't iterable or it's array with default iterator - use simple case
    if (iterFn != undefined && !(C == Array && _isArrayIter(iterFn))) {
      for (iterator = iterFn.call(O), result = new C(); !(step = iterator.next()).done; index++) {
        _createProperty(result, index, mapping ? _iterCall(iterator, mapfn, [step.value, index], true) : step.value);
      }
    } else {
      length = _toLength(O.length);
      for (result = new C(length); length > index; index++) {
        _createProperty(result, index, mapping ? mapfn(O[index], index) : O[index]);
      }
    }
    result.length = index;
    return result;
  }
});

var from$3 = _core.Array.from;

var from$1 = createCommonjsModule(function (module) {
module.exports = { "default": from$3, __esModule: true };
});

unwrapExports(from$1);

var toConsumableArray = createCommonjsModule(function (module, exports) {
exports.__esModule = true;



var _from2 = _interopRequireDefault(from$1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = function (arr) {
  if (Array.isArray(arr)) {
    for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) {
      arr2[i] = arr[i];
    }

    return arr2;
  } else {
    return (0, _from2.default)(arr);
  }
};
});

var _toConsumableArray = unwrapExports(toConsumableArray);

var ITERATOR$4 = _wks('iterator');

var core_isIterable = _core.isIterable = function (it) {
  var O = Object(it);
  return O[ITERATOR$4] !== undefined
    || '@@iterator' in O
    // eslint-disable-next-line no-prototype-builtins
    || _iterators.hasOwnProperty(_classof(O));
};

var isIterable$2 = core_isIterable;

var isIterable = createCommonjsModule(function (module) {
module.exports = { "default": isIterable$2, __esModule: true };
});

unwrapExports(isIterable);

var core_getIterator = _core.getIterator = function (it) {
  var iterFn = core_getIteratorMethod(it);
  if (typeof iterFn != 'function') throw TypeError(it + ' is not iterable!');
  return _anObject(iterFn.call(it));
};

var getIterator$2 = core_getIterator;

var getIterator = createCommonjsModule(function (module) {
module.exports = { "default": getIterator$2, __esModule: true };
});

unwrapExports(getIterator);

var slicedToArray = createCommonjsModule(function (module, exports) {
exports.__esModule = true;



var _isIterable3 = _interopRequireDefault(isIterable);



var _getIterator3 = _interopRequireDefault(getIterator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = function () {
  function sliceIterator(arr, i) {
    var _arr = [];
    var _n = true;
    var _d = false;
    var _e = undefined;

    try {
      for (var _i = (0, _getIterator3.default)(arr), _s; !(_n = (_s = _i.next()).done); _n = true) {
        _arr.push(_s.value);

        if (i && _arr.length === i) break;
      }
    } catch (err) {
      _d = true;
      _e = err;
    } finally {
      try {
        if (!_n && _i["return"]) _i["return"]();
      } finally {
        if (_d) throw _e;
      }
    }

    return _arr;
  }

  return function (arr, i) {
    if (Array.isArray(arr)) {
      return arr;
    } else if ((0, _isIterable3.default)(Object(arr))) {
      return sliceIterator(arr, i);
    } else {
      throw new TypeError("Invalid attempt to destructure non-iterable instance");
    }
  };
}();
});

var _slicedToArray = unwrapExports(slicedToArray);

var classCallCheck = createCommonjsModule(function (module, exports) {
exports.__esModule = true;

exports.default = function (instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
};
});

var _classCallCheck = unwrapExports(classCallCheck);

// 19.1.2.4 / 15.2.3.6 Object.defineProperty(O, P, Attributes)
_export(_export.S + _export.F * !_descriptors, 'Object', { defineProperty: _objectDp.f });

var $Object = _core.Object;
var defineProperty$3 = function defineProperty(it, key, desc) {
  return $Object.defineProperty(it, key, desc);
};

var defineProperty$1 = createCommonjsModule(function (module) {
module.exports = { "default": defineProperty$3, __esModule: true };
});

unwrapExports(defineProperty$1);

var createClass = createCommonjsModule(function (module, exports) {
exports.__esModule = true;



var _defineProperty2 = _interopRequireDefault(defineProperty$1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = function () {
  function defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      (0, _defineProperty2.default)(target, descriptor.key, descriptor);
    }
  }

  return function (Constructor, protoProps, staticProps) {
    if (protoProps) defineProperties(Constructor.prototype, protoProps);
    if (staticProps) defineProperties(Constructor, staticProps);
    return Constructor;
  };
}();
});

var _createClass = unwrapExports(createClass);

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
var title = 'browser';
var platform = 'browser';
var browser = true;
var env = {};
var argv = [];
var version = ''; // empty string to avoid regexp issues
var versions = {};
var release = {};
var config = {};

function noop() {}

var on = noop;
var addListener = noop;
var once = noop;
var off = noop;
var removeListener = noop;
var removeAllListeners = noop;
var emit = noop;

function binding(name) {
    throw new Error('process.binding is not supported');
}

function cwd () { return '/' }
function chdir (dir) {
    throw new Error('process.chdir is not supported');
}
function umask() { return 0; }

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
function hrtime(previousTimestamp){
  var clocktime = performanceNow.call(performance)*1e-3;
  var seconds = Math.floor(clocktime);
  var nanoseconds = Math.floor((clocktime%1)*1e9);
  if (previousTimestamp) {
    seconds = seconds - previousTimestamp[0];
    nanoseconds = nanoseconds - previousTimestamp[1];
    if (nanoseconds<0) {
      seconds--;
      nanoseconds += 1e9;
    }
  }
  return [seconds,nanoseconds]
}

var startTime = new Date();
function uptime() {
  var currentTime = new Date();
  var dif = currentTime - startTime;
  return dif / 1000;
}

var process = {
  nextTick: nextTick,
  title: title,
  browser: browser,
  env: env,
  argv: argv,
  version: version,
  versions: versions,
  on: on,
  addListener: addListener,
  once: once,
  off: off,
  removeListener: removeListener,
  removeAllListeners: removeAllListeners,
  emit: emit,
  binding: binding,
  cwd: cwd,
  chdir: chdir,
  umask: umask,
  hrtime: hrtime,
  platform: platform,
  release: release,
  config: config,
  uptime: uptime
};

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

var index_browser_umd = createCommonjsModule(function (module, exports) {
(function (global, factory) {
	module.exports = factory();
}(commonjsGlobal, (function () { function permaProxy(container, name) {
  return new Proxy({}, {
    getPrototypeOf: function getPrototypeOf(_) {
      return Reflect.getPrototypeOf(container[name]);
    },
    setPrototypeOf: function setPrototypeOf(_, prototype) {
      return Reflect.setPrototypeOf(container[name], prototype);
    },
    isExtensible: function isExtensible(_) {
      return Reflect.isExtensible(container[name]);
    },
    preventExtensions: function preventExtensions(_) {
      return Reflect.preventExtensions(container[name]);
    },
    getOwnPropertyDescriptor: function getOwnPropertyDescriptor(_, property) {
      return Reflect.getOwnPropertyDescriptor(container[name], property);
    },
    defineProperty: function defineProperty(_, property, descriptor) {
      return Reflect.defineProperty(container[name], property, descriptor);
    },
    get: function get(_, property) {
      var value = Reflect.get(container[name], property);
      if (typeof value === 'function') {
        value = value.bind(container[name]);
      }
      return value;
    },
    set: function set(_, property, value) {
      return Reflect.set(container[name], property, value);
    },
    has: function has(_, property) {
      return Reflect.has(container[name], property);
    },
    deleteProperty: function deleteProperty(_, property) {
      return Reflect.delete(container[name], property);
    },
    ownKeys: function ownKeys(_) {
      return Reflect.ownKeys(container[name]);
    },
    apply: function apply(_, that, args) {
      return Reflect.apply(container[name], that, args);
    },
    construct: function construct(_, args, newTarget) {
      return Reflect.construct(container[name], args, newTarget);
    }
  });
}

return permaProxy;

})));
});

// most Object methods by ES6 should accept primitives



var _objectSap = function (KEY, exec) {
  var fn = (_core.Object || {})[KEY] || Object[KEY];
  var exp = {};
  exp[KEY] = exec(fn);
  _export(_export.S + _export.F * _fails(function () { fn(1); }), 'Object', exp);
};

// 19.1.2.5 Object.freeze(O)

var meta = _meta.onFreeze;

_objectSap('freeze', function ($freeze) {
  return function freeze(it) {
    return $freeze && _isObject(it) ? $freeze(meta(it)) : it;
  };
});

var freeze$1 = _core.Object.freeze;

var freeze = createCommonjsModule(function (module) {
module.exports = { "default": freeze$1, __esModule: true };
});

var _Object$freeze = unwrapExports(freeze);

var constants = _Object$freeze({
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
var Stat = function () {

  /**
   * Creates Stat.
   */
  function Stat(props) {
    _classCallCheck(this, Stat);

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


  _createClass(Stat, [{
    key: 'isFile',
    value: function isFile() {
      return (this.mode & constants.S_IFMT) == constants.S_IFREG;
    }

    /**
     * Checks if directory.
     */

  }, {
    key: 'isDirectory',
    value: function isDirectory() {
      return (this.mode & constants.S_IFMT) == constants.S_IFDIR;
    }

    /**
     * Checks if block device.
     */

  }, {
    key: 'isBlockDevice',
    value: function isBlockDevice() {
      return (this.mode & constants.S_IFMT) == constants.S_IFBLK;
    }

    /**
     * Checks if character device.
     */

  }, {
    key: 'isCharacterDevice',
    value: function isCharacterDevice() {
      return (this.mode & constants.S_IFMT) == constants.S_IFCHR;
    }

    /**
     * Checks if symbolic link.
     */

  }, {
    key: 'isSymbolicLink',
    value: function isSymbolicLink() {
      return (this.mode & constants.S_IFMT) == constants.S_IFLNK;
    }

    /**
     * Checks if FIFO.
     */

  }, {
    key: 'isFIFO',
    value: function isFIFO() {
      return (this.mode & constants.S_IFMT) == constants.S_IFIFO;
    }

    /**
     * Checks if socket.
     */

  }, {
    key: 'isSocket',
    value: function isSocket() {
      return (this.mode & constants.S_IFMT) == constants.S_IFSOCK;
    }
  }]);

  return Stat;
}();

var CurrentDirectory = function () {
  function CurrentDirectory(iNodeMgr, iNode) {
    var curPath = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : [];

    _classCallCheck(this, CurrentDirectory);

    this._iNodeMgr = iNodeMgr;
    this._iNode = iNode;
    this._curPath = curPath;
    iNodeMgr.refINode(iNode);
  }

  _createClass(CurrentDirectory, [{
    key: 'changeDir',
    value: function changeDir(iNode, curPath) {
      this._iNodeMgr.refINode(iNode);
      this._iNodeMgr.unrefINode(this._iNode);
      this._iNode = iNode;
      this._curPath = curPath;
      return;
    }
  }, {
    key: 'getINode',
    value: function getINode() {
      return this._iNode;
    }
  }, {
    key: 'getPathStack',
    value: function getPathStack() {
      return [].concat(_toConsumableArray(this._curPath));
    }
  }, {
    key: 'getPath',
    value: function getPath() {
      return '/' + this._curPath.join('/');
    }
  }]);

  return CurrentDirectory;
}();

/**
 * Default root uid.
 */

/** @module Permissions */

var DEFAULT_ROOT_UID = 0;

/**
 * Default root gid.
 */
var DEFAULT_ROOT_GID = 0;

/**
 * Default root directory permissions of `rwxr-xr-x`.
 */
var DEFAULT_ROOT_PERM = constants.S_IRWXU | constants.S_IRGRP | constants.S_IXGRP | constants.S_IROTH | constants.S_IXOTH;

/**
 * Default file permissions of `rw-rw-rw-`.
 */
var DEFAULT_FILE_PERM = constants.S_IRUSR | constants.S_IWUSR | constants.S_IRGRP | constants.S_IWGRP | constants.S_IROTH | constants.S_IWOTH;

/**
 * Default directory permissions of `rwxrwxrwx`.
 */
var DEFAULT_DIRECTORY_PERM = constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO;

/**
 * Default symlink permissions of `rwxrwxrwx`.
 */
var DEFAULT_SYMLINK_PERM = constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO;

/**
 * Applies umask to default set of permissions.
 */
function applyUmask(perms, umask) {
  return perms & ~umask;
}

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

var _redefineAll = function (target, src, safe) {
  for (var key in src) {
    if (safe && target[key]) target[key] = src[key];
    else _hide(target, key, src[key]);
  } return target;
};

var _anInstance = function (it, Constructor, name, forbiddenField) {
  if (!(it instanceof Constructor) || (forbiddenField !== undefined && forbiddenField in it)) {
    throw TypeError(name + ': incorrect invocation!');
  } return it;
};

var _forOf = createCommonjsModule(function (module) {
var BREAK = {};
var RETURN = {};
var exports = module.exports = function (iterable, entries, fn, that, ITERATOR) {
  var iterFn = ITERATOR ? function () { return iterable; } : core_getIteratorMethod(iterable);
  var f = _ctx(fn, that, entries ? 2 : 1);
  var index = 0;
  var length, step, iterator, result;
  if (typeof iterFn != 'function') throw TypeError(iterable + ' is not iterable!');
  // fast case for arrays with default iterator
  if (_isArrayIter(iterFn)) for (length = _toLength(iterable.length); length > index; index++) {
    result = entries ? f(_anObject(step = iterable[index])[0], step[1]) : f(iterable[index]);
    if (result === BREAK || result === RETURN) return result;
  } else for (iterator = iterFn.call(iterable); !(step = iterator.next()).done;) {
    result = _iterCall(iterator, f, step.value, entries);
    if (result === BREAK || result === RETURN) return result;
  }
};
exports.BREAK = BREAK;
exports.RETURN = RETURN;
});

var SPECIES = _wks('species');

var _setSpecies = function (KEY) {
  var C = typeof _core[KEY] == 'function' ? _core[KEY] : _global[KEY];
  if (_descriptors && C && !C[SPECIES]) _objectDp.f(C, SPECIES, {
    configurable: true,
    get: function () { return this; }
  });
};

var _validateCollection = function (it, TYPE) {
  if (!_isObject(it) || it._t !== TYPE) throw TypeError('Incompatible receiver, ' + TYPE + ' required!');
  return it;
};

var dP$2 = _objectDp.f;









var fastKey = _meta.fastKey;

var SIZE = _descriptors ? '_s' : 'size';

var getEntry = function (that, key) {
  // fast case
  var index = fastKey(key);
  var entry;
  if (index !== 'F') return that._i[index];
  // frozen object case
  for (entry = that._f; entry; entry = entry.n) {
    if (entry.k == key) return entry;
  }
};

var _collectionStrong = {
  getConstructor: function (wrapper, NAME, IS_MAP, ADDER) {
    var C = wrapper(function (that, iterable) {
      _anInstance(that, C, NAME, '_i');
      that._t = NAME;         // collection type
      that._i = _objectCreate(null); // index
      that._f = undefined;    // first entry
      that._l = undefined;    // last entry
      that[SIZE] = 0;         // size
      if (iterable != undefined) _forOf(iterable, IS_MAP, that[ADDER], that);
    });
    _redefineAll(C.prototype, {
      // 23.1.3.1 Map.prototype.clear()
      // 23.2.3.2 Set.prototype.clear()
      clear: function clear() {
        for (var that = _validateCollection(this, NAME), data = that._i, entry = that._f; entry; entry = entry.n) {
          entry.r = true;
          if (entry.p) entry.p = entry.p.n = undefined;
          delete data[entry.i];
        }
        that._f = that._l = undefined;
        that[SIZE] = 0;
      },
      // 23.1.3.3 Map.prototype.delete(key)
      // 23.2.3.4 Set.prototype.delete(value)
      'delete': function (key) {
        var that = _validateCollection(this, NAME);
        var entry = getEntry(that, key);
        if (entry) {
          var next = entry.n;
          var prev = entry.p;
          delete that._i[entry.i];
          entry.r = true;
          if (prev) prev.n = next;
          if (next) next.p = prev;
          if (that._f == entry) that._f = next;
          if (that._l == entry) that._l = prev;
          that[SIZE]--;
        } return !!entry;
      },
      // 23.2.3.6 Set.prototype.forEach(callbackfn, thisArg = undefined)
      // 23.1.3.5 Map.prototype.forEach(callbackfn, thisArg = undefined)
      forEach: function forEach(callbackfn /* , that = undefined */) {
        _validateCollection(this, NAME);
        var f = _ctx(callbackfn, arguments.length > 1 ? arguments[1] : undefined, 3);
        var entry;
        while (entry = entry ? entry.n : this._f) {
          f(entry.v, entry.k, this);
          // revert to the last existing entry
          while (entry && entry.r) entry = entry.p;
        }
      },
      // 23.1.3.7 Map.prototype.has(key)
      // 23.2.3.7 Set.prototype.has(value)
      has: function has(key) {
        return !!getEntry(_validateCollection(this, NAME), key);
      }
    });
    if (_descriptors) dP$2(C.prototype, 'size', {
      get: function () {
        return _validateCollection(this, NAME)[SIZE];
      }
    });
    return C;
  },
  def: function (that, key, value) {
    var entry = getEntry(that, key);
    var prev, index;
    // change existing entry
    if (entry) {
      entry.v = value;
    // create new entry
    } else {
      that._l = entry = {
        i: index = fastKey(key, true), // <- index
        k: key,                        // <- key
        v: value,                      // <- value
        p: prev = that._l,             // <- previous entry
        n: undefined,                  // <- next entry
        r: false                       // <- removed
      };
      if (!that._f) that._f = entry;
      if (prev) prev.n = entry;
      that[SIZE]++;
      // add to index
      if (index !== 'F') that._i[index] = entry;
    } return that;
  },
  getEntry: getEntry,
  setStrong: function (C, NAME, IS_MAP) {
    // add .keys, .values, .entries, [@@iterator]
    // 23.1.3.4, 23.1.3.8, 23.1.3.11, 23.1.3.12, 23.2.3.5, 23.2.3.8, 23.2.3.10, 23.2.3.11
    _iterDefine(C, NAME, function (iterated, kind) {
      this._t = _validateCollection(iterated, NAME); // target
      this._k = kind;                     // kind
      this._l = undefined;                // previous
    }, function () {
      var that = this;
      var kind = that._k;
      var entry = that._l;
      // revert to the last existing entry
      while (entry && entry.r) entry = entry.p;
      // get next entry
      if (!that._t || !(that._l = entry = entry ? entry.n : that._t._f)) {
        // or finish the iteration
        that._t = undefined;
        return _iterStep(1);
      }
      // return step by kind
      if (kind == 'keys') return _iterStep(0, entry.k);
      if (kind == 'values') return _iterStep(0, entry.v);
      return _iterStep(0, [entry.k, entry.v]);
    }, IS_MAP ? 'entries' : 'values', !IS_MAP, true);

    // add [@@species], 23.1.2.2, 23.2.2.2
    _setSpecies(NAME);
  }
};

var SPECIES$1 = _wks('species');

var _arraySpeciesConstructor = function (original) {
  var C;
  if (_isArray(original)) {
    C = original.constructor;
    // cross-realm fallback
    if (typeof C == 'function' && (C === Array || _isArray(C.prototype))) C = undefined;
    if (_isObject(C)) {
      C = C[SPECIES$1];
      if (C === null) C = undefined;
    }
  } return C === undefined ? Array : C;
};

// 9.4.2.3 ArraySpeciesCreate(originalArray, length)


var _arraySpeciesCreate = function (original, length) {
  return new (_arraySpeciesConstructor(original))(length);
};

// 0 -> Array#forEach
// 1 -> Array#map
// 2 -> Array#filter
// 3 -> Array#some
// 4 -> Array#every
// 5 -> Array#find
// 6 -> Array#findIndex





var _arrayMethods = function (TYPE, $create) {
  var IS_MAP = TYPE == 1;
  var IS_FILTER = TYPE == 2;
  var IS_SOME = TYPE == 3;
  var IS_EVERY = TYPE == 4;
  var IS_FIND_INDEX = TYPE == 6;
  var NO_HOLES = TYPE == 5 || IS_FIND_INDEX;
  var create = $create || _arraySpeciesCreate;
  return function ($this, callbackfn, that) {
    var O = _toObject($this);
    var self = _iobject(O);
    var f = _ctx(callbackfn, that, 3);
    var length = _toLength(self.length);
    var index = 0;
    var result = IS_MAP ? create($this, length) : IS_FILTER ? create($this, 0) : undefined;
    var val, res;
    for (;length > index; index++) if (NO_HOLES || index in self) {
      val = self[index];
      res = f(val, index, O);
      if (TYPE) {
        if (IS_MAP) result[index] = res;   // map
        else if (res) switch (TYPE) {
          case 3: return true;             // some
          case 5: return val;              // find
          case 6: return index;            // findIndex
          case 2: result.push(val);        // filter
        } else if (IS_EVERY) return false; // every
      }
    }
    return IS_FIND_INDEX ? -1 : IS_SOME || IS_EVERY ? IS_EVERY : result;
  };
};

var dP$3 = _objectDp.f;
var each = _arrayMethods(0);


var _collection = function (NAME, wrapper, methods, common, IS_MAP, IS_WEAK) {
  var Base = _global[NAME];
  var C = Base;
  var ADDER = IS_MAP ? 'set' : 'add';
  var proto = C && C.prototype;
  var O = {};
  if (!_descriptors || typeof C != 'function' || !(IS_WEAK || proto.forEach && !_fails(function () {
    new C().entries().next();
  }))) {
    // create collection constructor
    C = common.getConstructor(wrapper, NAME, IS_MAP, ADDER);
    _redefineAll(C.prototype, methods);
    _meta.NEED = true;
  } else {
    C = wrapper(function (target, iterable) {
      _anInstance(target, C, NAME, '_c');
      target._c = new Base();
      if (iterable != undefined) _forOf(iterable, IS_MAP, target[ADDER], target);
    });
    each('add,clear,delete,forEach,get,has,set,keys,values,entries,toJSON'.split(','), function (KEY) {
      var IS_ADDER = KEY == 'add' || KEY == 'set';
      if (KEY in proto && !(IS_WEAK && KEY == 'clear')) _hide(C.prototype, KEY, function (a, b) {
        _anInstance(this, C, KEY);
        if (!IS_ADDER && IS_WEAK && !_isObject(a)) return KEY == 'get' ? undefined : false;
        var result = this._c[KEY](a === 0 ? 0 : a, b);
        return IS_ADDER ? this : result;
      });
    });
    IS_WEAK || dP$3(C.prototype, 'size', {
      get: function () {
        return this._c.size;
      }
    });
  }

  _setToStringTag(C, NAME);

  O[NAME] = C;
  _export(_export.G + _export.W + _export.F, O);

  if (!IS_WEAK) common.setStrong(C, NAME, IS_MAP);

  return C;
};

var MAP = 'Map';

// 23.1 Map Objects
var es6_map = _collection(MAP, function (get) {
  return function Map() { return get(this, arguments.length > 0 ? arguments[0] : undefined); };
}, {
  // 23.1.3.6 Map.prototype.get(key)
  get: function get(key) {
    var entry = _collectionStrong.getEntry(_validateCollection(this, MAP), key);
    return entry && entry.v;
  },
  // 23.1.3.9 Map.prototype.set(key, value)
  set: function set(key, value) {
    return _collectionStrong.def(_validateCollection(this, MAP), key === 0 ? 0 : key, value);
  }
}, _collectionStrong, true);

var _arrayFromIterable = function (iter, ITERATOR) {
  var result = [];
  _forOf(iter, false, result.push, result, ITERATOR);
  return result;
};

// https://github.com/DavidBruant/Map-Set.prototype.toJSON


var _collectionToJson = function (NAME) {
  return function toJSON() {
    if (_classof(this) != NAME) throw TypeError(NAME + "#toJSON isn't generic");
    return _arrayFromIterable(this);
  };
};

// https://github.com/DavidBruant/Map-Set.prototype.toJSON


_export(_export.P + _export.R, 'Map', { toJSON: _collectionToJson('Map') });

// https://tc39.github.io/proposal-setmap-offrom/


var _setCollectionOf = function (COLLECTION) {
  _export(_export.S, COLLECTION, { of: function of() {
    var length = arguments.length;
    var A = new Array(length);
    while (length--) A[length] = arguments[length];
    return new this(A);
  } });
};

// https://tc39.github.io/proposal-setmap-offrom/#sec-map.of
_setCollectionOf('Map');

// https://tc39.github.io/proposal-setmap-offrom/





var _setCollectionFrom = function (COLLECTION) {
  _export(_export.S, COLLECTION, { from: function from(source /* , mapFn, thisArg */) {
    var mapFn = arguments[1];
    var mapping, A, n, cb;
    _aFunction(this);
    mapping = mapFn !== undefined;
    if (mapping) _aFunction(mapFn);
    if (source == undefined) return new this();
    A = [];
    if (mapping) {
      n = 0;
      cb = _ctx(mapFn, arguments[2], 2);
      _forOf(source, false, function (nextItem) {
        A.push(cb(nextItem, n++));
      });
    } else {
      _forOf(source, false, A.push, A);
    }
    return new this(A);
  } });
};

// https://tc39.github.io/proposal-setmap-offrom/#sec-map.from
_setCollectionFrom('Map');

var map$1 = _core.Map;

var map = createCommonjsModule(function (module) {
module.exports = { "default": map$1, __esModule: true };
});

var _Map = unwrapExports(map);

// 19.1.2.9 Object.getPrototypeOf(O)



_objectSap('getPrototypeOf', function () {
  return function getPrototypeOf(it) {
    return _objectGpo(_toObject(it));
  };
});

var getPrototypeOf$1 = _core.Object.getPrototypeOf;

var getPrototypeOf = createCommonjsModule(function (module) {
module.exports = { "default": getPrototypeOf$1, __esModule: true };
});

var _Object$getPrototypeOf = unwrapExports(getPrototypeOf);

var possibleConstructorReturn = createCommonjsModule(function (module, exports) {
exports.__esModule = true;



var _typeof3 = _interopRequireDefault(_typeof_1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = function (self, call) {
  if (!self) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }

  return call && ((typeof call === "undefined" ? "undefined" : (0, _typeof3.default)(call)) === "object" || typeof call === "function") ? call : self;
};
});

var _possibleConstructorReturn = unwrapExports(possibleConstructorReturn);

// Works with __proto__ only. Old v8 can't work with null proto objects.
/* eslint-disable no-proto */


var check = function (O, proto) {
  _anObject(O);
  if (!_isObject(proto) && proto !== null) throw TypeError(proto + ": can't set as prototype!");
};
var _setProto = {
  set: Object.setPrototypeOf || ('__proto__' in {} ? // eslint-disable-line
    function (test, buggy, set) {
      try {
        set = _ctx(Function.call, _objectGopd.f(Object.prototype, '__proto__').set, 2);
        set(test, []);
        buggy = !(test instanceof Array);
      } catch (e) { buggy = true; }
      return function setPrototypeOf(O, proto) {
        check(O, proto);
        if (buggy) O.__proto__ = proto;
        else set(O, proto);
        return O;
      };
    }({}, false) : undefined),
  check: check
};

// 19.1.3.19 Object.setPrototypeOf(O, proto)

_export(_export.S, 'Object', { setPrototypeOf: _setProto.set });

var setPrototypeOf$2 = _core.Object.setPrototypeOf;

var setPrototypeOf = createCommonjsModule(function (module) {
module.exports = { "default": setPrototypeOf$2, __esModule: true };
});

unwrapExports(setPrototypeOf);

// 19.1.2.2 / 15.2.3.5 Object.create(O [, Properties])
_export(_export.S, 'Object', { create: _objectCreate });

var $Object$1 = _core.Object;
var create$2 = function create(P, D) {
  return $Object$1.create(P, D);
};

var create = createCommonjsModule(function (module) {
module.exports = { "default": create$2, __esModule: true };
});

unwrapExports(create);

var inherits = createCommonjsModule(function (module, exports) {
exports.__esModule = true;



var _setPrototypeOf2 = _interopRequireDefault(setPrototypeOf);



var _create2 = _interopRequireDefault(create);



var _typeof3 = _interopRequireDefault(_typeof_1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = function (subClass, superClass) {
  if (typeof superClass !== "function" && superClass !== null) {
    throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : (0, _typeof3.default)(superClass)));
  }

  subClass.prototype = (0, _create2.default)(superClass && superClass.prototype, {
    constructor: {
      value: subClass,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
  if (superClass) _setPrototypeOf2.default ? (0, _setPrototypeOf2.default)(subClass, superClass) : subClass.__proto__ = superClass;
};
});

var _inherits = unwrapExports(inherits);

var index_browser_umd$1 = createCommonjsModule(function (module, exports) {
(function (global, factory) {
	factory(exports);
}(commonjsGlobal, (function (exports) { var commonjsGlobal$$1 = typeof window !== 'undefined' ? window : typeof commonjsGlobal !== 'undefined' ? commonjsGlobal : typeof self !== 'undefined' ? self : {};



function unwrapExports$$1 (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

function createCommonjsModule$$1(fn, module) {
	return module = { exports: {} }, fn(module, module.exports), module.exports;
}

var _iterStep = function(done, value){
  return {value: value, done: !!done};
};

var _iterators = {};

var toString = {}.toString;

var _cof = function(it){
  return toString.call(it).slice(8, -1);
};

// fallback for non-array-like ES3 and non-enumerable old V8 strings

var _iobject = Object('z').propertyIsEnumerable(0) ? Object : function(it){
  return _cof(it) == 'String' ? it.split('') : Object(it);
};

// 7.2.1 RequireObjectCoercible(argument)
var _defined = function(it){
  if(it == undefined)throw TypeError("Can't call method on  " + it);
  return it;
};

// to indexed object, toObject with fallback for non-array-like ES3 strings

var _toIobject = function(it){
  return _iobject(_defined(it));
};

var _library = true;

var _global = createCommonjsModule$$1(function (module) {
// https://github.com/zloirock/core-js/issues/86#issuecomment-115759028
var global = module.exports = typeof window != 'undefined' && window.Math == Math
  ? window : typeof self != 'undefined' && self.Math == Math ? self : Function('return this')();
if(typeof __g == 'number')__g = global; // eslint-disable-line no-undef
});

var _core = createCommonjsModule$$1(function (module) {
var core = module.exports = {version: '2.4.0'};
if(typeof __e == 'number')__e = core; // eslint-disable-line no-undef
});

var _core_1 = _core.version;

var _aFunction = function(it){
  if(typeof it != 'function')throw TypeError(it + ' is not a function!');
  return it;
};

// optional / simple context binding

var _ctx = function(fn, that, length){
  _aFunction(fn);
  if(that === undefined)return fn;
  switch(length){
    case 1: return function(a){
      return fn.call(that, a);
    };
    case 2: return function(a, b){
      return fn.call(that, a, b);
    };
    case 3: return function(a, b, c){
      return fn.call(that, a, b, c);
    };
  }
  return function(/* ...args */){
    return fn.apply(that, arguments);
  };
};

var _isObject = function(it){
  return typeof it === 'object' ? it !== null : typeof it === 'function';
};

var _anObject = function(it){
  if(!_isObject(it))throw TypeError(it + ' is not an object!');
  return it;
};

var _fails = function(exec){
  try {
    return !!exec();
  } catch(e){
    return true;
  }
};

// Thank's IE8 for his funny defineProperty
var _descriptors = !_fails(function(){
  return Object.defineProperty({}, 'a', {get: function(){ return 7; }}).a != 7;
});

var document$1 = _global.document;
var is = _isObject(document$1) && _isObject(document$1.createElement);
var _domCreate = function(it){
  return is ? document$1.createElement(it) : {};
};

var _ie8DomDefine = !_descriptors && !_fails(function(){
  return Object.defineProperty(_domCreate('div'), 'a', {get: function(){ return 7; }}).a != 7;
});

// 7.1.1 ToPrimitive(input [, PreferredType])

// instead of the ES6 spec version, we didn't implement @@toPrimitive case
// and the second argument - flag - preferred type is a string
var _toPrimitive = function(it, S){
  if(!_isObject(it))return it;
  var fn, val;
  if(S && typeof (fn = it.toString) == 'function' && !_isObject(val = fn.call(it)))return val;
  if(typeof (fn = it.valueOf) == 'function' && !_isObject(val = fn.call(it)))return val;
  if(!S && typeof (fn = it.toString) == 'function' && !_isObject(val = fn.call(it)))return val;
  throw TypeError("Can't convert object to primitive value");
};

var dP             = Object.defineProperty;

var f = _descriptors ? Object.defineProperty : function defineProperty(O, P, Attributes){
  _anObject(O);
  P = _toPrimitive(P, true);
  _anObject(Attributes);
  if(_ie8DomDefine)try {
    return dP(O, P, Attributes);
  } catch(e){ /* empty */ }
  if('get' in Attributes || 'set' in Attributes)throw TypeError('Accessors not supported!');
  if('value' in Attributes)O[P] = Attributes.value;
  return O;
};

var _objectDp = {
	f: f
};

var _propertyDesc = function(bitmap, value){
  return {
    enumerable  : !(bitmap & 1),
    configurable: !(bitmap & 2),
    writable    : !(bitmap & 4),
    value       : value
  };
};

var _hide = _descriptors ? function(object, key, value){
  return _objectDp.f(object, key, _propertyDesc(1, value));
} : function(object, key, value){
  object[key] = value;
  return object;
};

var PROTOTYPE = 'prototype';

var $export = function(type, name, source){
  var IS_FORCED = type & $export.F
    , IS_GLOBAL = type & $export.G
    , IS_STATIC = type & $export.S
    , IS_PROTO  = type & $export.P
    , IS_BIND   = type & $export.B
    , IS_WRAP   = type & $export.W
    , exports   = IS_GLOBAL ? _core : _core[name] || (_core[name] = {})
    , expProto  = exports[PROTOTYPE]
    , target    = IS_GLOBAL ? _global : IS_STATIC ? _global[name] : (_global[name] || {})[PROTOTYPE]
    , key, own, out;
  if(IS_GLOBAL)source = name;
  for(key in source){
    // contains in native
    own = !IS_FORCED && target && target[key] !== undefined;
    if(own && key in exports)continue;
    // export native or passed
    out = own ? target[key] : source[key];
    // prevent global pollution for namespaces
    exports[key] = IS_GLOBAL && typeof target[key] != 'function' ? source[key]
    // bind timers to global for call from export context
    : IS_BIND && own ? _ctx(out, _global)
    // wrap global constructors for prevent change them in library
    : IS_WRAP && target[key] == out ? (function(C){
      var F = function(a, b, c){
        if(this instanceof C){
          switch(arguments.length){
            case 0: return new C;
            case 1: return new C(a);
            case 2: return new C(a, b);
          } return new C(a, b, c);
        } return C.apply(this, arguments);
      };
      F[PROTOTYPE] = C[PROTOTYPE];
      return F;
    // make static versions for prototype methods
    })(out) : IS_PROTO && typeof out == 'function' ? _ctx(Function.call, out) : out;
    // export proto methods to core.%CONSTRUCTOR%.methods.%NAME%
    if(IS_PROTO){
      (exports.virtual || (exports.virtual = {}))[key] = out;
      // export proto methods to core.%CONSTRUCTOR%.prototype.%NAME%
      if(type & $export.R && expProto && !expProto[key])_hide(expProto, key, out);
    }
  }
};
// type bitmap
$export.F = 1;   // forced
$export.G = 2;   // global
$export.S = 4;   // static
$export.P = 8;   // proto
$export.B = 16;  // bind
$export.W = 32;  // wrap
$export.U = 64;  // safe
$export.R = 128; // real proto method for `library` 
var _export = $export;

var _redefine = _hide;

var hasOwnProperty = {}.hasOwnProperty;
var _has = function(it, key){
  return hasOwnProperty.call(it, key);
};

// 7.1.4 ToInteger
var ceil  = Math.ceil;
var floor = Math.floor;
var _toInteger = function(it){
  return isNaN(it = +it) ? 0 : (it > 0 ? floor : ceil)(it);
};

// 7.1.15 ToLength
var min       = Math.min;
var _toLength = function(it){
  return it > 0 ? min(_toInteger(it), 0x1fffffffffffff) : 0; // pow(2, 53) - 1 == 9007199254740991
};

var max       = Math.max;
var min$1       = Math.min;
var _toIndex = function(index, length){
  index = _toInteger(index);
  return index < 0 ? max(index + length, 0) : min$1(index, length);
};

// false -> Array#indexOf
// true  -> Array#includes

var _arrayIncludes = function(IS_INCLUDES){
  return function($this, el, fromIndex){
    var O      = _toIobject($this)
      , length = _toLength(O.length)
      , index  = _toIndex(fromIndex, length)
      , value;
    // Array#includes uses SameValueZero equality algorithm
    if(IS_INCLUDES && el != el)while(length > index){
      value = O[index++];
      if(value != value)return true;
    // Array#toIndex ignores holes, Array#includes - not
    } else for(;length > index; index++)if(IS_INCLUDES || index in O){
      if(O[index] === el)return IS_INCLUDES || index || 0;
    } return !IS_INCLUDES && -1;
  };
};

var SHARED = '__core-js_shared__';
var store  = _global[SHARED] || (_global[SHARED] = {});
var _shared = function(key){
  return store[key] || (store[key] = {});
};

var id = 0;
var px = Math.random();
var _uid = function(key){
  return 'Symbol('.concat(key === undefined ? '' : key, ')_', (++id + px).toString(36));
};

var shared = _shared('keys');
var _sharedKey = function(key){
  return shared[key] || (shared[key] = _uid(key));
};

var arrayIndexOf = _arrayIncludes(false);
var IE_PROTO$1     = _sharedKey('IE_PROTO');

var _objectKeysInternal = function(object, names){
  var O      = _toIobject(object)
    , i      = 0
    , result = []
    , key;
  for(key in O)if(key != IE_PROTO$1)_has(O, key) && result.push(key);
  // Don't enum bug & hidden keys
  while(names.length > i)if(_has(O, key = names[i++])){
    ~arrayIndexOf(result, key) || result.push(key);
  }
  return result;
};

// IE 8- don't enum bug keys
var _enumBugKeys = (
  'constructor,hasOwnProperty,isPrototypeOf,propertyIsEnumerable,toLocaleString,toString,valueOf'
).split(',');

// 19.1.2.14 / 15.2.3.14 Object.keys(O)


var _objectKeys = Object.keys || function keys(O){
  return _objectKeysInternal(O, _enumBugKeys);
};

var _objectDps = _descriptors ? Object.defineProperties : function defineProperties(O, Properties){
  _anObject(O);
  var keys   = _objectKeys(Properties)
    , length = keys.length
    , i = 0
    , P;
  while(length > i)_objectDp.f(O, P = keys[i++], Properties[P]);
  return O;
};

var _html = _global.document && document.documentElement;

// 19.1.2.2 / 15.2.3.5 Object.create(O [, Properties])
var IE_PROTO    = _sharedKey('IE_PROTO');
var Empty       = function(){ /* empty */ };
var PROTOTYPE$1   = 'prototype';

// Create object with fake `null` prototype: use iframe Object with cleared prototype
var createDict = function(){
  // Thrash, waste and sodomy: IE GC bug
  var iframe = _domCreate('iframe')
    , i      = _enumBugKeys.length
    , lt     = '<'
    , gt     = '>'
    , iframeDocument;
  iframe.style.display = 'none';
  _html.appendChild(iframe);
  iframe.src = 'javascript:'; // eslint-disable-line no-script-url
  // createDict = iframe.contentWindow.Object;
  // html.removeChild(iframe);
  iframeDocument = iframe.contentWindow.document;
  iframeDocument.open();
  iframeDocument.write(lt + 'script' + gt + 'document.F=Object' + lt + '/script' + gt);
  iframeDocument.close();
  createDict = iframeDocument.F;
  while(i--)delete createDict[PROTOTYPE$1][_enumBugKeys[i]];
  return createDict();
};

var _objectCreate = Object.create || function create(O, Properties){
  var result;
  if(O !== null){
    Empty[PROTOTYPE$1] = _anObject(O);
    result = new Empty;
    Empty[PROTOTYPE$1] = null;
    // add "__proto__" for Object.getPrototypeOf polyfill
    result[IE_PROTO] = O;
  } else result = createDict();
  return Properties === undefined ? result : _objectDps(result, Properties);
};

var _wks = createCommonjsModule$$1(function (module) {
var store      = _shared('wks')
  , Symbol     = _global.Symbol
  , USE_SYMBOL = typeof Symbol == 'function';

var $exports = module.exports = function(name){
  return store[name] || (store[name] =
    USE_SYMBOL && Symbol[name] || (USE_SYMBOL ? Symbol : _uid)('Symbol.' + name));
};

$exports.store = store;
});

var def = _objectDp.f;
var TAG = _wks('toStringTag');

var _setToStringTag = function(it, tag, stat){
  if(it && !_has(it = stat ? it : it.prototype, TAG))def(it, TAG, {configurable: true, value: tag});
};

var IteratorPrototype = {};

// 25.1.2.1.1 %IteratorPrototype%[@@iterator]()
_hide(IteratorPrototype, _wks('iterator'), function(){ return this; });

var _iterCreate = function(Constructor, NAME, next){
  Constructor.prototype = _objectCreate(IteratorPrototype, {next: _propertyDesc(1, next)});
  _setToStringTag(Constructor, NAME + ' Iterator');
};

// 7.1.13 ToObject(argument)

var _toObject = function(it){
  return Object(_defined(it));
};

// 19.1.2.9 / 15.2.3.2 Object.getPrototypeOf(O)
var IE_PROTO$2    = _sharedKey('IE_PROTO');
var ObjectProto = Object.prototype;

var _objectGpo = Object.getPrototypeOf || function(O){
  O = _toObject(O);
  if(_has(O, IE_PROTO$2))return O[IE_PROTO$2];
  if(typeof O.constructor == 'function' && O instanceof O.constructor){
    return O.constructor.prototype;
  } return O instanceof Object ? ObjectProto : null;
};

var ITERATOR       = _wks('iterator');
var BUGGY          = !([].keys && 'next' in [].keys());
var FF_ITERATOR    = '@@iterator';
var KEYS           = 'keys';
var VALUES         = 'values';

var returnThis = function(){ return this; };

var _iterDefine = function(Base, NAME, Constructor, next, DEFAULT, IS_SET, FORCED){
  _iterCreate(Constructor, NAME, next);
  var getMethod = function(kind){
    if(!BUGGY && kind in proto)return proto[kind];
    switch(kind){
      case KEYS: return function keys(){ return new Constructor(this, kind); };
      case VALUES: return function values(){ return new Constructor(this, kind); };
    } return function entries(){ return new Constructor(this, kind); };
  };
  var TAG        = NAME + ' Iterator'
    , DEF_VALUES = DEFAULT == VALUES
    , VALUES_BUG = false
    , proto      = Base.prototype
    , $native    = proto[ITERATOR] || proto[FF_ITERATOR] || DEFAULT && proto[DEFAULT]
    , $default   = $native || getMethod(DEFAULT)
    , $entries   = DEFAULT ? !DEF_VALUES ? $default : getMethod('entries') : undefined
    , $anyNative = NAME == 'Array' ? proto.entries || $native : $native
    , methods, key, IteratorPrototype;
  // Fix native
  if($anyNative){
    IteratorPrototype = _objectGpo($anyNative.call(new Base));
    if(IteratorPrototype !== Object.prototype){
      // Set @@toStringTag to native iterators
      _setToStringTag(IteratorPrototype, TAG, true);
      // fix for some old engines
      if(!_library && !_has(IteratorPrototype, ITERATOR))_hide(IteratorPrototype, ITERATOR, returnThis);
    }
  }
  // fix Array#{values, @@iterator}.name in V8 / FF
  if(DEF_VALUES && $native && $native.name !== VALUES){
    VALUES_BUG = true;
    $default = function values(){ return $native.call(this); };
  }
  // Define iterator
  if((!_library || FORCED) && (BUGGY || VALUES_BUG || !proto[ITERATOR])){
    _hide(proto, ITERATOR, $default);
  }
  // Plug for library
  _iterators[NAME] = $default;
  _iterators[TAG]  = returnThis;
  if(DEFAULT){
    methods = {
      values:  DEF_VALUES ? $default : getMethod(VALUES),
      keys:    IS_SET     ? $default : getMethod(KEYS),
      entries: $entries
    };
    if(FORCED)for(key in methods){
      if(!(key in proto))_redefine(proto, key, methods[key]);
    } else _export(_export.P + _export.F * (BUGGY || VALUES_BUG), NAME, methods);
  }
  return methods;
};

// 22.1.3.4 Array.prototype.entries()
// 22.1.3.13 Array.prototype.keys()
// 22.1.3.29 Array.prototype.values()
// 22.1.3.30 Array.prototype[@@iterator]()
var es6_array_iterator = _iterDefine(Array, 'Array', function(iterated, kind){
  this._t = _toIobject(iterated); // target
  this._i = 0;                   // next index
  this._k = kind;                // kind
// 22.1.5.2.1 %ArrayIteratorPrototype%.next()
}, function(){
  var O     = this._t
    , kind  = this._k
    , index = this._i++;
  if(!O || index >= O.length){
    this._t = undefined;
    return _iterStep(1);
  }
  if(kind == 'keys'  )return _iterStep(0, index);
  if(kind == 'values')return _iterStep(0, O[index]);
  return _iterStep(0, [index, O[index]]);
}, 'values');

// argumentsList[@@iterator] is %ArrayProto_values% (9.4.4.6, 9.4.4.7)
_iterators.Arguments = _iterators.Array;

var TO_STRING_TAG = _wks('toStringTag');

for(var collections = ['NodeList', 'DOMTokenList', 'MediaList', 'StyleSheetList', 'CSSRuleList'], i = 0; i < 5; i++){
  var NAME       = collections[i]
    , Collection = _global[NAME]
    , proto      = Collection && Collection.prototype;
  if(proto && !proto[TO_STRING_TAG])_hide(proto, TO_STRING_TAG, NAME);
  _iterators[NAME] = _iterators.Array;
}

// true  -> String#at
// false -> String#codePointAt
var _stringAt = function(TO_STRING){
  return function(that, pos){
    var s = String(_defined(that))
      , i = _toInteger(pos)
      , l = s.length
      , a, b;
    if(i < 0 || i >= l)return TO_STRING ? '' : undefined;
    a = s.charCodeAt(i);
    return a < 0xd800 || a > 0xdbff || i + 1 === l || (b = s.charCodeAt(i + 1)) < 0xdc00 || b > 0xdfff
      ? TO_STRING ? s.charAt(i) : a
      : TO_STRING ? s.slice(i, i + 2) : (a - 0xd800 << 10) + (b - 0xdc00) + 0x10000;
  };
};

var $at  = _stringAt(true);

// 21.1.3.27 String.prototype[@@iterator]()
_iterDefine(String, 'String', function(iterated){
  this._t = String(iterated); // target
  this._i = 0;                // next index
// 21.1.5.2.1 %StringIteratorPrototype%.next()
}, function(){
  var O     = this._t
    , index = this._i
    , point;
  if(index >= O.length)return {value: undefined, done: true};
  point = $at(O, index);
  this._i += point.length;
  return {value: point, done: false};
});

// getting tag from 19.1.3.6 Object.prototype.toString()
var TAG$1 = _wks('toStringTag');
var ARG = _cof(function(){ return arguments; }()) == 'Arguments';

// fallback for IE11 Script Access Denied error
var tryGet = function(it, key){
  try {
    return it[key];
  } catch(e){ /* empty */ }
};

var _classof = function(it){
  var O, T, B;
  return it === undefined ? 'Undefined' : it === null ? 'Null'
    // @@toStringTag case
    : typeof (T = tryGet(O = Object(it), TAG$1)) == 'string' ? T
    // builtinTag case
    : ARG ? _cof(O)
    // ES3 arguments fallback
    : (B = _cof(O)) == 'Object' && typeof O.callee == 'function' ? 'Arguments' : B;
};

var ITERATOR$1  = _wks('iterator');
var core_isIterable = _core.isIterable = function(it){
  var O = Object(it);
  return O[ITERATOR$1] !== undefined
    || '@@iterator' in O
    || _iterators.hasOwnProperty(_classof(O));
};

var isIterable$2 = core_isIterable;

var isIterable = createCommonjsModule$$1(function (module) {
module.exports = { "default": isIterable$2, __esModule: true };
});

unwrapExports$$1(isIterable);

var ITERATOR$2  = _wks('iterator');
var core_getIteratorMethod = _core.getIteratorMethod = function(it){
  if(it != undefined)return it[ITERATOR$2]
    || it['@@iterator']
    || _iterators[_classof(it)];
};

var core_getIterator = _core.getIterator = function(it){
  var iterFn = core_getIteratorMethod(it);
  if(typeof iterFn != 'function')throw TypeError(it + ' is not iterable!');
  return _anObject(iterFn.call(it));
};

var getIterator$2 = core_getIterator;

var getIterator = createCommonjsModule$$1(function (module) {
module.exports = { "default": getIterator$2, __esModule: true };
});

unwrapExports$$1(getIterator);

var slicedToArray = createCommonjsModule$$1(function (module, exports) {
exports.__esModule = true;



var _isIterable3 = _interopRequireDefault(isIterable);



var _getIterator3 = _interopRequireDefault(getIterator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = function () {
  function sliceIterator(arr, i) {
    var _arr = [];
    var _n = true;
    var _d = false;
    var _e = undefined;

    try {
      for (var _i = (0, _getIterator3.default)(arr), _s; !(_n = (_s = _i.next()).done); _n = true) {
        _arr.push(_s.value);

        if (i && _arr.length === i) break;
      }
    } catch (err) {
      _d = true;
      _e = err;
    } finally {
      try {
        if (!_n && _i["return"]) _i["return"]();
      } finally {
        if (_d) throw _e;
      }
    }

    return _arr;
  }

  return function (arr, i) {
    if (Array.isArray(arr)) {
      return arr;
    } else if ((0, _isIterable3.default)(Object(arr))) {
      return sliceIterator(arr, i);
    } else {
      throw new TypeError("Invalid attempt to destructure non-iterable instance");
    }
  };
}();
});

var _slicedToArray = unwrapExports$$1(slicedToArray);

var classCallCheck = createCommonjsModule$$1(function (module, exports) {
exports.__esModule = true;

exports.default = function (instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
};
});

var _classCallCheck = unwrapExports$$1(classCallCheck);

// 19.1.2.4 / 15.2.3.6 Object.defineProperty(O, P, Attributes)
_export(_export.S + _export.F * !_descriptors, 'Object', {defineProperty: _objectDp.f});

var $Object = _core.Object;
var defineProperty$2 = function defineProperty(it, key, desc){
  return $Object.defineProperty(it, key, desc);
};

var defineProperty = createCommonjsModule$$1(function (module) {
module.exports = { "default": defineProperty$2, __esModule: true };
});

unwrapExports$$1(defineProperty);

var createClass = createCommonjsModule$$1(function (module, exports) {
exports.__esModule = true;



var _defineProperty2 = _interopRequireDefault(defineProperty);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = function () {
  function defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      (0, _defineProperty2.default)(target, descriptor.key, descriptor);
    }
  }

  return function (Constructor, protoProps, staticProps) {
    if (protoProps) defineProperties(Constructor.prototype, protoProps);
    if (staticProps) defineProperties(Constructor, staticProps);
    return Constructor;
  };
}();
});

var _createClass = unwrapExports$$1(createClass);

function allocate(tree, counter, snapshot) {
  var changed = void 0;
  var treeNew = void 0;
  tree.allocate(counter, function (_ref) {
    var counter_ = _ref.counter,
        changed_ = _ref.changed,
        tree_ = _ref.tree;

    counter = counter_;
    changed = changed_;
    treeNew = tree_;
  }, snapshot);
  // $FlowFixMe: changed is initialised
  return [counter, changed, treeNew];
}
/** @module counterUtil */

function deallocate(tree, counter, snapshot) {
  var changed = void 0;
  var treeNew = void 0;
  tree.deallocate(counter, function (_ref2) {
    var changed_ = _ref2.changed,
        tree_ = _ref2.tree;

    changed = changed_;
    treeNew = tree_;
  }, snapshot);
  // $FlowFixMe: changed is initialised
  return [changed, treeNew];
}

function check(tree, counter) {
  var set = void 0;
  tree.check(counter, function (set_) {
    set = set_;
  });
  return !!set;
}

// most Object methods by ES6 should accept primitives

var _objectSap = function(KEY, exec){
  var fn  = (_core.Object || {})[KEY] || Object[KEY]
    , exp = {};
  exp[KEY] = exec(fn);
  _export(_export.S + _export.F * _fails(function(){ fn(1); }), 'Object', exp);
};

// 19.1.2.14 Object.keys(O)


_objectSap('keys', function(){
  return function keys(it){
    return _objectKeys(_toObject(it));
  };
});

var keys$1 = _core.Object.keys;

var keys = createCommonjsModule$$1(function (module) {
module.exports = { "default": keys$1, __esModule: true };
});

var _Object$keys = unwrapExports$$1(keys);

// 19.1.2.9 Object.getPrototypeOf(O)


_objectSap('getPrototypeOf', function(){
  return function getPrototypeOf(it){
    return _objectGpo(_toObject(it));
  };
});

var getPrototypeOf$1 = _core.Object.getPrototypeOf;

var getPrototypeOf = createCommonjsModule$$1(function (module) {
module.exports = { "default": getPrototypeOf$1, __esModule: true };
});

var _Object$getPrototypeOf = unwrapExports$$1(getPrototypeOf);

var f$1 = _wks;

var _wksExt = {
	f: f$1
};

var iterator$2 = _wksExt.f('iterator');

var iterator = createCommonjsModule$$1(function (module) {
module.exports = { "default": iterator$2, __esModule: true };
});

unwrapExports$$1(iterator);

var _meta = createCommonjsModule$$1(function (module) {
var META     = _uid('meta')
  , setDesc  = _objectDp.f
  , id       = 0;
var isExtensible = Object.isExtensible || function(){
  return true;
};
var FREEZE = !_fails(function(){
  return isExtensible(Object.preventExtensions({}));
});
var setMeta = function(it){
  setDesc(it, META, {value: {
    i: 'O' + ++id, // object ID
    w: {}          // weak collections IDs
  }});
};
var fastKey = function(it, create){
  // return primitive with prefix
  if(!_isObject(it))return typeof it == 'symbol' ? it : (typeof it == 'string' ? 'S' : 'P') + it;
  if(!_has(it, META)){
    // can't set metadata to uncaught frozen object
    if(!isExtensible(it))return 'F';
    // not necessary to add metadata
    if(!create)return 'E';
    // add missing metadata
    setMeta(it);
  // return object ID
  } return it[META].i;
};
var getWeak = function(it, create){
  if(!_has(it, META)){
    // can't set metadata to uncaught frozen object
    if(!isExtensible(it))return true;
    // not necessary to add metadata
    if(!create)return false;
    // add missing metadata
    setMeta(it);
  // return hash weak collections IDs
  } return it[META].w;
};
// add metadata on freeze-family methods calling
var onFreeze = function(it){
  if(FREEZE && meta.NEED && isExtensible(it) && !_has(it, META))setMeta(it);
  return it;
};
var meta = module.exports = {
  KEY:      META,
  NEED:     false,
  fastKey:  fastKey,
  getWeak:  getWeak,
  onFreeze: onFreeze
};
});

var _meta_1 = _meta.KEY;
var _meta_2 = _meta.NEED;
var _meta_3 = _meta.fastKey;
var _meta_4 = _meta.getWeak;
var _meta_5 = _meta.onFreeze;

var defineProperty$4 = _objectDp.f;
var _wksDefine = function(name){
  var $Symbol = _core.Symbol || (_core.Symbol = _library ? {} : _global.Symbol || {});
  if(name.charAt(0) != '_' && !(name in $Symbol))defineProperty$4($Symbol, name, {value: _wksExt.f(name)});
};

var _keyof = function(object, el){
  var O      = _toIobject(object)
    , keys   = _objectKeys(O)
    , length = keys.length
    , index  = 0
    , key;
  while(length > index)if(O[key = keys[index++]] === el)return key;
};

var f$2 = Object.getOwnPropertySymbols;

var _objectGops = {
	f: f$2
};

var f$3 = {}.propertyIsEnumerable;

var _objectPie = {
	f: f$3
};

// all enumerable object keys, includes symbols

var _enumKeys = function(it){
  var result     = _objectKeys(it)
    , getSymbols = _objectGops.f;
  if(getSymbols){
    var symbols = getSymbols(it)
      , isEnum  = _objectPie.f
      , i       = 0
      , key;
    while(symbols.length > i)if(isEnum.call(it, key = symbols[i++]))result.push(key);
  } return result;
};

// 7.2.2 IsArray(argument)

var _isArray = Array.isArray || function isArray(arg){
  return _cof(arg) == 'Array';
};

// 19.1.2.7 / 15.2.3.4 Object.getOwnPropertyNames(O)
var hiddenKeys = _enumBugKeys.concat('length', 'prototype');

var f$5 = Object.getOwnPropertyNames || function getOwnPropertyNames(O){
  return _objectKeysInternal(O, hiddenKeys);
};

var _objectGopn = {
	f: f$5
};

// fallback for IE11 buggy Object.getOwnPropertyNames with iframe and window
var gOPN$1      = _objectGopn.f;
var toString$1  = {}.toString;

var windowNames = typeof window == 'object' && window && Object.getOwnPropertyNames
  ? Object.getOwnPropertyNames(window) : [];

var getWindowNames = function(it){
  try {
    return gOPN$1(it);
  } catch(e){
    return windowNames.slice();
  }
};

var f$4 = function getOwnPropertyNames(it){
  return windowNames && toString$1.call(it) == '[object Window]' ? getWindowNames(it) : gOPN$1(_toIobject(it));
};

var _objectGopnExt = {
	f: f$4
};

var gOPD$1           = Object.getOwnPropertyDescriptor;

var f$6 = _descriptors ? gOPD$1 : function getOwnPropertyDescriptor(O, P){
  O = _toIobject(O);
  P = _toPrimitive(P, true);
  if(_ie8DomDefine)try {
    return gOPD$1(O, P);
  } catch(e){ /* empty */ }
  if(_has(O, P))return _propertyDesc(!_objectPie.f.call(O, P), O[P]);
};

var _objectGopd = {
	f: f$6
};

// ECMAScript 6 symbols shim
var META           = _meta.KEY;
var gOPD           = _objectGopd.f;
var dP$1             = _objectDp.f;
var gOPN           = _objectGopnExt.f;
var $Symbol        = _global.Symbol;
var $JSON          = _global.JSON;
var _stringify     = $JSON && $JSON.stringify;
var PROTOTYPE$2      = 'prototype';
var HIDDEN         = _wks('_hidden');
var TO_PRIMITIVE   = _wks('toPrimitive');
var isEnum         = {}.propertyIsEnumerable;
var SymbolRegistry = _shared('symbol-registry');
var AllSymbols     = _shared('symbols');
var OPSymbols      = _shared('op-symbols');
var ObjectProto$1    = Object[PROTOTYPE$2];
var USE_NATIVE     = typeof $Symbol == 'function';
var QObject        = _global.QObject;
// Don't use setters in Qt Script, https://github.com/zloirock/core-js/issues/173
var setter = !QObject || !QObject[PROTOTYPE$2] || !QObject[PROTOTYPE$2].findChild;

// fallback for old Android, https://code.google.com/p/v8/issues/detail?id=687
var setSymbolDesc = _descriptors && _fails(function(){
  return _objectCreate(dP$1({}, 'a', {
    get: function(){ return dP$1(this, 'a', {value: 7}).a; }
  })).a != 7;
}) ? function(it, key, D){
  var protoDesc = gOPD(ObjectProto$1, key);
  if(protoDesc)delete ObjectProto$1[key];
  dP$1(it, key, D);
  if(protoDesc && it !== ObjectProto$1)dP$1(ObjectProto$1, key, protoDesc);
} : dP$1;

var wrap = function(tag){
  var sym = AllSymbols[tag] = _objectCreate($Symbol[PROTOTYPE$2]);
  sym._k = tag;
  return sym;
};

var isSymbol = USE_NATIVE && typeof $Symbol.iterator == 'symbol' ? function(it){
  return typeof it == 'symbol';
} : function(it){
  return it instanceof $Symbol;
};

var $defineProperty = function defineProperty(it, key, D){
  if(it === ObjectProto$1)$defineProperty(OPSymbols, key, D);
  _anObject(it);
  key = _toPrimitive(key, true);
  _anObject(D);
  if(_has(AllSymbols, key)){
    if(!D.enumerable){
      if(!_has(it, HIDDEN))dP$1(it, HIDDEN, _propertyDesc(1, {}));
      it[HIDDEN][key] = true;
    } else {
      if(_has(it, HIDDEN) && it[HIDDEN][key])it[HIDDEN][key] = false;
      D = _objectCreate(D, {enumerable: _propertyDesc(0, false)});
    } return setSymbolDesc(it, key, D);
  } return dP$1(it, key, D);
};
var $defineProperties = function defineProperties(it, P){
  _anObject(it);
  var keys = _enumKeys(P = _toIobject(P))
    , i    = 0
    , l = keys.length
    , key;
  while(l > i)$defineProperty(it, key = keys[i++], P[key]);
  return it;
};
var $create = function create(it, P){
  return P === undefined ? _objectCreate(it) : $defineProperties(_objectCreate(it), P);
};
var $propertyIsEnumerable = function propertyIsEnumerable(key){
  var E = isEnum.call(this, key = _toPrimitive(key, true));
  if(this === ObjectProto$1 && _has(AllSymbols, key) && !_has(OPSymbols, key))return false;
  return E || !_has(this, key) || !_has(AllSymbols, key) || _has(this, HIDDEN) && this[HIDDEN][key] ? E : true;
};
var $getOwnPropertyDescriptor = function getOwnPropertyDescriptor(it, key){
  it  = _toIobject(it);
  key = _toPrimitive(key, true);
  if(it === ObjectProto$1 && _has(AllSymbols, key) && !_has(OPSymbols, key))return;
  var D = gOPD(it, key);
  if(D && _has(AllSymbols, key) && !(_has(it, HIDDEN) && it[HIDDEN][key]))D.enumerable = true;
  return D;
};
var $getOwnPropertyNames = function getOwnPropertyNames(it){
  var names  = gOPN(_toIobject(it))
    , result = []
    , i      = 0
    , key;
  while(names.length > i){
    if(!_has(AllSymbols, key = names[i++]) && key != HIDDEN && key != META)result.push(key);
  } return result;
};
var $getOwnPropertySymbols = function getOwnPropertySymbols(it){
  var IS_OP  = it === ObjectProto$1
    , names  = gOPN(IS_OP ? OPSymbols : _toIobject(it))
    , result = []
    , i      = 0
    , key;
  while(names.length > i){
    if(_has(AllSymbols, key = names[i++]) && (IS_OP ? _has(ObjectProto$1, key) : true))result.push(AllSymbols[key]);
  } return result;
};

// 19.4.1.1 Symbol([description])
if(!USE_NATIVE){
  $Symbol = function Symbol(){
    if(this instanceof $Symbol)throw TypeError('Symbol is not a constructor!');
    var tag = _uid(arguments.length > 0 ? arguments[0] : undefined);
    var $set = function(value){
      if(this === ObjectProto$1)$set.call(OPSymbols, value);
      if(_has(this, HIDDEN) && _has(this[HIDDEN], tag))this[HIDDEN][tag] = false;
      setSymbolDesc(this, tag, _propertyDesc(1, value));
    };
    if(_descriptors && setter)setSymbolDesc(ObjectProto$1, tag, {configurable: true, set: $set});
    return wrap(tag);
  };
  _redefine($Symbol[PROTOTYPE$2], 'toString', function toString(){
    return this._k;
  });

  _objectGopd.f = $getOwnPropertyDescriptor;
  _objectDp.f   = $defineProperty;
  _objectGopn.f = _objectGopnExt.f = $getOwnPropertyNames;
  _objectPie.f  = $propertyIsEnumerable;
  _objectGops.f = $getOwnPropertySymbols;

  if(_descriptors && !_library){
    _redefine(ObjectProto$1, 'propertyIsEnumerable', $propertyIsEnumerable, true);
  }

  _wksExt.f = function(name){
    return wrap(_wks(name));
  };
}

_export(_export.G + _export.W + _export.F * !USE_NATIVE, {Symbol: $Symbol});

for(var symbols = (
  // 19.4.2.2, 19.4.2.3, 19.4.2.4, 19.4.2.6, 19.4.2.8, 19.4.2.9, 19.4.2.10, 19.4.2.11, 19.4.2.12, 19.4.2.13, 19.4.2.14
  'hasInstance,isConcatSpreadable,iterator,match,replace,search,species,split,toPrimitive,toStringTag,unscopables'
).split(','), i$1 = 0; symbols.length > i$1; )_wks(symbols[i$1++]);

for(var symbols = _objectKeys(_wks.store), i$1 = 0; symbols.length > i$1; )_wksDefine(symbols[i$1++]);

_export(_export.S + _export.F * !USE_NATIVE, 'Symbol', {
  // 19.4.2.1 Symbol.for(key)
  'for': function(key){
    return _has(SymbolRegistry, key += '')
      ? SymbolRegistry[key]
      : SymbolRegistry[key] = $Symbol(key);
  },
  // 19.4.2.5 Symbol.keyFor(sym)
  keyFor: function keyFor(key){
    if(isSymbol(key))return _keyof(SymbolRegistry, key);
    throw TypeError(key + ' is not a symbol!');
  },
  useSetter: function(){ setter = true; },
  useSimple: function(){ setter = false; }
});

_export(_export.S + _export.F * !USE_NATIVE, 'Object', {
  // 19.1.2.2 Object.create(O [, Properties])
  create: $create,
  // 19.1.2.4 Object.defineProperty(O, P, Attributes)
  defineProperty: $defineProperty,
  // 19.1.2.3 Object.defineProperties(O, Properties)
  defineProperties: $defineProperties,
  // 19.1.2.6 Object.getOwnPropertyDescriptor(O, P)
  getOwnPropertyDescriptor: $getOwnPropertyDescriptor,
  // 19.1.2.7 Object.getOwnPropertyNames(O)
  getOwnPropertyNames: $getOwnPropertyNames,
  // 19.1.2.8 Object.getOwnPropertySymbols(O)
  getOwnPropertySymbols: $getOwnPropertySymbols
});

// 24.3.2 JSON.stringify(value [, replacer [, space]])
$JSON && _export(_export.S + _export.F * (!USE_NATIVE || _fails(function(){
  var S = $Symbol();
  // MS Edge converts symbol values to JSON as {}
  // WebKit converts symbol values to JSON as null
  // V8 throws on boxed symbols
  return _stringify([S]) != '[null]' || _stringify({a: S}) != '{}' || _stringify(Object(S)) != '{}';
})), 'JSON', {
  stringify: function stringify(it){
    if(it === undefined || isSymbol(it))return; // IE8 returns string on undefined
    var args = [it]
      , i    = 1
      , replacer, $replacer;
    while(arguments.length > i)args.push(arguments[i++]);
    replacer = args[1];
    if(typeof replacer == 'function')$replacer = replacer;
    if($replacer || !_isArray(replacer))replacer = function(key, value){
      if($replacer)value = $replacer.call(this, key, value);
      if(!isSymbol(value))return value;
    };
    args[1] = replacer;
    return _stringify.apply($JSON, args);
  }
});

// 19.4.3.4 Symbol.prototype[@@toPrimitive](hint)
$Symbol[PROTOTYPE$2][TO_PRIMITIVE] || _hide($Symbol[PROTOTYPE$2], TO_PRIMITIVE, $Symbol[PROTOTYPE$2].valueOf);
// 19.4.3.5 Symbol.prototype[@@toStringTag]
_setToStringTag($Symbol, 'Symbol');
// 20.2.1.9 Math[@@toStringTag]
_setToStringTag(Math, 'Math', true);
// 24.3.3 JSON[@@toStringTag]
_setToStringTag(_global.JSON, 'JSON', true);

_wksDefine('asyncIterator');

_wksDefine('observable');

var symbol$2 = _core.Symbol;

var symbol = createCommonjsModule$$1(function (module) {
module.exports = { "default": symbol$2, __esModule: true };
});

unwrapExports$$1(symbol);

var _typeof_1 = createCommonjsModule$$1(function (module, exports) {
exports.__esModule = true;



var _iterator2 = _interopRequireDefault(iterator);



var _symbol2 = _interopRequireDefault(symbol);

var _typeof = typeof _symbol2.default === "function" && typeof _iterator2.default === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof _symbol2.default === "function" && obj.constructor === _symbol2.default && obj !== _symbol2.default.prototype ? "symbol" : typeof obj; };

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = typeof _symbol2.default === "function" && _typeof(_iterator2.default) === "symbol" ? function (obj) {
  return typeof obj === "undefined" ? "undefined" : _typeof(obj);
} : function (obj) {
  return obj && typeof _symbol2.default === "function" && obj.constructor === _symbol2.default && obj !== _symbol2.default.prototype ? "symbol" : typeof obj === "undefined" ? "undefined" : _typeof(obj);
};
});

unwrapExports$$1(_typeof_1);

var possibleConstructorReturn = createCommonjsModule$$1(function (module, exports) {
exports.__esModule = true;



var _typeof3 = _interopRequireDefault(_typeof_1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = function (self, call) {
  if (!self) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }

  return call && ((typeof call === "undefined" ? "undefined" : (0, _typeof3.default)(call)) === "object" || typeof call === "function") ? call : self;
};
});

var _possibleConstructorReturn = unwrapExports$$1(possibleConstructorReturn);

// Works with __proto__ only. Old v8 can't work with null proto objects.
/* eslint-disable no-proto */

var check$1 = function(O, proto){
  _anObject(O);
  if(!_isObject(proto) && proto !== null)throw TypeError(proto + ": can't set as prototype!");
};
var _setProto = {
  set: Object.setPrototypeOf || ('__proto__' in {} ? // eslint-disable-line
    function(test, buggy, set){
      try {
        set = _ctx(Function.call, _objectGopd.f(Object.prototype, '__proto__').set, 2);
        set(test, []);
        buggy = !(test instanceof Array);
      } catch(e){ buggy = true; }
      return function setPrototypeOf(O, proto){
        check$1(O, proto);
        if(buggy)O.__proto__ = proto;
        else set(O, proto);
        return O;
      };
    }({}, false) : undefined),
  check: check$1
};

// 19.1.3.19 Object.setPrototypeOf(O, proto)

_export(_export.S, 'Object', {setPrototypeOf: _setProto.set});

var setPrototypeOf$2 = _core.Object.setPrototypeOf;

var setPrototypeOf = createCommonjsModule$$1(function (module) {
module.exports = { "default": setPrototypeOf$2, __esModule: true };
});

unwrapExports$$1(setPrototypeOf);

// 19.1.2.2 / 15.2.3.5 Object.create(O [, Properties])
_export(_export.S, 'Object', {create: _objectCreate});

var $Object$1 = _core.Object;
var create$2 = function create(P, D){
  return $Object$1.create(P, D);
};

var create = createCommonjsModule$$1(function (module) {
module.exports = { "default": create$2, __esModule: true };
});

unwrapExports$$1(create);

var inherits = createCommonjsModule$$1(function (module, exports) {
exports.__esModule = true;



var _setPrototypeOf2 = _interopRequireDefault(setPrototypeOf);



var _create2 = _interopRequireDefault(create);



var _typeof3 = _interopRequireDefault(_typeof_1);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = function (subClass, superClass) {
  if (typeof superClass !== "function" && superClass !== null) {
    throw new TypeError("Super expression must either be null or a function, not " + (typeof superClass === "undefined" ? "undefined" : (0, _typeof3.default)(superClass)));
  }

  subClass.prototype = (0, _create2.default)(superClass && superClass.prototype, {
    constructor: {
      value: subClass,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
  if (superClass) _setPrototypeOf2.default ? (0, _setPrototypeOf2.default)(subClass, superClass) : subClass.__proto__ = superClass;
};
});

var _inherits = unwrapExports$$1(inherits);

var bitset = createCommonjsModule$$1(function (module, exports) {
/**
 * @license BitSet.js v5.0.3 4/3/2018
 * http://www.xarg.org/2014/03/javascript-bit-array/
 *
 * Copyright (c) 2016, Robert Eisele (robert@xarg.org)
 * Dual licensed under the MIT or GPL Version 2 licenses.
 **/
(function(root) {

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

    v -= ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4) & 0xF0F0F0F) * 0x1010101) >>> 24);
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

          if (a <= 0)
            break;

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
    'set': function(ndx, value) {

      ndx |= 0;

      scale(this, ndx);

      if (value === undefined || value) {
        this['data'][ndx >>> WORD_LOG] |= (1 << ndx);
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
     * @returns {number|null} The binary flag
     */
    'get': function(ndx) {

      ndx |= 0;

      var d = this['data'];
      var n = ndx >>> WORD_LOG;

      if (n > d.length) {
        return this['_'] & 1;
      }
      return (d[n] >>> ndx) & 1;
    },
    /**
     * Creates the bitwise NOT of a set. The result is stored in-place.
     *
     * Ex:
     * bs1 = new BitSet(10);
     *
     * bs1.not();
     *
     * @returns {BitSet} this
     */
    'not': function() { // invert()

      var t = this['clone']();
      var d = t['data'];
      for (var i = 0; i < d.length; i++) {
        d[i] = ~d[i];
      }

      t['_'] = ~t['_'];

      return t;
    },
    /**
     * Creates the bitwise AND of two sets. The result is stored in-place.
     *
     * Ex:
     * bs1 = new BitSet(10);
     * bs2 = new BitSet(10);
     *
     * bs1.and(bs2);
     *
     * @param {BitSet} value A bitset object
     * @returns {BitSet} this
     */
    'and': function(value) {// intersection

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
     * Creates the bitwise OR of two sets. The result is stored in-place.
     *
     * Ex:
     * bs1 = new BitSet(10);
     * bs2 = new BitSet(10);
     *
     * bs1.or(bs2);
     *
     * @param {BitSet} val A bitset object
     * @returns {BitSet} this
     */
    'or': function(val) { // union

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
     * Creates the bitwise XOR of two sets. The result is stored in-place.
     *
     * Ex:
     * bs1 = new BitSet(10);
     * bs2 = new BitSet(10);
     *
     * bs1.xor(bs2);
     *
     * @param {BitSet} val A bitset object
     * @returns {BitSet} this
     */
    'xor': function(val) { // symmetric difference

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
     * Creates the bitwise AND NOT (not confuse with NAND!) of two sets. The result is stored in-place.
     *
     * Ex:
     * bs1 = new BitSet(10);
     * bs2 = new BitSet(10);
     *
     * bs1.notAnd(bs2);
     *
     * @param {BitSet} val A bitset object
     * @returns {BitSet} this
     */
    'andNot': function(val) { // difference

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
    'flip': function(from, to) {

      if (from === undefined) {

        var d = this['data'];
        for (var i = 0; i < d.length; i++) {
          d[i] = ~d[i];
        }

        this['_'] = ~this['_'];

      } else if (to === undefined) {

        scale(this, from);

        this['data'][from >>> WORD_LOG] ^= (1 << from);

      } else if (0 <= from && from <= to) {

        scale(this, to);

        for (var i = from; i <= to; i++) {
          this['data'][i >>> WORD_LOG] ^= (1 << i);
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
     * bs1.clar(3,10); // Clear a bit range
     *
     * @param {number=} from The start index of the range to be cleared
     * @param {number=} to The end index of the range to be cleared
     * @returns {BitSet} this
     */
    'clear': function(from, to) {

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
     * @returns {BitSet|Object} A new smaller bitset object, containing the extracted range
     */
    'slice': function(from, to) {

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
    'setRange': function(from, to, value) {

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
    'clone': function() {

      var im = Object.create(BitSet.prototype);
      im['data'] = this['data'].slice();
      im['_'] = this['_'];

      return im;
    },
    /**
     * Gets a list of set bits
     *
     * @returns {Array|number}
     */
    'toArray': Math['clz32'] ?
            function() {

              var ret = [];
              var data = this['data'];

              for (var i = data.length - 1; i >= 0; i--) {

                var num = data[i];

                while (num !== 0) {
                  var t = 31 - Math['clz32'](num);
                  num ^= 1 << t;
                  ret.unshift((i * WORD_LENGTH) + t);
                }
              }

              if (this['_'] !== 0)
                ret.push(Infinity);

              return ret;
            } :
            function() {

              var ret = [];
              var data = this['data'];

              for (var i = 0; i < data.length; i++) {

                var num = data[i];

                while (num !== 0) {
                  var t = num & -num;
                  num ^= t;
                  ret.push((i * WORD_LENGTH) + popCount(t - 1));
                }
              }

              if (this['_'] !== 0)
                ret.push(Infinity);

              return ret;
            },
    /**
     * Overrides the toString method to get a binary representation of the BitSet
     *
     * @param {number=} base
     * @returns string A binary string
     */
    'toString': function(base) {

      var data = this['data'];

      if (!base)
        base = 2;

      // If base is power of two
      if ((base & (base - 1)) === 0 && base < 36) {

        var ret = '';
        var len = 2 + Math.log(4294967295/*Math.pow(2, WORD_LENGTH)-1*/) / Math.log(base) | 0;

        for (var i = data.length - 1; i >= 0; i--) {

          var cur = data[i];

          // Make the number unsigned
          if (cur < 0)
            cur += 4294967296 /*Math.pow(2, WORD_LENGTH)*/;

          var tmp = cur.toString(base);

          if (ret !== '') {
            // Fill small positive numbers with leading zeros. The +1 for array creation is added outside already
            ret += '0'.repeat(len - tmp.length - 1);
          }
          ret += tmp;
        }

        if (this['_'] === 0) {

          ret = ret.replace(/^0+/, '');

          if (ret === '')
            ret = '0';
          return ret;

        } else {
          // Pad the string with ones
          ret = '1111' + ret;
          return ret.replace(/^1+/, '...1111');
        }

      } else {

        if ((2 > base || base > 36))
          throw SyntaxError('Invalid base');

        var ret = [];
        var arr = [];

        // Copy every single bit to a new array
        for (var i = data.length; i--; ) {

          for (var j = WORD_LENGTH; j--; ) {

            arr.push(data[i] >>> j & 1);
          }
        }

        do {
          ret.unshift(divide(arr, base).toString(base));
        } while (!arr.every(function(x) {
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
    'isEmpty': function() {

      if (this['_'] !== 0)
        return false;

      var d = this['data'];

      for (var i = d.length - 1; i >= 0; i--) {
        if (d[i] !== 0)
          return false;
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
    'cardinality': function() {

      if (this['_'] !== 0) {
        return Infinity;
      }

      var s = 0;
      var d = this['data'];
      for (var i = 0; i < d.length; i++) {
        var n = d[i];
        if (n !== 0)
          s += popCount(n);
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
    'msb': Math['clz32'] ?
            function() {

              if (this['_'] !== 0) {
                return Infinity;
              }

              var data = this['data'];

              for (var i = data.length; i-- > 0; ) {

                var c = Math['clz32'](data[i]);

                if (c !== WORD_LENGTH) {
                  return (i * WORD_LENGTH) + WORD_LENGTH - 1 - c;
                }
              }
              return Infinity;
            } :
            function() {

              if (this['_'] !== 0) {
                return Infinity;
              }

              var data = this['data'];

              for (var i = data.length; i-- > 0; ) {

                var v = data[i];
                var c = 0;

                if (v) {

                  for (; (v >>>= 1) > 0; c++) {
                  }
                  return (i * WORD_LENGTH) + c;
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
    'ntz': function() {

      var data = this['data'];

      for (var j = 0; j < data.length; j++) {
        var v = data[j];

        if (v !== 0) {

          v = (v ^ (v - 1)) >>> 1; // Set v's trailing 0s to 1s and zero rest

          return (j * WORD_LENGTH) + popCount(v);
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
    'lsb': function() {

      var data = this['data'];

      for (var i = 0; i < data.length; i++) {

        var v = data[i];
        var c = 0;

        if (v) {

          var bit = (v & -v);

          for (; (bit >>>= 1); c++) {

          }
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
     * @returns {boolean} Whether the two BitSets are similar
     */
    'equals': function(val) {

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
        if (t[i] !== p[i])
          return false;
      }

      for (i = tl; i > pl; i--) {
        if (t[i] !== p_)
          return false;
      }

      for (i = pl; i > tl; i--) {
        if (p[i] !== t_)
          return false;
      }
      return true;
    }
  };

  BitSet['fromBinaryString'] = function(str) {

    return new BitSet('0b' + str);
  };

  BitSet['fromHexString'] = function(str) {

    return new BitSet('0x' + str);
  };

  BitSet['Random'] = function(n) {

    if (n === undefined || n < 0) {
      n = WORD_LENGTH;
    }

    var m = n % WORD_LENGTH;

    // Create an array, large enough to hold the random bits
    var t = [];
    var len = Math.ceil(n / WORD_LENGTH);

    // Create an bitset instance
    var s = Object.create(BitSet.prototype);

    // Fill the vector with random data, uniformally distributed
    for (var i = 0; i < len; i++) {
      t.push(Math.random() * 4294967296 | 0);
    }

    // Mask out unwanted bits
    if (m > 0) {
      t[len - 1] &= (1 << m) - 1;
    }

    s['data'] = t;
    s['_'] = 0;
    return s;
  };

  if (typeof undefined === 'function' && undefined['amd']) {
    undefined([], function() {
      return BitSet;
    });
  } else {
    Object.defineProperty(exports, "__esModule", {'value': true});
    BitSet['default'] = BitSet;
    BitSet['BitSet'] = BitSet;
    module['exports'] = BitSet;
  }

})(commonjsGlobal$$1);
});

var BitSet = unwrapExports$$1(bitset);

/** @module bitMap */

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
  var first = bitMap.ntz();
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

/** @module BitMapTree */

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
var BitMapTree =

/**
 * Creates a BitMapTree, this is an abstract class.
 * It is not meant to by directly instantiated.
 */
function BitMapTree(blockSize, shrink, begin, depth, bitMap) {
  _classCallCheck(this, BitMapTree);

  this.blockSize = blockSize;
  this.shrink = shrink;
  this.begin = begin;
  this.depth = depth;
  this.bitMap = bitMap || createBitMap(blockSize);
};



/**
 * Class representing a Leaf of the recursive bitmap tree.
 * This represents the base case of the lazy recursive bitmap tree.
 */

var Leaf = function (_BitMapTree) {
  _inherits(Leaf, _BitMapTree);

  /**
   * Creates a Leaf
   */
  function Leaf(blockSize, shrink, begin, bitMap) {
    _classCallCheck(this, Leaf);

    return _possibleConstructorReturn(this, (Leaf.__proto__ || _Object$getPrototypeOf(Leaf)).call(this, blockSize, shrink, begin, 0, bitMap));
  }

  /**
   * Allocates a counter and sets the corresponding bit for the bitmap.
   * It will lazily grow parents.
   */


  _createClass(Leaf, [{
    key: 'allocate',
    value: function allocate(counter, callback, snapshot) {
      var index = void 0;
      if (counter == null) {
        index = firstUnset(this.bitMap);
      } else {
        index = counter - this.begin;
      }
      if (index !== null && index < this.blockSize) {
        if (!isSet(this.bitMap, index)) {
          var bitMapNew = void 0;
          var treeNew = void 0;
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
        var _treeNew = new Node(this.blockSize, this.shrink, this.begin, this.depth + 1);
        if (snapshot) {
          snapshot.add(_treeNew);
          snapshot.add(_treeNew.bitMap);
        }
        _treeNew.bitMapTrees[0] = this;
        if (allSet(this.bitMap)) {
          setBit(_treeNew.bitMap, 0);
        }
        _treeNew.allocate(counter, callback, snapshot);
      }
    }

    /**
     * Deallocates a counter and unsets the corresponding bit for the bitmap.
     */

  }, {
    key: 'deallocate',
    value: function deallocate(counter, callback, snapshot) {
      var index = counter - this.begin;
      if (index >= 0 && index < this.blockSize) {
        if (isSet(this.bitMap, index)) {
          var bitMapNew = void 0;
          var treeNew = void 0;
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

  }, {
    key: 'check',
    value: function check(counter, callback) {
      var index = counter - this.begin;
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
  }]);

  return Leaf;
}(BitMapTree);



/**
 * Class representing a Node of the recursive bitmap tree.
 */

var Node = function (_BitMapTree2) {
  _inherits(Node, _BitMapTree2);

  /**
   * Creates a Node
   */
  function Node(blockSize, shrink, begin, depth, bitMap, bitMapTrees) {
    _classCallCheck(this, Node);

    var _this2 = _possibleConstructorReturn(this, (Node.__proto__ || _Object$getPrototypeOf(Node)).call(this, blockSize, shrink, begin, depth, bitMap));

    _this2.bitMapTrees = bitMapTrees || [];
    return _this2;
  }

  /**
   * Allocates a counter by allocating the corresponding child.
   * Passes a continuation to the child allocate that will
   * set the current bitmap if the child bitmap is now all set.
   * It will also lazily create the children or parents as necessary.
   */


  _createClass(Node, [{
    key: 'allocate',
    value: function allocate(counter, callback, snapshot) {
      var _this3 = this;

      var index = void 0;
      if (counter == null) {
        index = firstUnset(this.bitMap);
      } else {
        index = Math.floor((counter - this.begin) / Math.pow(this.blockSize, this.depth));
      }
      if (index != null && this.bitMapTrees[index]) {
        var index_ = index; // fix the non-null value
        this.bitMapTrees[index].allocate(counter, function (_ref) {
          var counter = _ref.counter,
              changed = _ref.changed,
              bitMapChild = _ref.bitMap,
              treeChild = _ref.tree;

          var bitMapNew = _this3.bitMap;
          var treeNew = _this3;
          if (changed) {
            if (!snapshot && allSet(bitMapChild)) {
              setBit(bitMapNew, index_);
            } else if (snapshot && snapshot.has(_this3)) {
              if (allSet(bitMapChild)) {
                if (!snapshot.has(_this3.bitMap)) {
                  bitMapNew = _this3.bitMap.clone();
                  snapshot.add(bitMapNew);
                  _this3.bitMap = bitMapNew;
                }
                setBit(bitMapNew, index_);
              }
              treeNew.bitMapTrees[index_] = treeChild;
            } else if (snapshot) {
              if (allSet(bitMapChild)) {
                bitMapNew = _this3.bitMap.clone();
                snapshot.add(bitMapNew);
                setBit(bitMapNew, index_);
              }
              var bitMapTreesNew = _this3.bitMapTrees.slice();
              bitMapTreesNew[index_] = treeChild;
              treeNew = new Node(_this3.blockSize, _this3.shrink, _this3.begin, _this3.depth, bitMapNew, bitMapTreesNew);
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
        var treeNew = new Node(this.blockSize, this.shrink, this.begin, this.depth + 1);
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
        var beginNew = this.begin + index * Math.pow(this.blockSize, this.depth);
        var depthNew = this.depth - 1;
        var treeChild = void 0;
        if (depthNew === 0) {
          treeChild = new Leaf(this.blockSize, this.shrink, beginNew);
        } else {
          treeChild = new Node(this.blockSize, this.shrink, beginNew, depthNew);
        }
        if (snapshot) {
          snapshot.add(treeChild);
          snapshot.add(treeChild.bitMap);
        }
        var _treeNew2 = void 0;
        if (!snapshot || snapshot.has(this)) {
          this.bitMapTrees[index] = treeChild;
          _treeNew2 = this;
        } else {
          var bitMapTreesNew = this.bitMapTrees.slice();
          bitMapTreesNew[index] = treeChild;
          _treeNew2 = new Node(this.blockSize, this.shrink, this.begin, this.depth, this.bitMap, bitMapTreesNew);
          snapshot.add(_treeNew2);
        }
        var _index_ = index; // fix the non-null value
        treeChild.allocate(counter, function (_ref2) {
          var counter = _ref2.counter,
              changed = _ref2.changed,
              bitMapChild = _ref2.bitMap,
              treeChild = _ref2.tree;

          var bitMapNew = _this3.bitMap;
          if (bitMapChild && allSet(bitMapChild)) {
            if (snapshot && !snapshot.has(_this3.bitMap)) {
              bitMapNew = _this3.bitMap.clone();
              snapshot.add(bitMapNew);
              _treeNew2.bitMap = bitMapNew;
            }
            setBit(bitMapNew, _index_);
          }
          callback({
            counter: counter,
            changed: changed,
            bitMap: bitMapNew,
            tree: _treeNew2
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

  }, {
    key: 'deallocate',
    value: function deallocate(counter, callback, snapshot) {
      var _this4 = this;

      var index = Math.floor((counter - this.begin) / Math.pow(this.blockSize, this.depth));
      if (this.bitMapTrees[index]) {
        var allSetPrior = allSet(this.bitMapTrees[index].bitMap);
        this.bitMapTrees[index].deallocate(counter, function (_ref3) {
          var exists = _ref3.exists,
              changed = _ref3.changed,
              bitMapChild = _ref3.bitMap,
              treeChild = _ref3.tree;

          var bitMapNew = _this4.bitMap;
          var treeNew = _this4;
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
              } else if (snapshot && snapshot.has(_this4)) {
                if (allSetPrior) {
                  if (!snapshot.has(_this4.bitMap)) {
                    bitMapNew = _this4.bitMap.clone();
                    snapshot.add(bitMapNew);
                    _this4.bitMap = bitMapNew;
                  }
                  unsetBit(bitMapNew, index);
                }
                treeNew.bitMapTrees[index] = treeChild;
              } else if (snapshot) {
                if (allSetPrior) {
                  bitMapNew = _this4.bitMap.clone();
                  snapshot.add(bitMapNew);
                  unsetBit(bitMapNew, index);
                }
                var bitMapTreesNew = _this4.bitMapTrees.slice();
                bitMapTreesNew[index] = treeChild;
                treeNew = new Node(_this4.blockSize, _this4.shrink, _this4.begin, _this4.depth, bitMapNew, bitMapTreesNew);
                snapshot.add(treeNew);
              }
              if (_this4.shrink && (treeChild instanceof Leaf && allUnset(bitMapChild, _this4.blockSize) || treeChild instanceof Node && _Object$keys(treeChild.bitMapTrees).length === 0)) {
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

  }, {
    key: 'check',
    value: function check(counter, callback) {
      var index = Math.floor((counter - this.begin) / Math.pow(this.blockSize, this.depth));
      if (this.bitMapTrees[index]) {
        this.bitMapTrees[index].check(counter, function (set) {
          callback(set);
        });
      } else {
        callback(null);
      }
    }
  }]);

  return Node;
}(BitMapTree);

/** @module Counter */

/**
 * Class representing allocatable and deallocatable counters.
 * Counters are allocated in sequential manner, this applies to deallocated counters.
 * Once a counter is deallocated, it will be reused on the next allocation.
 * This is a mutable counter, which doesn't use snapshots.
 */

var Counter = function () {

  /**
   * Creates a counter instance.
   * @throws {RangeError} - If blockSize is not a multiple of 32.
   */
  function Counter() {
    var begin = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
    var blockSize = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 32;
    var shrink = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;
    var tree = arguments[3];

    _classCallCheck(this, Counter);

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


  _createClass(Counter, [{
    key: 'allocate',
    value: function allocate$$1(counter) {
      if (counter != null) {
        if (counter < this._begin) {
          throw new RangeError('counter needs to be greater or equal to the beginning offset');
        }
        counter = counter - this._begin;
      }

      var _allocate2 = allocate(this._tree, counter),
          _allocate3 = _slicedToArray(_allocate2, 3),
          counterAssigned = _allocate3[0],
          changed = _allocate3[1],
          treeNew = _allocate3[2];

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

  }, {
    key: 'deallocate',
    value: function deallocate$$1(counter) {
      var _deallocate2 = deallocate(this._tree, counter - this._begin),
          _deallocate3 = _slicedToArray(_deallocate2, 2),
          changed = _deallocate3[0],
          treeNew = _deallocate3[1];

      this._tree = treeNew;
      return changed;
    }

    /**
     * Checks if a number has been allocated or not.
     */

  }, {
    key: 'check',
    value: function check$$1(counter) {
      return check(this._tree, counter - this._begin);
    }
  }]);

  return Counter;
}();

var _redefineAll = function(target, src, safe){
  for(var key in src){
    if(safe && target[key])target[key] = src[key];
    else _hide(target, key, src[key]);
  } return target;
};

var _anInstance = function(it, Constructor, name, forbiddenField){
  if(!(it instanceof Constructor) || (forbiddenField !== undefined && forbiddenField in it)){
    throw TypeError(name + ': incorrect invocation!');
  } return it;
};

// call something on iterator step with safe closing on error

var _iterCall = function(iterator, fn, value, entries){
  try {
    return entries ? fn(_anObject(value)[0], value[1]) : fn(value);
  // 7.4.6 IteratorClose(iterator, completion)
  } catch(e){
    var ret = iterator['return'];
    if(ret !== undefined)_anObject(ret.call(iterator));
    throw e;
  }
};

// check on default Array iterator
var ITERATOR$3   = _wks('iterator');
var ArrayProto = Array.prototype;

var _isArrayIter = function(it){
  return it !== undefined && (_iterators.Array === it || ArrayProto[ITERATOR$3] === it);
};

var _forOf = createCommonjsModule$$1(function (module) {
var BREAK       = {}
  , RETURN      = {};
var exports = module.exports = function(iterable, entries, fn, that, ITERATOR){
  var iterFn = ITERATOR ? function(){ return iterable; } : core_getIteratorMethod(iterable)
    , f      = _ctx(fn, that, entries ? 2 : 1)
    , index  = 0
    , length, step, iterator, result;
  if(typeof iterFn != 'function')throw TypeError(iterable + ' is not iterable!');
  // fast case for arrays with default iterator
  if(_isArrayIter(iterFn))for(length = _toLength(iterable.length); length > index; index++){
    result = entries ? f(_anObject(step = iterable[index])[0], step[1]) : f(iterable[index]);
    if(result === BREAK || result === RETURN)return result;
  } else for(iterator = iterFn.call(iterable); !(step = iterator.next()).done; ){
    result = _iterCall(iterator, f, step.value, entries);
    if(result === BREAK || result === RETURN)return result;
  }
};
exports.BREAK  = BREAK;
exports.RETURN = RETURN;
});

var SPECIES  = _wks('species');

var _arraySpeciesConstructor = function(original){
  var C;
  if(_isArray(original)){
    C = original.constructor;
    // cross-realm fallback
    if(typeof C == 'function' && (C === Array || _isArray(C.prototype)))C = undefined;
    if(_isObject(C)){
      C = C[SPECIES];
      if(C === null)C = undefined;
    }
  } return C === undefined ? Array : C;
};

// 9.4.2.3 ArraySpeciesCreate(originalArray, length)


var _arraySpeciesCreate = function(original, length){
  return new (_arraySpeciesConstructor(original))(length);
};

// 0 -> Array#forEach
// 1 -> Array#map
// 2 -> Array#filter
// 3 -> Array#some
// 4 -> Array#every
// 5 -> Array#find
// 6 -> Array#findIndex

var _arrayMethods = function(TYPE, $create){
  var IS_MAP        = TYPE == 1
    , IS_FILTER     = TYPE == 2
    , IS_SOME       = TYPE == 3
    , IS_EVERY      = TYPE == 4
    , IS_FIND_INDEX = TYPE == 6
    , NO_HOLES      = TYPE == 5 || IS_FIND_INDEX
    , create        = $create || _arraySpeciesCreate;
  return function($this, callbackfn, that){
    var O      = _toObject($this)
      , self   = _iobject(O)
      , f      = _ctx(callbackfn, that, 3)
      , length = _toLength(self.length)
      , index  = 0
      , result = IS_MAP ? create($this, length) : IS_FILTER ? create($this, 0) : undefined
      , val, res;
    for(;length > index; index++)if(NO_HOLES || index in self){
      val = self[index];
      res = f(val, index, O);
      if(TYPE){
        if(IS_MAP)result[index] = res;            // map
        else if(res)switch(TYPE){
          case 3: return true;                    // some
          case 5: return val;                     // find
          case 6: return index;                   // findIndex
          case 2: result.push(val);               // filter
        } else if(IS_EVERY)return false;          // every
      }
    }
    return IS_FIND_INDEX ? -1 : IS_SOME || IS_EVERY ? IS_EVERY : result;
  };
};

var getWeak           = _meta.getWeak;
var arrayFind         = _arrayMethods(5);
var arrayFindIndex    = _arrayMethods(6);
var id$1                = 0;

// fallback for uncaught frozen keys
var uncaughtFrozenStore = function(that){
  return that._l || (that._l = new UncaughtFrozenStore);
};
var UncaughtFrozenStore = function(){
  this.a = [];
};
var findUncaughtFrozen = function(store, key){
  return arrayFind(store.a, function(it){
    return it[0] === key;
  });
};
UncaughtFrozenStore.prototype = {
  get: function(key){
    var entry = findUncaughtFrozen(this, key);
    if(entry)return entry[1];
  },
  has: function(key){
    return !!findUncaughtFrozen(this, key);
  },
  set: function(key, value){
    var entry = findUncaughtFrozen(this, key);
    if(entry)entry[1] = value;
    else this.a.push([key, value]);
  },
  'delete': function(key){
    var index = arrayFindIndex(this.a, function(it){
      return it[0] === key;
    });
    if(~index)this.a.splice(index, 1);
    return !!~index;
  }
};

var _collectionWeak = {
  getConstructor: function(wrapper, NAME, IS_MAP, ADDER){
    var C = wrapper(function(that, iterable){
      _anInstance(that, C, NAME, '_i');
      that._i = id$1++;      // collection id
      that._l = undefined; // leak store for uncaught frozen objects
      if(iterable != undefined)_forOf(iterable, IS_MAP, that[ADDER], that);
    });
    _redefineAll(C.prototype, {
      // 23.3.3.2 WeakMap.prototype.delete(key)
      // 23.4.3.3 WeakSet.prototype.delete(value)
      'delete': function(key){
        if(!_isObject(key))return false;
        var data = getWeak(key);
        if(data === true)return uncaughtFrozenStore(this)['delete'](key);
        return data && _has(data, this._i) && delete data[this._i];
      },
      // 23.3.3.4 WeakMap.prototype.has(key)
      // 23.4.3.4 WeakSet.prototype.has(value)
      has: function has(key){
        if(!_isObject(key))return false;
        var data = getWeak(key);
        if(data === true)return uncaughtFrozenStore(this).has(key);
        return data && _has(data, this._i);
      }
    });
    return C;
  },
  def: function(that, key, value){
    var data = getWeak(_anObject(key), true);
    if(data === true)uncaughtFrozenStore(that).set(key, value);
    else data[that._i] = value;
    return that;
  },
  ufstore: uncaughtFrozenStore
};

var dP$2             = _objectDp.f;
var each           = _arrayMethods(0);

var _collection = function(NAME, wrapper, methods, common, IS_MAP, IS_WEAK){
  var Base  = _global[NAME]
    , C     = Base
    , ADDER = IS_MAP ? 'set' : 'add'
    , proto = C && C.prototype
    , O     = {};
  if(!_descriptors || typeof C != 'function' || !(IS_WEAK || proto.forEach && !_fails(function(){
    new C().entries().next();
  }))){
    // create collection constructor
    C = common.getConstructor(wrapper, NAME, IS_MAP, ADDER);
    _redefineAll(C.prototype, methods);
    _meta.NEED = true;
  } else {
    C = wrapper(function(target, iterable){
      _anInstance(target, C, NAME, '_c');
      target._c = new Base;
      if(iterable != undefined)_forOf(iterable, IS_MAP, target[ADDER], target);
    });
    each('add,clear,delete,forEach,get,has,set,keys,values,entries,toJSON'.split(','),function(KEY){
      var IS_ADDER = KEY == 'add' || KEY == 'set';
      if(KEY in proto && !(IS_WEAK && KEY == 'clear'))_hide(C.prototype, KEY, function(a, b){
        _anInstance(this, C, KEY);
        if(!IS_ADDER && IS_WEAK && !_isObject(a))return KEY == 'get' ? undefined : false;
        var result = this._c[KEY](a === 0 ? 0 : a, b);
        return IS_ADDER ? this : result;
      });
    });
    if('size' in proto)dP$2(C.prototype, 'size', {
      get: function(){
        return this._c.size;
      }
    });
  }

  _setToStringTag(C, NAME);

  O[NAME] = C;
  _export(_export.G + _export.W + _export.F, O);

  if(!IS_WEAK)common.setStrong(C, NAME, IS_MAP);

  return C;
};

// 23.4 WeakSet Objects
_collection('WeakSet', function(get){
  return function WeakSet(){ return get(this, arguments.length > 0 ? arguments[0] : undefined); };
}, {
  // 23.4.3.1 WeakSet.prototype.add(value)
  add: function add(value){
    return _collectionWeak.def(this, value, true);
  }
}, _collectionWeak, false, true);

var weakSet$1 = _core.WeakSet;

var weakSet = createCommonjsModule$$1(function (module) {
module.exports = { "default": weakSet$1, __esModule: true };
});

var _WeakSet = unwrapExports$$1(weakSet);

/** @module CounterImmutable */

/**
 * Class representing allocatable and deallocatable counters.
 * Counters are allocated in sequential manner, this applies to deallocated counters.
 * Once a counter is deallocated, it will be reused on the next allocation.
 * This is an immutable counter. It will return a new counter on mutation.
 */
var CounterImmutable = function () {

  /**
   * Creates a counter instance.
   * @throws {RangeError} - If blockSize is not a multiple of 32.
   */
  function CounterImmutable() {
    var begin = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
    var blockSize = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 32;
    var shrink = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;
    var tree = arguments[3];

    _classCallCheck(this, CounterImmutable);

    if (blockSize % 32 !== 0) {
      throw new RangeError('Blocksize for Counter must be a multiple of 32');
    }
    this._begin = begin;
    this._blockSize = blockSize;
    this._shrink = shrink;
    this._tree = tree || new Leaf(blockSize, shrink, 0);
  }

  /**
   * Allocates a counter sequentially.
   * If a counter is specified, it will allocate it explicitly and return a
   * changed boolean.
   * @throws {RangeError} - If the explicitly allocated counter is out of bounds.
   */


  _createClass(CounterImmutable, [{
    key: 'allocate',
    value: function allocate$$1(counter) {
      if (counter != null) {
        if (counter < this._begin) {
          throw new RangeError('counter needs to be greater or equal to the beginning offset');
        }
        counter = counter - this._begin;
      }

      var _allocate2 = allocate(this._tree, counter, new _WeakSet()),
          _allocate3 = _slicedToArray(_allocate2, 3),
          counterAssigned = _allocate3[0],
          changed = _allocate3[1],
          treeNew = _allocate3[2];

      var counterNew = void 0;
      if (changed) {
        counterNew = new CounterImmutable(this._begin, this._blockSize, this._shrink, treeNew);
      } else {
        counterNew = this;
      }
      if (counter == null) {
        return [counterAssigned + this._begin, counterNew];
      } else {
        return [changed, counterNew];
      }
    }

    /**
     * Deallocates a number, it makes it available for reuse.
     */

  }, {
    key: 'deallocate',
    value: function deallocate$$1(counter) {
      var _deallocate2 = deallocate(this._tree, counter - this._begin, new _WeakSet()),
          _deallocate3 = _slicedToArray(_deallocate2, 2),
          changed = _deallocate3[0],
          treeNew = _deallocate3[1];

      var counterNew = void 0;
      if (changed) {
        counterNew = new CounterImmutable(this._begin, this._blockSize, this._shrink, treeNew);
      } else {
        counterNew = this;
      }
      return [changed, counterNew];
    }

    /**
     * Checks if a number has been allocated or not.
     */

  }, {
    key: 'check',
    value: function check$$1(counter) {
      return check(this._tree, counter - this._begin);
    }

    /**
     * Takes a callback that performs a set of operations.
     * And only returns the new immutable counter at the end of all operations.
     * This is useful if you want to batch up modfications to the counter.
     */

  }, {
    key: 'transaction',
    value: function transaction(callback) {
      var _this = this;

      var snapshot = new _WeakSet();
      var tree = this._tree;
      var changed = false;
      var counterTransaction = {
        allocate: function allocate$$1(counter) {
          if (counter != null) {
            if (counter < _this._begin) {
              throw new RangeError('counter needs to be greater or equal to the beginning offset');
            }
            counter = counter - _this._begin;
          }

          var _allocate4 = allocate(tree, counter, snapshot),
              _allocate5 = _slicedToArray(_allocate4, 3),
              counterAssigned = _allocate5[0],
              changed_ = _allocate5[1],
              treeNew = _allocate5[2];

          changed = changed_;
          tree = treeNew;
          if (counter == null) {
            return counterAssigned + _this._begin;
          } else {
            return changed;
          }
        },
        deallocate: function deallocate$$1(counter) {
          var _deallocate4 = deallocate(tree, counter - _this._begin, snapshot),
              _deallocate5 = _slicedToArray(_deallocate4, 2),
              changed_ = _deallocate5[0],
              treeNew = _deallocate5[1];

          changed = changed_;
          tree = treeNew;
          return changed;
        },
        check: function check$$1(counter) {
          return check(tree, counter - _this._begin);
        }
      };
      callback(counterTransaction);
      if (changed) {
        return new CounterImmutable(this._begin, this._blockSize, this._shrink, tree);
      } else {
        return this;
      }
    }
  }]);

  return CounterImmutable;
}();

exports['default'] = Counter;
exports.CounterImmutable = CounterImmutable;

Object.defineProperty(exports, '__esModule', { value: true });

})));
});

var Counter = unwrapExports(index_browser_umd$1);

/** @module Devices */

var MAJOR_BITSIZE = 12;
var MINOR_BITSIZE = 20;
var MAJOR_MAX = Math.pow(2, MAJOR_BITSIZE) - 1;
var MINOR_MAX = Math.pow(2, MINOR_BITSIZE) - 1;
var MAJOR_MIN = 0;
var MINOR_MIN = 0;

var DeviceError = function (_Error) {
  _inherits(DeviceError, _Error);

  function DeviceError(code, message) {
    _classCallCheck(this, DeviceError);

    var _this = _possibleConstructorReturn(this, (DeviceError.__proto__ || _Object$getPrototypeOf(DeviceError)).call(this, message));

    _this.code = code;
    return _this;
  }

  return DeviceError;
}(Error);

Object.defineProperty(DeviceError, 'ERROR_RANGE', { value: 1 });

Object.defineProperty(DeviceError, 'ERROR_CONFLICT', { value: 2 });

var DeviceManager = function () {
  function DeviceManager() {
    _classCallCheck(this, DeviceManager);

    this._chrCounterMaj = new Counter(MAJOR_MIN);
    this._chrDevices = new _Map();
  }

  _createClass(DeviceManager, [{
    key: 'getChr',
    value: function getChr(major, minor) {
      var devicesAndCounterMin = this._chrDevices.get(major);
      if (devicesAndCounterMin) {
        var _devicesAndCounterMin = _slicedToArray(devicesAndCounterMin, 1),
            devicesMin = _devicesAndCounterMin[0];

        return devicesMin.get(minor);
      }
      return;
    }
  }, {
    key: 'registerChr',
    value: function registerChr(device, major, minor) {
      var autoAllocMaj = void 0;
      var autoAllocMin = void 0;
      var counterMin = void 0;
      var devicesMin = void 0;
      try {
        if (major === undefined) {
          major = this._chrCounterMaj.allocate();
          autoAllocMaj = major;
        } else {
          var devicesCounterMin = this._chrDevices.get(major);
          if (!devicesCounterMin) {
            this._chrCounterMaj.allocate(major);
            autoAllocMaj = major;
          } else {
            var _devicesCounterMin = _slicedToArray(devicesCounterMin, 2);

            devicesMin = _devicesCounterMin[0];
            counterMin = _devicesCounterMin[1];
          }
        }
        if (!devicesMin || !counterMin) {
          counterMin = new Counter(MINOR_MIN);
          devicesMin = new _Map();
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
  }, {
    key: 'deregisterChr',
    value: function deregisterChr(major, minor) {
      var devicesCounterMin = this._chrDevices.get(major);
      if (devicesCounterMin) {
        var _devicesCounterMin2 = _slicedToArray(devicesCounterMin, 2),
            devicesMin = _devicesCounterMin2[0],
            counterMin = _devicesCounterMin2[1];

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
  }]);

  return DeviceManager;
}();

function mkDev(major, minor) {
  return major << MINOR_BITSIZE | minor;
}

function unmkDev(dev) {
  var major = dev >> MINOR_BITSIZE;
  var minor = dev & (1 << MINOR_BITSIZE) - 1;
  return [major, minor];
}

var getWeak = _meta.getWeak;







var arrayFind = _arrayMethods(5);
var arrayFindIndex = _arrayMethods(6);
var id$1 = 0;

// fallback for uncaught frozen keys
var uncaughtFrozenStore = function (that) {
  return that._l || (that._l = new UncaughtFrozenStore());
};
var UncaughtFrozenStore = function () {
  this.a = [];
};
var findUncaughtFrozen = function (store, key) {
  return arrayFind(store.a, function (it) {
    return it[0] === key;
  });
};
UncaughtFrozenStore.prototype = {
  get: function (key) {
    var entry = findUncaughtFrozen(this, key);
    if (entry) return entry[1];
  },
  has: function (key) {
    return !!findUncaughtFrozen(this, key);
  },
  set: function (key, value) {
    var entry = findUncaughtFrozen(this, key);
    if (entry) entry[1] = value;
    else this.a.push([key, value]);
  },
  'delete': function (key) {
    var index = arrayFindIndex(this.a, function (it) {
      return it[0] === key;
    });
    if (~index) this.a.splice(index, 1);
    return !!~index;
  }
};

var _collectionWeak = {
  getConstructor: function (wrapper, NAME, IS_MAP, ADDER) {
    var C = wrapper(function (that, iterable) {
      _anInstance(that, C, NAME, '_i');
      that._t = NAME;      // collection type
      that._i = id$1++;      // collection id
      that._l = undefined; // leak store for uncaught frozen objects
      if (iterable != undefined) _forOf(iterable, IS_MAP, that[ADDER], that);
    });
    _redefineAll(C.prototype, {
      // 23.3.3.2 WeakMap.prototype.delete(key)
      // 23.4.3.3 WeakSet.prototype.delete(value)
      'delete': function (key) {
        if (!_isObject(key)) return false;
        var data = getWeak(key);
        if (data === true) return uncaughtFrozenStore(_validateCollection(this, NAME))['delete'](key);
        return data && _has(data, this._i) && delete data[this._i];
      },
      // 23.3.3.4 WeakMap.prototype.has(key)
      // 23.4.3.4 WeakSet.prototype.has(value)
      has: function has(key) {
        if (!_isObject(key)) return false;
        var data = getWeak(key);
        if (data === true) return uncaughtFrozenStore(_validateCollection(this, NAME)).has(key);
        return data && _has(data, this._i);
      }
    });
    return C;
  },
  def: function (that, key, value) {
    var data = getWeak(_anObject(key), true);
    if (data === true) uncaughtFrozenStore(that).set(key, value);
    else data[that._i] = value;
    return that;
  },
  ufstore: uncaughtFrozenStore
};

var es6_weakMap = createCommonjsModule(function (module) {
var each = _arrayMethods(0);






var NATIVE_WEAK_MAP = _validateCollection;
var IS_IE11 = !_global.ActiveXObject && 'ActiveXObject' in _global;
var WEAK_MAP = 'WeakMap';
var getWeak = _meta.getWeak;
var isExtensible = Object.isExtensible;
var uncaughtFrozenStore = _collectionWeak.ufstore;
var InternalMap;

var wrapper = function (get) {
  return function WeakMap() {
    return get(this, arguments.length > 0 ? arguments[0] : undefined);
  };
};

var methods = {
  // 23.3.3.3 WeakMap.prototype.get(key)
  get: function get(key) {
    if (_isObject(key)) {
      var data = getWeak(key);
      if (data === true) return uncaughtFrozenStore(_validateCollection(this, WEAK_MAP)).get(key);
      return data ? data[this._i] : undefined;
    }
  },
  // 23.3.3.5 WeakMap.prototype.set(key, value)
  set: function set(key, value) {
    return _collectionWeak.def(_validateCollection(this, WEAK_MAP), key, value);
  }
};

// 23.3 WeakMap Objects
var $WeakMap = module.exports = _collection(WEAK_MAP, wrapper, methods, _collectionWeak, true, true);

// IE11 WeakMap frozen keys fix
if (NATIVE_WEAK_MAP && IS_IE11) {
  InternalMap = _collectionWeak.getConstructor(wrapper, WEAK_MAP);
  _objectAssign(InternalMap.prototype, methods);
  _meta.NEED = true;
  each(['delete', 'has', 'get', 'set'], function (key) {
    var proto = $WeakMap.prototype;
    var method = proto[key];
    _redefine(proto, key, function (a, b) {
      // store frozen objects on internal weakmap shim
      if (_isObject(a) && !isExtensible(a)) {
        if (!this._f) this._f = new InternalMap();
        var result = this._f[key](a, b);
        return key == 'set' ? this : result;
      // store all the rest on native weakmap
      } return method.call(this, a, b);
    });
  });
}
});

// https://tc39.github.io/proposal-setmap-offrom/#sec-weakmap.of
_setCollectionOf('WeakMap');

// https://tc39.github.io/proposal-setmap-offrom/#sec-weakmap.from
_setCollectionFrom('WeakMap');

var weakMap$1 = _core.WeakMap;

var weakMap = createCommonjsModule(function (module) {
module.exports = { "default": weakMap$1, __esModule: true };
});

var _WeakMap = unwrapExports(weakMap);

// 7.3.20 SpeciesConstructor(O, defaultConstructor)


var SPECIES$2 = _wks('species');
var _speciesConstructor = function (O, D) {
  var C = _anObject(O).constructor;
  var S;
  return C === undefined || (S = _anObject(C)[SPECIES$2]) == undefined ? D : _aFunction(S);
};

// fast apply, http://jsperf.lnkit.com/fast-apply/5
var _invoke = function (fn, args, that) {
  var un = that === undefined;
  switch (args.length) {
    case 0: return un ? fn()
                      : fn.call(that);
    case 1: return un ? fn(args[0])
                      : fn.call(that, args[0]);
    case 2: return un ? fn(args[0], args[1])
                      : fn.call(that, args[0], args[1]);
    case 3: return un ? fn(args[0], args[1], args[2])
                      : fn.call(that, args[0], args[1], args[2]);
    case 4: return un ? fn(args[0], args[1], args[2], args[3])
                      : fn.call(that, args[0], args[1], args[2], args[3]);
  } return fn.apply(that, args);
};

var process$2 = _global.process;
var setTask = _global.setImmediate;
var clearTask = _global.clearImmediate;
var MessageChannel = _global.MessageChannel;
var Dispatch = _global.Dispatch;
var counter = 0;
var queue$1 = {};
var ONREADYSTATECHANGE = 'onreadystatechange';
var defer;
var channel;
var port;
var run = function () {
  var id = +this;
  // eslint-disable-next-line no-prototype-builtins
  if (queue$1.hasOwnProperty(id)) {
    var fn = queue$1[id];
    delete queue$1[id];
    fn();
  }
};
var listener = function (event) {
  run.call(event.data);
};
// Node.js 0.9+ & IE10+ has setImmediate, otherwise:
if (!setTask || !clearTask) {
  setTask = function setImmediate(fn) {
    var args = [];
    var i = 1;
    while (arguments.length > i) args.push(arguments[i++]);
    queue$1[++counter] = function () {
      // eslint-disable-next-line no-new-func
      _invoke(typeof fn == 'function' ? fn : Function(fn), args);
    };
    defer(counter);
    return counter;
  };
  clearTask = function clearImmediate(id) {
    delete queue$1[id];
  };
  // Node.js 0.8-
  if (_cof(process$2) == 'process') {
    defer = function (id) {
      process$2.nextTick(_ctx(run, id, 1));
    };
  // Sphere (JS game engine) Dispatch API
  } else if (Dispatch && Dispatch.now) {
    defer = function (id) {
      Dispatch.now(_ctx(run, id, 1));
    };
  // Browsers with MessageChannel, includes WebWorkers
  } else if (MessageChannel) {
    channel = new MessageChannel();
    port = channel.port2;
    channel.port1.onmessage = listener;
    defer = _ctx(port.postMessage, port, 1);
  // Browsers with postMessage, skip WebWorkers
  // IE8 has postMessage, but it's sync & typeof its postMessage is 'object'
  } else if (_global.addEventListener && typeof postMessage == 'function' && !_global.importScripts) {
    defer = function (id) {
      _global.postMessage(id + '', '*');
    };
    _global.addEventListener('message', listener, false);
  // IE8-
  } else if (ONREADYSTATECHANGE in _domCreate('script')) {
    defer = function (id) {
      _html.appendChild(_domCreate('script'))[ONREADYSTATECHANGE] = function () {
        _html.removeChild(this);
        run.call(id);
      };
    };
  // Rest old browsers
  } else {
    defer = function (id) {
      setTimeout(_ctx(run, id, 1), 0);
    };
  }
}
var _task = {
  set: setTask,
  clear: clearTask
};

var macrotask = _task.set;
var Observer = _global.MutationObserver || _global.WebKitMutationObserver;
var process$3 = _global.process;
var Promise = _global.Promise;
var isNode$1 = _cof(process$3) == 'process';

var _microtask = function () {
  var head, last, notify;

  var flush = function () {
    var parent, fn;
    if (isNode$1 && (parent = process$3.domain)) parent.exit();
    while (head) {
      fn = head.fn;
      head = head.next;
      try {
        fn();
      } catch (e) {
        if (head) notify();
        else last = undefined;
        throw e;
      }
    } last = undefined;
    if (parent) parent.enter();
  };

  // Node.js
  if (isNode$1) {
    notify = function () {
      process$3.nextTick(flush);
    };
  // browsers with MutationObserver, except iOS Safari - https://github.com/zloirock/core-js/issues/339
  } else if (Observer && !(_global.navigator && _global.navigator.standalone)) {
    var toggle = true;
    var node = document.createTextNode('');
    new Observer(flush).observe(node, { characterData: true }); // eslint-disable-line no-new
    notify = function () {
      node.data = toggle = !toggle;
    };
  // environments with maybe non-completely correct, but existent Promise
  } else if (Promise && Promise.resolve) {
    // Promise.resolve without an argument throws an error in LG WebOS 2
    var promise = Promise.resolve(undefined);
    notify = function () {
      promise.then(flush);
    };
  // for other environments - macrotask based on:
  // - setImmediate
  // - MessageChannel
  // - window.postMessag
  // - onreadystatechange
  // - setTimeout
  } else {
    notify = function () {
      // strange IE + webpack dev server bug - use .call(global)
      macrotask.call(_global, flush);
    };
  }

  return function (fn) {
    var task = { fn: fn, next: undefined };
    if (last) last.next = task;
    if (!head) {
      head = task;
      notify();
    } last = task;
  };
};

// 25.4.1.5 NewPromiseCapability(C)


function PromiseCapability(C) {
  var resolve, reject;
  this.promise = new C(function ($$resolve, $$reject) {
    if (resolve !== undefined || reject !== undefined) throw TypeError('Bad Promise constructor');
    resolve = $$resolve;
    reject = $$reject;
  });
  this.resolve = _aFunction(resolve);
  this.reject = _aFunction(reject);
}

var f$7 = function (C) {
  return new PromiseCapability(C);
};

var _newPromiseCapability = {
	f: f$7
};

var _perform = function (exec) {
  try {
    return { e: false, v: exec() };
  } catch (e) {
    return { e: true, v: e };
  }
};

var navigator = _global.navigator;

var _userAgent = navigator && navigator.userAgent || '';

var _promiseResolve = function (C, x) {
  _anObject(C);
  if (_isObject(x) && x.constructor === C) return x;
  var promiseCapability = _newPromiseCapability.f(C);
  var resolve = promiseCapability.resolve;
  resolve(x);
  return promiseCapability.promise;
};

var task = _task.set;
var microtask = _microtask();




var PROMISE = 'Promise';
var TypeError$1 = _global.TypeError;
var process$1 = _global.process;
var versions$1 = process$1 && process$1.versions;
var v8 = versions$1 && versions$1.v8 || '';
var $Promise = _global[PROMISE];
var isNode = _classof(process$1) == 'process';
var empty = function () { /* empty */ };
var Internal;
var newGenericPromiseCapability;
var OwnPromiseCapability;
var Wrapper;
var newPromiseCapability = newGenericPromiseCapability = _newPromiseCapability.f;

var USE_NATIVE$1 = !!function () {
  try {
    // correct subclassing with @@species support
    var promise = $Promise.resolve(1);
    var FakePromise = (promise.constructor = {})[_wks('species')] = function (exec) {
      exec(empty, empty);
    };
    // unhandled rejections tracking support, NodeJS Promise without it fails @@species test
    return (isNode || typeof PromiseRejectionEvent == 'function')
      && promise.then(empty) instanceof FakePromise
      // v8 6.6 (Node 10 and Chrome 66) have a bug with resolving custom thenables
      // https://bugs.chromium.org/p/chromium/issues/detail?id=830565
      // we can't detect it synchronously, so just check versions
      && v8.indexOf('6.6') !== 0
      && _userAgent.indexOf('Chrome/66') === -1;
  } catch (e) { /* empty */ }
}();

// helpers
var isThenable = function (it) {
  var then;
  return _isObject(it) && typeof (then = it.then) == 'function' ? then : false;
};
var notify = function (promise, isReject) {
  if (promise._n) return;
  promise._n = true;
  var chain = promise._c;
  microtask(function () {
    var value = promise._v;
    var ok = promise._s == 1;
    var i = 0;
    var run = function (reaction) {
      var handler = ok ? reaction.ok : reaction.fail;
      var resolve = reaction.resolve;
      var reject = reaction.reject;
      var domain = reaction.domain;
      var result, then, exited;
      try {
        if (handler) {
          if (!ok) {
            if (promise._h == 2) onHandleUnhandled(promise);
            promise._h = 1;
          }
          if (handler === true) result = value;
          else {
            if (domain) domain.enter();
            result = handler(value); // may throw
            if (domain) {
              domain.exit();
              exited = true;
            }
          }
          if (result === reaction.promise) {
            reject(TypeError$1('Promise-chain cycle'));
          } else if (then = isThenable(result)) {
            then.call(result, resolve, reject);
          } else resolve(result);
        } else reject(value);
      } catch (e) {
        if (domain && !exited) domain.exit();
        reject(e);
      }
    };
    while (chain.length > i) run(chain[i++]); // variable length - can't use forEach
    promise._c = [];
    promise._n = false;
    if (isReject && !promise._h) onUnhandled(promise);
  });
};
var onUnhandled = function (promise) {
  task.call(_global, function () {
    var value = promise._v;
    var unhandled = isUnhandled(promise);
    var result, handler, console;
    if (unhandled) {
      result = _perform(function () {
        if (isNode) {
          process$1.emit('unhandledRejection', value, promise);
        } else if (handler = _global.onunhandledrejection) {
          handler({ promise: promise, reason: value });
        } else if ((console = _global.console) && console.error) {
          console.error('Unhandled promise rejection', value);
        }
      });
      // Browsers should not trigger `rejectionHandled` event if it was handled here, NodeJS - should
      promise._h = isNode || isUnhandled(promise) ? 2 : 1;
    } promise._a = undefined;
    if (unhandled && result.e) throw result.v;
  });
};
var isUnhandled = function (promise) {
  return promise._h !== 1 && (promise._a || promise._c).length === 0;
};
var onHandleUnhandled = function (promise) {
  task.call(_global, function () {
    var handler;
    if (isNode) {
      process$1.emit('rejectionHandled', promise);
    } else if (handler = _global.onrejectionhandled) {
      handler({ promise: promise, reason: promise._v });
    }
  });
};
var $reject = function (value) {
  var promise = this;
  if (promise._d) return;
  promise._d = true;
  promise = promise._w || promise; // unwrap
  promise._v = value;
  promise._s = 2;
  if (!promise._a) promise._a = promise._c.slice();
  notify(promise, true);
};
var $resolve = function (value) {
  var promise = this;
  var then;
  if (promise._d) return;
  promise._d = true;
  promise = promise._w || promise; // unwrap
  try {
    if (promise === value) throw TypeError$1("Promise can't be resolved itself");
    if (then = isThenable(value)) {
      microtask(function () {
        var wrapper = { _w: promise, _d: false }; // wrap
        try {
          then.call(value, _ctx($resolve, wrapper, 1), _ctx($reject, wrapper, 1));
        } catch (e) {
          $reject.call(wrapper, e);
        }
      });
    } else {
      promise._v = value;
      promise._s = 1;
      notify(promise, false);
    }
  } catch (e) {
    $reject.call({ _w: promise, _d: false }, e); // wrap
  }
};

// constructor polyfill
if (!USE_NATIVE$1) {
  // 25.4.3.1 Promise(executor)
  $Promise = function Promise(executor) {
    _anInstance(this, $Promise, PROMISE, '_h');
    _aFunction(executor);
    Internal.call(this);
    try {
      executor(_ctx($resolve, this, 1), _ctx($reject, this, 1));
    } catch (err) {
      $reject.call(this, err);
    }
  };
  // eslint-disable-next-line no-unused-vars
  Internal = function Promise(executor) {
    this._c = [];             // <- awaiting reactions
    this._a = undefined;      // <- checked in isUnhandled reactions
    this._s = 0;              // <- state
    this._d = false;          // <- done
    this._v = undefined;      // <- value
    this._h = 0;              // <- rejection state, 0 - default, 1 - handled, 2 - unhandled
    this._n = false;          // <- notify
  };
  Internal.prototype = _redefineAll($Promise.prototype, {
    // 25.4.5.3 Promise.prototype.then(onFulfilled, onRejected)
    then: function then(onFulfilled, onRejected) {
      var reaction = newPromiseCapability(_speciesConstructor(this, $Promise));
      reaction.ok = typeof onFulfilled == 'function' ? onFulfilled : true;
      reaction.fail = typeof onRejected == 'function' && onRejected;
      reaction.domain = isNode ? process$1.domain : undefined;
      this._c.push(reaction);
      if (this._a) this._a.push(reaction);
      if (this._s) notify(this, false);
      return reaction.promise;
    },
    // 25.4.5.1 Promise.prototype.catch(onRejected)
    'catch': function (onRejected) {
      return this.then(undefined, onRejected);
    }
  });
  OwnPromiseCapability = function () {
    var promise = new Internal();
    this.promise = promise;
    this.resolve = _ctx($resolve, promise, 1);
    this.reject = _ctx($reject, promise, 1);
  };
  _newPromiseCapability.f = newPromiseCapability = function (C) {
    return C === $Promise || C === Wrapper
      ? new OwnPromiseCapability(C)
      : newGenericPromiseCapability(C);
  };
}

_export(_export.G + _export.W + _export.F * !USE_NATIVE$1, { Promise: $Promise });
_setToStringTag($Promise, PROMISE);
_setSpecies(PROMISE);
Wrapper = _core[PROMISE];

// statics
_export(_export.S + _export.F * !USE_NATIVE$1, PROMISE, {
  // 25.4.4.5 Promise.reject(r)
  reject: function reject(r) {
    var capability = newPromiseCapability(this);
    var $$reject = capability.reject;
    $$reject(r);
    return capability.promise;
  }
});
_export(_export.S + _export.F * (_library || !USE_NATIVE$1), PROMISE, {
  // 25.4.4.6 Promise.resolve(x)
  resolve: function resolve(x) {
    return _promiseResolve(_library && this === Wrapper ? $Promise : this, x);
  }
});
_export(_export.S + _export.F * !(USE_NATIVE$1 && _iterDetect(function (iter) {
  $Promise.all(iter)['catch'](empty);
})), PROMISE, {
  // 25.4.4.1 Promise.all(iterable)
  all: function all(iterable) {
    var C = this;
    var capability = newPromiseCapability(C);
    var resolve = capability.resolve;
    var reject = capability.reject;
    var result = _perform(function () {
      var values = [];
      var index = 0;
      var remaining = 1;
      _forOf(iterable, false, function (promise) {
        var $index = index++;
        var alreadyCalled = false;
        values.push(undefined);
        remaining++;
        C.resolve(promise).then(function (value) {
          if (alreadyCalled) return;
          alreadyCalled = true;
          values[$index] = value;
          --remaining || resolve(values);
        }, reject);
      });
      --remaining || resolve(values);
    });
    if (result.e) reject(result.v);
    return capability.promise;
  },
  // 25.4.4.4 Promise.race(iterable)
  race: function race(iterable) {
    var C = this;
    var capability = newPromiseCapability(C);
    var reject = capability.reject;
    var result = _perform(function () {
      _forOf(iterable, false, function (promise) {
        C.resolve(promise).then(capability.resolve, reject);
      });
    });
    if (result.e) reject(result.v);
    return capability.promise;
  }
});

_export(_export.P + _export.R, 'Promise', { 'finally': function (onFinally) {
  var C = _speciesConstructor(this, _core.Promise || _global.Promise);
  var isFunction = typeof onFinally == 'function';
  return this.then(
    isFunction ? function (x) {
      return _promiseResolve(C, onFinally()).then(function () { return x; });
    } : onFinally,
    isFunction ? function (e) {
      return _promiseResolve(C, onFinally()).then(function () { throw e; });
    } : onFinally
  );
} });

// https://github.com/tc39/proposal-promise-try




_export(_export.S, 'Promise', { 'try': function (callbackfn) {
  var promiseCapability = _newPromiseCapability.f(this);
  var result = _perform(callbackfn);
  (result.e ? promiseCapability.reject : promiseCapability.resolve)(result.v);
  return promiseCapability.promise;
} });

var promise$1 = _core.Promise;

var promise = createCommonjsModule(function (module) {
module.exports = { "default": promise$1, __esModule: true };
});

var _Promise = unwrapExports(promise);

// 20.2.2.22 Math.log2(x)


_export(_export.S, 'Math', {
  log2: function log2(x) {
    return Math.log(x) / Math.LN2;
  }
});

var log2$1 = _core.Math.log2;

var log2 = createCommonjsModule(function (module) {
module.exports = { "default": log2$1, __esModule: true };
});

var _Math$log = unwrapExports(log2);

function realloc(buffer, size) {
  if (buffer.maxByteLength < size) {
    var __size = 1 << Math.ceil(_Math$log(size));
    var _newBuf = new ArrayBuffer(size, { maxByteLength: __size });

    var srcView = new Uint8Array(buffer);
    var dstView = new Uint8Array(_newBuf);

    dstView.set(srcView);
    return _newBuf;
  }
  if (buffer.byteLength < size) {
    buffer.resize(size);
  }
  return buffer;
}

function concat(buf1, buf2) {
  var sizeNeeded = buf1.byteLength + buf2.byteLength;
  var __bufBase = buf1;

  if (buf1.maxByteLength < sizeNeeded) {
    newBuf = realloc(buf1, sizeNeeded);
    newBuf.set(buf2, buf1.byteLength);
    __bufBase = newBuf;
  }

  var bufBaseView = new Uint8Array(__bufBase);
  var buf2View = new Uint8Array(buf2);

  bufBaseView.set(buf2View, buf1.byteLength);
  return newBuf;
}

function copy(buf) {
  var __newBuf = new ArrayBuffer(buf.byteLength, { maxByteLength: buf.maxByteLength });

  var srcView = new Uint8Array(buf);
  var dstView = new Uint8Array(__newBuf);

  dstView.set(srcView, buf.byteLength);
  return __newBuf;
}

// $FlowFixMe: Buffer exists
/** @module INodes */

/**
 * Class representing an iNode.
 */

var INode = function () {

  /**
   * Creates iNode.
   * INode and INodeManager will recursively call each other.
   */
  function INode(metadata, iNodeMgr) {
    _classCallCheck(this, INode);

    var now = new Date();
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


  _createClass(INode, [{
    key: 'getMetadata',
    value: function getMetadata() {
      return this._metadata;
    }
  }]);

  return INode;
}();

/**
 * Class representing a file.
 * @extends INode
 */


var File = function (_INode) {
  _inherits(File, _INode);

  /**
   * Creates a file.
   */
  function File(props, iNodeMgr) {
    _classCallCheck(this, File);

    var _this = _possibleConstructorReturn(this, (File.__proto__ || _Object$getPrototypeOf(File)).call(this, {
      ino: props.ino,
      uid: props.uid,
      gid: props.gid,
      mode: constants.S_IFREG | props.mode & ~constants.S_IFMT,
      size: props.data ? props.data.byteLength : 0
    }, iNodeMgr));

    _this._data = props.data ? props.data : new ArrayBuffer(0);
    return _this;
  }

  /**
   * Gets the file buffer.
   */


  _createClass(File, [{
    key: 'getData',
    value: function getData() {
      return this._data;
    }

    /**
     * Sets the file buffer.
     */

  }, {
    key: 'setData',
    value: function setData(data) {
      this._data = data;
      return;
    }
  }, {
    key: 'read',
    value: function read() {}
  }, {
    key: 'write',
    value: function write(buffer, position, append) {
      var data = this._data;
      var bytesWritten = void 0;
      if (append) {
        data = concat(data, buffer);
        bytesWritten = buffer.byteLength;
      } else {
        position = data.byteLength < position ? data.byteLength : position;
        var overwrittenLength = data.byteLength - position;
        var extendedLength = buffer.byteLength - overwrittenLength;
        if (extendedLength > 0) {
          data = realloc(data, data.byteLength + extendedLength);
        }
        bytesWritten = buffer.byteLength;
        var view8 = new Uint8Array(data);
        view8.set(new Uint8Array(buffer), position);
      }
      this._data = data;
      this._metadata.size = this._data.byteLength;
      return bytesWritten;
    }

    /**
     * Noop.
     */

  }, {
    key: 'destructor',
    value: function destructor() {
      return;
    }
  }]);

  return File;
}(INode);

/**
 * Class representing a directory.
 * @extends INode
 */


var Directory = function (_INode2) {
  _inherits(Directory, _INode2);

  /**
   * Creates a directory.
   * Virtual directories have 0 size.
   * If there's no parent inode, we assume this is the root directory.
   */
  function Directory(props, iNodeMgr) {
    _classCallCheck(this, Directory);

    // root will start with an nlink of 2 due to '..'
    // otherwise start with an nlink of 1
    if (props.parent === undefined) props.parent = props.ino;
    var nlink = void 0;
    if (props.parent === props.ino) {
      nlink = 2;
    } else {
      nlink = 1;
      iNodeMgr.linkINode(iNodeMgr.getINode(props.parent));
    }

    var _this2 = _possibleConstructorReturn(this, (Directory.__proto__ || _Object$getPrototypeOf(Directory)).call(this, {
      ino: props.ino,
      mode: constants.S_IFDIR | props.mode & ~constants.S_IFMT,
      uid: props.uid,
      gid: props.gid,
      nlink: nlink,
      size: 4096
    }, iNodeMgr));

    _this2._dir = new _Map([['.', props.ino], ['..', props.parent]]);
    return _this2;
  }

  /**
   * Gets an iterator of name to iNode index.
   * This prevents giving out mutability.
   */


  _createClass(Directory, [{
    key: 'getEntries',
    value: function getEntries() {
      this._metadata.atime = new Date();
      return this._dir.entries();
    }

    /**
     * Get the inode index for a name.
     */

  }, {
    key: 'getEntryIndex',
    value: function getEntryIndex(name) {
      return this._dir.get(name);
    }

    /**
     * Get inode for a name.
     */

  }, {
    key: 'getEntry',
    value: function getEntry(name) {
      var index = this._dir.get(name);
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

  }, {
    key: 'addEntry',
    value: function addEntry(name, index) {
      if (name === '.' || name === '..') {
        throw new Error('Not allowed to add `.` or `..` entries');
      }
      var now = new Date();
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

  }, {
    key: 'deleteEntry',
    value: function deleteEntry(name) {
      if (name === '.' || name === '..') {
        throw new Error('Not allowed to delete `.` or `..` entries');
      }
      var index = this._dir.get(name);
      if (index !== undefined) {
        var now = new Date();
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

  }, {
    key: 'renameEntry',
    value: function renameEntry(oldName, newName) {
      if (oldName === '.' || oldName === '..' || newName === '.' || oldName === '..') {
        throw new Error('Not allowed to rename `.` or `..` entries');
      }
      var index = this._dir.get(oldName);
      if (index != null) {
        var now = new Date();
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

  }, {
    key: 'destructor',
    value: function destructor() {
      // decrement the parent's nlink due to '..'
      // however do not do this on root otherwise there will be an infinite loop
      if (this._dir.get('.') !== this._dir.get('..')) {
        var parentIndex = this._dir.get('..');
        if (parentIndex != null) {
          this._iNodeMgr.unlinkINode(this._iNodeMgr.getINode(parentIndex));
        }
      }
      return;
    }
  }]);

  return Directory;
}(INode);

/**
 * Class representing a Symlink.
 * @extends INode
 */


var Symlink = function (_INode3) {
  _inherits(Symlink, _INode3);

  /**
   * Creates a symlink.
   */
  function Symlink(props, iNodeMgr) {
    _classCallCheck(this, Symlink);

    var _this3 = _possibleConstructorReturn(this, (Symlink.__proto__ || _Object$getPrototypeOf(Symlink)).call(this, {
      ino: props.ino,
      mode: constants.S_IFLNK | props.mode & ~constants.S_IFMT,
      uid: props.uid,
      gid: props.gid,
      size: new TextEncoder().encode(props.link).byteLength
    }, iNodeMgr));

    _this3._link = props.link;
    return _this3;
  }

  /**
   * Gets the link string.
   */


  _createClass(Symlink, [{
    key: 'getLink',
    value: function getLink() {
      return this._link;
    }

    /**
     * Noop.
     */

  }, {
    key: 'destructor',
    value: function destructor() {
      return;
    }
  }]);

  return Symlink;
}(INode);

/**
 * Class representing a character device.
 * @extends INode
 */


var CharacterDev = function (_INode4) {
  _inherits(CharacterDev, _INode4);

  /**
   * Creates a character device.
   */
  function CharacterDev(props, iNodeMgr) {
    _classCallCheck(this, CharacterDev);

    var _this4 = _possibleConstructorReturn(this, (CharacterDev.__proto__ || _Object$getPrototypeOf(CharacterDev)).call(this, {
      ino: props.ino,
      mode: constants.S_IFCHR | props.mode & ~constants.S_IFMT,
      uid: props.uid,
      gid: props.gid,
      rdev: props.rdev,
      size: 0
    }, iNodeMgr));

    _this4.teardown = props.teardown;
    return _this4;
  }

  _createClass(CharacterDev, [{
    key: 'getFileDesOps',
    value: function getFileDesOps() {
      var _unmkDev = unmkDev(this.getMetadata().rdev),
          _unmkDev2 = _slicedToArray(_unmkDev, 2),
          major = _unmkDev2[0],
          minor = _unmkDev2[1];

      return this._iNodeMgr._devMgr.getChr(major, minor);
    }
  }, {
    key: 'destructor',
    value: function destructor() {
      if (this.teardown !== undefined) {
        this.teardown();
      }
    }
  }]);

  return CharacterDev;
}(INode);

/**
 * Class representing a named pipe.
 * @extends INode
 */


var Fifo = function (_INode5) {
  _inherits(Fifo, _INode5);

  /**
   * Creates a named pipe.
   */
  function Fifo(props, iNodeMgr) {
    _classCallCheck(this, Fifo);

    var _this5 = _possibleConstructorReturn(this, (Fifo.__proto__ || _Object$getPrototypeOf(Fifo)).call(this, {
      ino: props.ino,
      mode: constants.S_IFIFO | props.mode & ~constants.S_IFMT,
      uid: props.uid,
      gid: props.gid,
      size: 0
    }, iNodeMgr));

    _this5.KERN_W = 0;
    _this5.KERN_R = 1;
    _this5.CLOSERM = 2;

    _this5.teardown = props.teardown;
    _this5.reader = -1;
    _this5.writer = -1;
    _this5.messages = [];
    _this5.readQueue = [];
    _this5.pollQueue = [];
    _this5.mode = 0;
    return _this5;
  }

  _createClass(Fifo, [{
    key: 'setMode',
    value: function setMode(request, state) {
      if (state) this.mode |= 1 << request;else this.mode &= ~(1 << request);
    }
  }, {
    key: 'isKernW',
    value: function isKernW() {
      return (this.mode & 1 << this.KERN_W) !== 0;
    }
  }, {
    key: 'isKernR',
    value: function isKernR() {
      return (this.mode & 1 << this.KERN_R) !== 0;
    }
  }, {
    key: 'isCloserm',
    value: function isCloserm() {
      return (this.mode & 1 << this.CLOSERM) !== 0;
    }
  }, {
    key: 'notify',
    value: function notify(size) {
      for (var poll = this.pollQueue.shift(); poll !== undefined; poll = this.pollQueue.shift()) {
        poll(size);
      }
    }
  }, {
    key: 'sendEof',
    value: function sendEof() {
      for (var read = this.readQueue.shift(); read !== undefined; read = this.readQueue.shift()) {
        read(new ArrayBuffer());
      }this.notify(0);
    }
  }, {
    key: 'write',
    value: function write(buf) {
      var req = this.readQueue.shift();
      if (req !== undefined) {
        req(buf);
        return;
      }
      this.messages.push(buf);
      this.notify(buf.byteLength);
    }
  }, {
    key: 'read',
    value: function read() {
      var _this6 = this;

      var buf = this.messages.shift();
      if (buf === undefined) {
        if (this.writer === 0) // writer has already closed the fifo
          return new ArrayBuffer();

        return new _Promise(function (resolve) {
          _this6.readQueue.push(resolve);
        });
      }
      return buf;
    }
  }, {
    key: 'addPollSub',
    value: function addPollSub() {
      var _this7 = this;

      if (this.messages.length !== 0) return _Promise.resolve(this.messages[0].byteLength);

      return new _Promise(function (resolve) {
        _this7.pollQueue.push(resolve);
      });
    }
  }, {
    key: 'destructor',
    value: function destructor() {
      if (this.teardown !== undefined) {
        this.teardown();
      }
    }
  }]);

  return Fifo;
}(INode);

/**
 * Class that manages all iNodes including creation and deletion
 */


var INodeManager = function () {

  /**
   * Creates an instance of the INodeManager.
   * It starts the inode counter at 1, as 0 is usually reserved in posix filesystems.
   */
  function INodeManager(devMgr) {
    _classCallCheck(this, INodeManager);

    this._counter = new Counter(1);
    this._iNodes = new _Map();
    this._iNodeRefs = new _WeakMap();
    this._devMgr = devMgr;
  }

  /**
   * Creates an inode, from a INode constructor function.
   * The returned inode must be used and later manually deallocated.
   */


  _createClass(INodeManager, [{
    key: 'createINode',
    value: function createINode(iNodeConstructor) {
      var props = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      props.ino = this._counter.allocate();
      props.mode = typeof props.mode === 'number' ? props.mode : 0;
      props.uid = typeof props.uid === 'number' ? props.uid : DEFAULT_ROOT_UID;
      props.gid = typeof props.gid === 'number' ? props.gid : DEFAULT_ROOT_GID;
      var iNode = new iNodeConstructor(props, this);
      this._iNodes.set(props.ino, iNode);
      this._iNodeRefs.set(iNode, 0);
      return [iNode, props.ino];
    }

    /**
     * Gets the inode.
     */

  }, {
    key: 'getINode',
    value: function getINode(index) {
      return this._iNodes.get(index);
    }

    /**
     * Links an inode, this increments the hardlink reference count.
     */

  }, {
    key: 'linkINode',
    value: function linkINode(iNode) {
      if (iNode) {
        ++iNode.getMetadata().nlink;
      }
      return;
    }

    /**
     * Unlinks an inode, this decrements the hardlink reference count.
     */

  }, {
    key: 'unlinkINode',
    value: function unlinkINode(iNode) {
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

  }, {
    key: 'refINode',
    value: function refINode(iNode) {
      if (iNode) {
        var refCount = this._iNodeRefs.get(iNode);
        if (refCount !== undefined) {
          this._iNodeRefs.set(iNode, refCount + 1);
        }
      }
      return;
    }

    /**
     * Unreferences an inode, this decrements the private reference count.
     */

  }, {
    key: 'unrefINode',
    value: function unrefINode(iNode) {
      if (iNode) {
        var refCount = this._iNodeRefs.get(iNode);
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

  }, {
    key: '_gcINode',
    value: function _gcINode(iNode) {
      var metadata = iNode.getMetadata();
      var useCount = metadata.nlink + this._iNodeRefs.get(iNode);
      if (useCount === 0 || useCount === 1 && iNode instanceof Directory) {
        var index = metadata.ino;
        iNode.destructor();
        this._iNodes.delete(index);
        this._counter.deallocate(index);
      }
    }
  }]);

  return INodeManager;
}();

var prr = createCommonjsModule(function (module) {
/*!
  * prr
  * (c) 2013 Rod Vagg <rod@vagg.org>
  * https://github.com/rvagg/prr
  * License: MIT
  */

(function (name, context, definition) {
  if ('object' != 'undefined' && module.exports)
    module.exports = definition();
  else
    context[name] = definition();
})('prr', commonjsGlobal, function() {

  var setProperty = typeof Object.defineProperty == 'function'
      ? function (obj, key, options) {
          Object.defineProperty(obj, key, options);
          return obj
        }
      : function (obj, key, options) { // < es5
          obj[key] = options.value;
          return obj
        }

    , makeOptions = function (value, options) {
        var oo = typeof options == 'object'
          , os = !oo && typeof options == 'string'
          , op = function (p) {
              return oo
                ? !!options[p]
                : os
                  ? options.indexOf(p[0]) > -1
                  : false
            };

        return {
            enumerable   : op('enumerable')
          , configurable : op('configurable')
          , writable     : op('writable')
          , value        : value
        }
      }

    , prr = function (obj, key, value, options) {
        var k;

        options = makeOptions(value, options);

        if (typeof key == 'object') {
          for (k in key) {
            if (Object.hasOwnProperty.call(key, k)) {
              options.value = key[k];
              setProperty(obj, k, options);
            }
          }
          return obj
        }

        return setProperty(obj, key, options)
      };

  return prr
});
});

function init$1 (type, message, cause) {
  if (!!message && typeof message != 'string') {
    message = message.message || message.name;
  }
  prr(this, {
      type    : type
    , name    : type
      // can be passed just a 'cause'
    , cause   : typeof message != 'string' ? message : cause
    , message : message
  }, 'ewr');
}

// generic prototype, not intended to be actually used - helpful for `instanceof`
function CustomError (message, cause) {
  Error.call(this);
  if (Error.captureStackTrace)
    Error.captureStackTrace(this, this.constructor);
  init$1.call(this, 'CustomError', message, cause);
}

CustomError.prototype = new Error();

function createError (errno, type, proto) {
  var err = function (message, cause) {
    init$1.call(this, type, message, cause);
    //TODO: the specificity here is stupid, errno should be available everywhere
    if (type == 'FilesystemError') {
      this.code    = this.cause.code;
      this.path    = this.cause.path;
      this.errno   = this.cause.errno;
      this.message =
        (errno.errno[this.cause.errno]
          ? errno.errno[this.cause.errno].description
          : this.cause.message)
        + (this.cause.path ? ' [' + this.cause.path + ']' : '');
    }
    Error.call(this);
    if (Error.captureStackTrace)
      Error.captureStackTrace(this, err);
  };
  err.prototype = !!proto ? new proto() : new CustomError();
  return err
}

var custom = function (errno) {
  var ce = function (type, proto) {
    return createError(errno, type, proto)
  };
  return {
      CustomError     : CustomError
    , FilesystemError : ce('FilesystemError')
    , createError     : ce
  }
};

var errno = createCommonjsModule(function (module) {
var all = module.exports.all = [
  {
    errno: -2,
    code: 'ENOENT',
    description: 'no such file or directory'
  },
  {
    errno: -1,
    code: 'UNKNOWN',
    description: 'unknown error'
  },
  {
    errno: 0,
    code: 'OK',
    description: 'success'
  },
  {
    errno: 1,
    code: 'EOF',
    description: 'end of file'
  },
  {
    errno: 2,
    code: 'EADDRINFO',
    description: 'getaddrinfo error'
  },
  {
    errno: 3,
    code: 'EACCES',
    description: 'permission denied'
  },
  {
    errno: 4,
    code: 'EAGAIN',
    description: 'resource temporarily unavailable'
  },
  {
    errno: 5,
    code: 'EADDRINUSE',
    description: 'address already in use'
  },
  {
    errno: 6,
    code: 'EADDRNOTAVAIL',
    description: 'address not available'
  },
  {
    errno: 7,
    code: 'EAFNOSUPPORT',
    description: 'address family not supported'
  },
  {
    errno: 8,
    code: 'EALREADY',
    description: 'connection already in progress'
  },
  {
    errno: 9,
    code: 'EBADF',
    description: 'bad file descriptor'
  },
  {
    errno: 10,
    code: 'EBUSY',
    description: 'resource busy or locked'
  },
  {
    errno: 11,
    code: 'ECONNABORTED',
    description: 'software caused connection abort'
  },
  {
    errno: 12,
    code: 'ECONNREFUSED',
    description: 'connection refused'
  },
  {
    errno: 13,
    code: 'ECONNRESET',
    description: 'connection reset by peer'
  },
  {
    errno: 14,
    code: 'EDESTADDRREQ',
    description: 'destination address required'
  },
  {
    errno: 15,
    code: 'EFAULT',
    description: 'bad address in system call argument'
  },
  {
    errno: 16,
    code: 'EHOSTUNREACH',
    description: 'host is unreachable'
  },
  {
    errno: 17,
    code: 'EINTR',
    description: 'interrupted system call'
  },
  {
    errno: 18,
    code: 'EINVAL',
    description: 'invalid argument'
  },
  {
    errno: 19,
    code: 'EISCONN',
    description: 'socket is already connected'
  },
  {
    errno: 20,
    code: 'EMFILE',
    description: 'too many open files'
  },
  {
    errno: 21,
    code: 'EMSGSIZE',
    description: 'message too long'
  },
  {
    errno: 22,
    code: 'ENETDOWN',
    description: 'network is down'
  },
  {
    errno: 23,
    code: 'ENETUNREACH',
    description: 'network is unreachable'
  },
  {
    errno: 24,
    code: 'ENFILE',
    description: 'file table overflow'
  },
  {
    errno: 25,
    code: 'ENOBUFS',
    description: 'no buffer space available'
  },
  {
    errno: 26,
    code: 'ENOMEM',
    description: 'not enough memory'
  },
  {
    errno: 27,
    code: 'ENOTDIR',
    description: 'not a directory'
  },
  {
    errno: 28,
    code: 'EISDIR',
    description: 'illegal operation on a directory'
  },
  {
    errno: 29,
    code: 'ENONET',
    description: 'machine is not on the network'
  },
  {
    errno: 31,
    code: 'ENOTCONN',
    description: 'socket is not connected'
  },
  {
    errno: 32,
    code: 'ENOTSOCK',
    description: 'socket operation on non-socket'
  },
  {
    errno: 33,
    code: 'ENOTSUP',
    description: 'operation not supported on socket'
  },
  {
    errno: 34,
    code: 'ENOENT',
    description: 'no such file or directory'
  },
  {
    errno: 35,
    code: 'ENOSYS',
    description: 'function not implemented'
  },
  {
    errno: 36,
    code: 'EPIPE',
    description: 'broken pipe'
  },
  {
    errno: 37,
    code: 'EPROTO',
    description: 'protocol error'
  },
  {
    errno: 38,
    code: 'EPROTONOSUPPORT',
    description: 'protocol not supported'
  },
  {
    errno: 39,
    code: 'EPROTOTYPE',
    description: 'protocol wrong type for socket'
  },
  {
    errno: 40,
    code: 'ETIMEDOUT',
    description: 'connection timed out'
  },
  {
    errno: 41,
    code: 'ECHARSET',
    description: 'invalid Unicode character'
  },
  {
    errno: 42,
    code: 'EAIFAMNOSUPPORT',
    description: 'address family for hostname not supported'
  },
  {
    errno: 44,
    code: 'EAISERVICE',
    description: 'servname not supported for ai_socktype'
  },
  {
    errno: 45,
    code: 'EAISOCKTYPE',
    description: 'ai_socktype not supported'
  },
  {
    errno: 46,
    code: 'ESHUTDOWN',
    description: 'cannot send after transport endpoint shutdown'
  },
  {
    errno: 47,
    code: 'EEXIST',
    description: 'file already exists'
  },
  {
    errno: 48,
    code: 'ESRCH',
    description: 'no such process'
  },
  {
    errno: 49,
    code: 'ENAMETOOLONG',
    description: 'name too long'
  },
  {
    errno: 50,
    code: 'EPERM',
    description: 'operation not permitted'
  },
  {
    errno: 51,
    code: 'ELOOP',
    description: 'too many symbolic links encountered'
  },
  {
    errno: 52,
    code: 'EXDEV',
    description: 'cross-device link not permitted'
  },
  {
    errno: 53,
    code: 'ENOTEMPTY',
    description: 'directory not empty'
  },
  {
    errno: 54,
    code: 'ENOSPC',
    description: 'no space left on device'
  },
  {
    errno: 55,
    code: 'EIO',
    description: 'i/o error'
  },
  {
    errno: 56,
    code: 'EROFS',
    description: 'read-only file system'
  },
  {
    errno: 57,
    code: 'ENODEV',
    description: 'no such device'
  },
  {
    errno: 58,
    code: 'ESPIPE',
    description: 'invalid seek'
  },
  {
    errno: 59,
    code: 'ECANCELED',
    description: 'operation canceled'
  }
];

module.exports.errno = {};
module.exports.code = {};

all.forEach(function (error) {
  module.exports.errno[error.errno] = error;
  module.exports.code[error.code] = error;
});

module.exports.custom = custom(module.exports);
module.exports.create = module.exports.custom.createError;
});

var errno_1 = errno.all;
var errno_2 = errno.errno;
var errno_3 = errno.code;
var errno_4 = errno.custom;
var errno_5 = errno.create;

/** @module VirtualFSError */

/**
 * Class representing a file system error.
 * @extends Error
 */
var VirtualFSError = function (_Error) {
  _inherits(VirtualFSError, _Error);

  /**
   * Creates VirtualFSError.
   */
  function VirtualFSError(errnoObj, path, dest, syscall) {
    _classCallCheck(this, VirtualFSError);

    var message = errnoObj.code + ': ' + errnoObj.description;
    if (path != null) {
      message += ', ' + path;
      if (dest != null) message += ' -> ' + dest;
    }

    var _this = _possibleConstructorReturn(this, (VirtualFSError.__proto__ || _Object$getPrototypeOf(VirtualFSError)).call(this, message));

    _this.errno = errnoObj.errno;
    _this.code = errnoObj.code;
    _this.errnoDescription = errnoObj.description;
    if (syscall != null) {
      _this.syscall = syscall;
    }
    return _this;
  }

  _createClass(VirtualFSError, [{
    key: 'setPaths',
    value: function setPaths(src, dst) {
      var message = this.code + ': ' + this.errnoDescription + ', ' + src;
      if (dst != null) message += ' -> ' + dst;
      this.message = message;
      return;
    }
  }, {
    key: 'setSyscall',
    value: function setSyscall(syscall) {
      this.syscall = syscall;
    }
  }]);

  return VirtualFSError;
}(Error);

// $FlowFixMe: Buffer exists
/** @module FileDescriptors */

/**
 * Class representing a File Descriptor
 */

var FileDescriptor = function () {

  /**
   * Creates FileDescriptor
   * Starts the seek position at 0
   */
  function FileDescriptor(iNode, flags) {
    _classCallCheck(this, FileDescriptor);

    this._iNode = iNode;
    this._flags = flags;
    this._pos = 0;
  }

  /**
   * Gets an INode.
   */


  _createClass(FileDescriptor, [{
    key: 'getINode',
    value: function getINode() {
      return this._iNode;
    }

    /**
     * Gets the file descriptor flags.
     * Unlike Linux filesystems, this retains creation and status flags.
     */

  }, {
    key: 'getFlags',
    value: function getFlags() {
      return this._flags;
    }

    /**
     * Sets the file descriptor flags.
     */

  }, {
    key: 'setFlags',
    value: function setFlags(flags) {
      this._flags = flags;
      return;
    }

    /**
     * Gets the file descriptor position.
     */

  }, {
    key: 'getPos',
    value: function getPos() {
      return this._pos;
    }

    /**
     * Sets the file descriptor position.
     */

  }, {
    key: 'setPos',
    value: function setPos(pos) {
      var flags = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : constants.SEEK_SET;

      var iNode = this.getINode();
      var newPos = void 0;
      switch (true) {
        case iNode instanceof File:
        case iNode instanceof Directory:
          switch (flags) {
            case constants.SEEK_SET:
              newPos = pos;
              break;
            case constants.SEEK_CUR:
              newPos = this._pos + pos;
              break;
            case constants.SEEK_END:
              newPos = iNode.getData().length + pos;
              break;
            default:
              newPos = this._pos;
          }
          if (newPos < 0) {
            throw new VirtualFSError(errno_3.EINVAL);
          }
          this._pos = newPos;
          break;
        case iNode instanceof CharacterDev:
          var fops = iNode.getFileDesOps();
          if (!fops) {
            throw new VirtualFSError(errno_3.ENXIO);
          } else if (!fops.setPos) {
            throw new VirtualFSError(errno_3.ESPIPE);
          } else {
            fops.setPos(this, pos, flags);
          }
          break;
        default:
          throw new VirtualFSError(errno_3.ESPIPE);
      }
    }

    /**
     * Reads from this file descriptor into a buffer.
     * It will always try to fill the input buffer.
     * If position is specified, the position change does not persist.
     * If the current file descriptor position is greater than or equal to the length of the data, this will read 0 bytes.
     */

  }, {
    key: 'read',
    value: function read(buffer) {
      var position = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

      var currentPosition = void 0;
      if (position === null) {
        currentPosition = this._pos;
      } else {
        currentPosition = position;
      }
      var iNode = this._iNode;
      var bytesRead = void 0;
      switch (true) {
        case iNode instanceof File:
          var data = iNode.getData();
          var metadata = iNode.getMetadata();
          bytesRead = data.copy(buffer, 0, currentPosition);
          metadata.atime = new Date();
          break;
        case iNode instanceof CharacterDev:
          var fops = iNode.getFileDesOps();
          if (!fops) {
            throw new VirtualFSError(errno_3.ENXIO);
          } else if (!fops.read) {
            throw new VirtualFSError(errno_3.EINVAL);
          } else {
            bytesRead = fops.read(this, buffer, currentPosition);
          }
          break;
        default:
          throw new VirtualFSError(errno_3.EINVAL);
      }
      if (position === null) {
        this._pos = currentPosition + bytesRead;
      }
      return bytesRead;
    }

    /**
     * Writes to this file descriptor.
     * If position is specified, the position change does not persist.
     */

  }, {
    key: 'write',
    value: function write(buffer) {
      var position = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
      var extraFlags = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;

      var currentPosition = void 0;
      if (position === null) {
        currentPosition = this._pos;
      } else {
        currentPosition = position;
      }
      var iNode = this._iNode;
      var bytesWritten = void 0;
      switch (true) {
        case iNode instanceof File:
          var data = iNode.getData();
          var metadata = iNode.getMetadata();
          if ((this.getFlags() | extraFlags) & constants.O_APPEND) {
            currentPosition = data.length;
            data = Buffer.concat([data, buffer]);
            bytesWritten = buffer.length;
          } else {
            if (currentPosition > data.length) {
              data = Buffer.concat([data, Buffer.alloc(currentPosition - data.length), Buffer.allocUnsafe(buffer.length)]);
            } else if (currentPosition <= data.length) {
              var overwrittenLength = data.length - currentPosition;
              var extendedLength = buffer.length - overwrittenLength;
              if (extendedLength > 0) {
                data = Buffer.concat([data, Buffer.allocUnsafe(extendedLength)]);
              }
            }
            bytesWritten = buffer.copy(data, currentPosition);
          }
          iNode.setData(data);
          var now = new Date();
          metadata.mtime = now;
          metadata.ctime = now;
          metadata.size = data.length;
          break;
        case iNode instanceof CharacterDev:
          var fops = iNode.getFileDesOps();
          if (!fops) {
            throw new VirtualFSError(errno_3.ENXIO);
          } else if (!fops.write) {
            throw new VirtualFSError(errno_3.EINVAL);
          } else {
            bytesWritten = fops.write(this, buffer, currentPosition, extraFlags);
          }
          break;
        default:
          throw new VirtualFSError(errno_3.EINVAL);
      }
      if (position === null) {
        this._pos = currentPosition + bytesWritten;
      }
      return bytesWritten;
    }
  }]);

  return FileDescriptor;
}();

/**
 * Class that manages all FileDescriptors
 */


var FileDescriptorManager = function () {

  /**
   * Creates an instance of the FileDescriptorManager.
   * It starts the fd counter at 0.
   * Make sure not get real fd numbers confused with these fd numbers.
   */
  function FileDescriptorManager(iNodeMgr) {
    _classCallCheck(this, FileDescriptorManager);

    this._counter = new Counter(0);
    this._fds = new _Map();
    this._iNodeMgr = iNodeMgr;
  }

  /**
   * Creates a file descriptor.
   * This will increment the reference to the iNode preventing garbage collection by the INodeManager.
   */


  _createClass(FileDescriptorManager, [{
    key: 'createFd',
    value: function createFd(iNode, flags) {
      this._iNodeMgr.refINode(iNode);
      var index = this._counter.allocate();
      var fd = new FileDescriptor(iNode, flags);
      if (iNode instanceof CharacterDev) {
        var fops = iNode.getFileDesOps();
        if (!fops) {
          throw new VirtualFSError(errno_3.ENXIO);
        } else if (fops.open) {
          fops.open(fd);
        }
      }

      this._fds.set(index, fd);

      return [fd, index];
    }

    /**
     * Gets the file descriptor object.
     */

  }, {
    key: 'getFd',
    value: function getFd(index) {
      return this._fds.get(index);
    }

    /**
     * Duplicates file descriptor index.
     * It may return a new file descriptor index that points to the same file descriptor.
     */

  }, {
    key: 'dupFd',
    value: function dupFd(index) {
      var fd = this._fds.get(index);
      if (fd) {
        this._iNodeMgr.refINode(fd.getINode());
        var dupIndex = this._counter.allocate();
        this._fds.set(dupIndex, fd);
        return index;
      }
    }

    /**
     * Deletes a file descriptor.
     * This effectively closes the file descriptor.
     * This will decrement the reference to the iNode allowing garbage collection by the INodeManager.
     */

  }, {
    key: 'deleteFd',
    value: function deleteFd(fdIndex) {
      var fd = this._fds.get(fdIndex);
      if (fd) {
        var iNode = fd.getINode();
        if (iNode instanceof CharacterDev) {
          var fops = iNode.getFileDesOps();
          if (!fops) {
            throw new VirtualFSError(errno_3.ENXIO);
          } else if (fops.close) {
            fops.close(fd);
          }
        }
        this._fds.delete(fdIndex);
        this._counter.deallocate(fdIndex);
        this._iNodeMgr.unrefINode(iNode);
      }
      return;
    }
  }]);

  return FileDescriptorManager;
}();

// 19.1.2.6 Object.getOwnPropertyDescriptor(O, P)

var $getOwnPropertyDescriptor$1 = _objectGopd.f;

_objectSap('getOwnPropertyDescriptor', function () {
  return function getOwnPropertyDescriptor(it, key) {
    return $getOwnPropertyDescriptor$1(_toIobject(it), key);
  };
});

var $Object$2 = _core.Object;
var getOwnPropertyDescriptor$2 = function getOwnPropertyDescriptor(it, key) {
  return $Object$2.getOwnPropertyDescriptor(it, key);
};

var getOwnPropertyDescriptor = createCommonjsModule(function (module) {
module.exports = { "default": getOwnPropertyDescriptor$2, __esModule: true };
});

unwrapExports(getOwnPropertyDescriptor);

var get = createCommonjsModule(function (module, exports) {
exports.__esModule = true;



var _getPrototypeOf2 = _interopRequireDefault(getPrototypeOf);



var _getOwnPropertyDescriptor2 = _interopRequireDefault(getOwnPropertyDescriptor);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = function get(object, property, receiver) {
  if (object === null) object = Function.prototype;
  var desc = (0, _getOwnPropertyDescriptor2.default)(object, property);

  if (desc === undefined) {
    var parent = (0, _getPrototypeOf2.default)(object);

    if (parent === null) {
      return undefined;
    } else {
      return get(parent, property, receiver);
    }
  } else if ("value" in desc) {
    return desc.value;
  } else {
    var getter = desc.get;

    if (getter === undefined) {
      return undefined;
    }

    return getter.call(receiver);
  }
};
});

var _get = unwrapExports(get);

var domain;

// This constructor is used to store event handlers. Instantiating this is
// faster than explicitly calling `Object.create(null)` to get a "clean" empty
// object (tested with v8 v4.9).
function EventHandlers() {}
EventHandlers.prototype = Object.create(null);

function EventEmitter() {
  EventEmitter.init.call(this);
}
// nodejs oddity
// require('events') === require('events').EventEmitter
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.usingDomains = false;

EventEmitter.prototype.domain = undefined;
EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

EventEmitter.init = function() {
  this.domain = null;
  if (EventEmitter.usingDomains) {
    // if there is an active domain, then attach to it.
    if (domain.active && !(this instanceof domain.Domain)) {
      this.domain = domain.active;
    }
  }

  if (!this._events || this._events === Object.getPrototypeOf(this)._events) {
    this._events = new EventHandlers();
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
};

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || isNaN(n))
    throw new TypeError('"n" argument must be a positive number');
  this._maxListeners = n;
  return this;
};

function $getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return $getMaxListeners(this);
};

// These standalone emit* functions are used to optimize calling of event
// handlers for fast cases because emit() itself often has a variable number of
// arguments and can be deoptimized because of that. These functions always have
// the same number of arguments and thus do not get deoptimized, so the code
// inside them can execute faster.
function emitNone(handler, isFn, self) {
  if (isFn)
    handler.call(self);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self);
  }
}
function emitOne(handler, isFn, self, arg1) {
  if (isFn)
    handler.call(self, arg1);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1);
  }
}
function emitTwo(handler, isFn, self, arg1, arg2) {
  if (isFn)
    handler.call(self, arg1, arg2);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2);
  }
}
function emitThree(handler, isFn, self, arg1, arg2, arg3) {
  if (isFn)
    handler.call(self, arg1, arg2, arg3);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2, arg3);
  }
}

function emitMany(handler, isFn, self, args) {
  if (isFn)
    handler.apply(self, args);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].apply(self, args);
  }
}

EventEmitter.prototype.emit = function emit(type) {
  var er, handler, len, args, i, events, domain;
  var needDomainExit = false;
  var doError = (type === 'error');

  events = this._events;
  if (events)
    doError = (doError && events.error == null);
  else if (!doError)
    return false;

  domain = this.domain;

  // If there is no 'error' event listener then throw.
  if (doError) {
    er = arguments[1];
    if (domain) {
      if (!er)
        er = new Error('Uncaught, unspecified "error" event');
      er.domainEmitter = this;
      er.domain = domain;
      er.domainThrown = false;
      domain.emit('error', er);
    } else if (er instanceof Error) {
      throw er; // Unhandled 'error' event
    } else {
      // At least give some kind of context to the user
      var err = new Error('Uncaught, unspecified "error" event. (' + er + ')');
      err.context = er;
      throw err;
    }
    return false;
  }

  handler = events[type];

  if (!handler)
    return false;

  var isFn = typeof handler === 'function';
  len = arguments.length;
  switch (len) {
    // fast cases
    case 1:
      emitNone(handler, isFn, this);
      break;
    case 2:
      emitOne(handler, isFn, this, arguments[1]);
      break;
    case 3:
      emitTwo(handler, isFn, this, arguments[1], arguments[2]);
      break;
    case 4:
      emitThree(handler, isFn, this, arguments[1], arguments[2], arguments[3]);
      break;
    // slower
    default:
      args = new Array(len - 1);
      for (i = 1; i < len; i++)
        args[i - 1] = arguments[i];
      emitMany(handler, isFn, this, args);
  }

  if (needDomainExit)
    domain.exit();

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');

  events = target._events;
  if (!events) {
    events = target._events = new EventHandlers();
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener) {
      target.emit('newListener', type,
                  listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (!existing) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] = prepend ? [listener, existing] :
                                          [existing, listener];
    } else {
      // If we've already got an array, just append.
      if (prepend) {
        existing.unshift(listener);
      } else {
        existing.push(listener);
      }
    }

    // Check for listener leak
    if (!existing.warned) {
      m = $getMaxListeners(target);
      if (m && m > 0 && existing.length > m) {
        existing.warned = true;
        var w = new Error('Possible EventEmitter memory leak detected. ' +
                            existing.length + ' ' + type + ' listeners added. ' +
                            'Use emitter.setMaxListeners() to increase limit');
        w.name = 'MaxListenersExceededWarning';
        w.emitter = target;
        w.type = type;
        w.count = existing.length;
        emitWarning(w);
      }
    }
  }

  return target;
}
function emitWarning(e) {
  typeof console.warn === 'function' ? console.warn(e) : console.log(e);
}
EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function _onceWrap(target, type, listener) {
  var fired = false;
  function g() {
    target.removeListener(type, g);
    if (!fired) {
      fired = true;
      listener.apply(target, arguments);
    }
  }
  g.listener = listener;
  return g;
}

EventEmitter.prototype.once = function once(type, listener) {
  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');

      events = this._events;
      if (!events)
        return this;

      list = events[type];
      if (!list)
        return this;

      if (list === listener || (list.listener && list.listener === listener)) {
        if (--this._eventsCount === 0)
          this._events = new EventHandlers();
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length; i-- > 0;) {
          if (list[i] === listener ||
              (list[i].listener && list[i].listener === listener)) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (list.length === 1) {
          list[0] = undefined;
          if (--this._eventsCount === 0) {
            this._events = new EventHandlers();
            return this;
          } else {
            delete events[type];
          }
        } else {
          spliceOne(list, position);
        }

        if (events.removeListener)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events;

      events = this._events;
      if (!events)
        return this;

      // not listening for removeListener, no need to emit
      if (!events.removeListener) {
        if (arguments.length === 0) {
          this._events = new EventHandlers();
          this._eventsCount = 0;
        } else if (events[type]) {
          if (--this._eventsCount === 0)
            this._events = new EventHandlers();
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = Object.keys(events);
        for (var i = 0, key; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = new EventHandlers();
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners) {
        // LIFO order
        do {
          this.removeListener(type, listeners[listeners.length - 1]);
        } while (listeners[0]);
      }

      return this;
    };

EventEmitter.prototype.listeners = function listeners(type) {
  var evlistener;
  var ret;
  var events = this._events;

  if (!events)
    ret = [];
  else {
    evlistener = events[type];
    if (!evlistener)
      ret = [];
    else if (typeof evlistener === 'function')
      ret = [evlistener.listener || evlistener];
    else
      ret = unwrapListeners(evlistener);
  }

  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};

// About 1.5x faster than the two-arg version of Array#splice().
function spliceOne(list, index) {
  for (var i = index, k = i + 1, n = list.length; k < n; i += 1, k += 1)
    list[i] = list[k];
  list.pop();
}

function arrayClone(arr, i) {
  var copy = new Array(i);
  while (i--)
    copy[i] = arr[i];
  return copy;
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

var inherits$1;
if (typeof Object.create === 'function'){
  inherits$1 = function inherits(ctor, superCtor) {
    // implementation from standard node.js 'util' module
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  inherits$1 = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor;
    var TempCtor = function () {};
    TempCtor.prototype = superCtor.prototype;
    ctor.prototype = new TempCtor();
    ctor.prototype.constructor = ctor;
  };
}
var inherits$2 = inherits$1;

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
var formatRegExp = /%[sdj%]/g;
function format(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject$1(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
}


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
function deprecate(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global$1.process)) {
    return function() {
      return deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
}


var debugs = {};
var debugEnviron;
function debuglog(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = 0;
      debugs[set] = function() {
        var msg = format.apply(null, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
}


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    _extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}

// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray$2(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty$1(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty$1(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray$2(ar) {
  return Array.isArray(ar);
}

function isBoolean(arg) {
  return typeof arg === 'boolean';
}

function isNull(arg) {
  return arg === null;
}



function isNumber(arg) {
  return typeof arg === 'number';
}

function isString(arg) {
  return typeof arg === 'string';
}



function isUndefined(arg) {
  return arg === void 0;
}

function isRegExp(re) {
  return isObject$1(re) && objectToString(re) === '[object RegExp]';
}

function isObject$1(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isDate(d) {
  return isObject$1(d) && objectToString(d) === '[object Date]';
}

function isError(e) {
  return isObject$1(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}

function isFunction(arg) {
  return typeof arg === 'function';
}





function objectToString(o) {
  return Object.prototype.toString.call(o);
}


// log is just a thin wrapper to console.log that prepends a timestamp



/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
function _extend(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject$1(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
}

function hasOwnProperty$1(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function BufferList$1() {
  this.head = null;
  this.tail = null;
  this.length = 0;
}

BufferList$1.prototype.push = function (v) {
  var entry = { data: v, next: null };
  if (this.length > 0) this.tail.next = entry;else this.head = entry;
  this.tail = entry;
  ++this.length;
};

BufferList$1.prototype.unshift = function (v) {
  var entry = { data: v, next: this.head };
  if (this.length === 0) this.tail = entry;
  this.head = entry;
  ++this.length;
};

BufferList$1.prototype.shift = function () {
  if (this.length === 0) return;
  var ret = this.head.data;
  if (this.length === 1) this.head = this.tail = null;else this.head = this.head.next;
  --this.length;
  return ret;
};

BufferList$1.prototype.clear = function () {
  this.head = this.tail = null;
  this.length = 0;
};

BufferList$1.prototype.join = function (s) {
  if (this.length === 0) return '';
  var p = this.head;
  var ret = '' + p.data;
  while (p = p.next) {
    ret += s + p.data;
  }return ret;
};

BufferList$1.prototype.concat = function (n) {
  if (this.length === 0) return Buffer.alloc(0);
  if (this.length === 1) return this.head.data;
  var ret = Buffer.allocUnsafe(n >>> 0);
  var p = this.head;
  var i = 0;
  while (p) {
    p.data.copy(ret, i);
    i += p.data.length;
    p = p.next;
  }
  return ret;
};

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

var isBufferEncoding = Buffer.isEncoding
  || function(encoding) {
       switch (encoding && encoding.toLowerCase()) {
         case 'hex': case 'utf8': case 'utf-8': case 'ascii': case 'binary': case 'base64': case 'ucs2': case 'ucs-2': case 'utf16le': case 'utf-16le': case 'raw': return true;
         default: return false;
       }
     };


function assertEncoding(encoding) {
  if (encoding && !isBufferEncoding(encoding)) {
    throw new Error('Unknown encoding: ' + encoding);
  }
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters. CESU-8 is handled as part of the UTF-8 encoding.
//
// @TODO Handling all encodings inside a single object makes it very difficult
// to reason about this code, so it should be split up in the future.
// @TODO There should be a utf8-strict encoding that rejects invalid UTF-8 code
// points as used by CESU-8.
function StringDecoder(encoding) {
  this.encoding = (encoding || 'utf8').toLowerCase().replace(/[-_]/, '');
  assertEncoding(encoding);
  switch (this.encoding) {
    case 'utf8':
      // CESU-8 represents each of Surrogate Pair by 3-bytes
      this.surrogateSize = 3;
      break;
    case 'ucs2':
    case 'utf16le':
      // UTF-16 represents each of Surrogate Pair by 2-bytes
      this.surrogateSize = 2;
      this.detectIncompleteChar = utf16DetectIncompleteChar;
      break;
    case 'base64':
      // Base-64 stores 3 bytes in 4 chars, and pads the remainder.
      this.surrogateSize = 3;
      this.detectIncompleteChar = base64DetectIncompleteChar;
      break;
    default:
      this.write = passThroughWrite;
      return;
  }

  // Enough space to store all bytes of a single character. UTF-8 needs 4
  // bytes, but CESU-8 may require up to 6 (3 bytes per surrogate).
  this.charBuffer = new Buffer(6);
  // Number of bytes received for the current incomplete multi-byte character.
  this.charReceived = 0;
  // Number of bytes expected for the current incomplete multi-byte character.
  this.charLength = 0;
}


// write decodes the given buffer and returns it as JS string that is
// guaranteed to not contain any partial multi-byte characters. Any partial
// character found at the end of the buffer is buffered up, and will be
// returned when calling write again with the remaining bytes.
//
// Note: Converting a Buffer containing an orphan surrogate to a String
// currently works, but converting a String to a Buffer (via `new Buffer`, or
// Buffer#write) will replace incomplete surrogates with the unicode
// replacement character. See https://codereview.chromium.org/121173009/ .
StringDecoder.prototype.write = function(buffer) {
  var charStr = '';
  // if our last write ended with an incomplete multibyte character
  while (this.charLength) {
    // determine how many remaining bytes this buffer has to offer for this char
    var available = (buffer.length >= this.charLength - this.charReceived) ?
        this.charLength - this.charReceived :
        buffer.length;

    // add the new bytes to the char buffer
    buffer.copy(this.charBuffer, this.charReceived, 0, available);
    this.charReceived += available;

    if (this.charReceived < this.charLength) {
      // still not enough chars in this buffer? wait for more ...
      return '';
    }

    // remove bytes belonging to the current character from the buffer
    buffer = buffer.slice(available, buffer.length);

    // get the character that was split
    charStr = this.charBuffer.slice(0, this.charLength).toString(this.encoding);

    // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
    var charCode = charStr.charCodeAt(charStr.length - 1);
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      this.charLength += this.surrogateSize;
      charStr = '';
      continue;
    }
    this.charReceived = this.charLength = 0;

    // if there are no more bytes in this buffer, just emit our char
    if (buffer.length === 0) {
      return charStr;
    }
    break;
  }

  // determine and set charLength / charReceived
  this.detectIncompleteChar(buffer);

  var end = buffer.length;
  if (this.charLength) {
    // buffer the incomplete character bytes we got
    buffer.copy(this.charBuffer, 0, buffer.length - this.charReceived, end);
    end -= this.charReceived;
  }

  charStr += buffer.toString(this.encoding, 0, end);

  var end = charStr.length - 1;
  var charCode = charStr.charCodeAt(end);
  // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
  if (charCode >= 0xD800 && charCode <= 0xDBFF) {
    var size = this.surrogateSize;
    this.charLength += size;
    this.charReceived += size;
    this.charBuffer.copy(this.charBuffer, size, 0, size);
    buffer.copy(this.charBuffer, 0, 0, size);
    return charStr.substring(0, end);
  }

  // or just emit the charStr
  return charStr;
};

// detectIncompleteChar determines if there is an incomplete UTF-8 character at
// the end of the given buffer. If so, it sets this.charLength to the byte
// length that character, and sets this.charReceived to the number of bytes
// that are available for this character.
StringDecoder.prototype.detectIncompleteChar = function(buffer) {
  // determine how many bytes we have to check at the end of this buffer
  var i = (buffer.length >= 3) ? 3 : buffer.length;

  // Figure out if one of the last i bytes of our buffer announces an
  // incomplete char.
  for (; i > 0; i--) {
    var c = buffer[buffer.length - i];

    // See http://en.wikipedia.org/wiki/UTF-8#Description

    // 110XXXXX
    if (i == 1 && c >> 5 == 0x06) {
      this.charLength = 2;
      break;
    }

    // 1110XXXX
    if (i <= 2 && c >> 4 == 0x0E) {
      this.charLength = 3;
      break;
    }

    // 11110XXX
    if (i <= 3 && c >> 3 == 0x1E) {
      this.charLength = 4;
      break;
    }
  }
  this.charReceived = i;
};

StringDecoder.prototype.end = function(buffer) {
  var res = '';
  if (buffer && buffer.length)
    res = this.write(buffer);

  if (this.charReceived) {
    var cr = this.charReceived;
    var buf = this.charBuffer;
    var enc = this.encoding;
    res += buf.slice(0, cr).toString(enc);
  }

  return res;
};

function passThroughWrite(buffer) {
  return buffer.toString(this.encoding);
}

function utf16DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 2;
  this.charLength = this.charReceived ? 2 : 0;
}

function base64DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 3;
  this.charLength = this.charReceived ? 3 : 0;
}

Readable$1.ReadableState = ReadableState;
var debug = debuglog('stream');
inherits$2(Readable$1, EventEmitter);

function prependListener(emitter, event, fn) {
  // Sadly this is not cacheable as some libraries bundle their own
  // event emitter implementation with them.
  if (typeof emitter.prependListener === 'function') {
    return emitter.prependListener(event, fn);
  } else {
    // This is a hack to make sure that our error handler is attached before any
    // userland ones.  NEVER DO THIS. This is here only because this code needs
    // to continue to work with older versions of Node.js that do not include
    // the prependListener() method. The goal is to eventually remove this hack.
    if (!emitter._events || !emitter._events[event])
      emitter.on(event, fn);
    else if (Array.isArray(emitter._events[event]))
      emitter._events[event].unshift(fn);
    else
      emitter._events[event] = [fn, emitter._events[event]];
  }
}
function listenerCount$1 (emitter, type) {
  return emitter.listeners(type).length;
}
function ReadableState(options, stream) {

  options = options || {};

  // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex$1) this.objectMode = this.objectMode || !!options.readableObjectMode;

  // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  var hwm = options.highWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~ ~this.highWaterMark;

  // A linked list is used to store data chunks instead of an array because the
  // linked list can remove elements from the beginning faster than
  // array.shift()
  this.buffer = new BufferList$1();
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;
  this.resumeScheduled = false;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // when piping, we only care about 'readable' events that happen
  // after read()ing all the bytes and not getting any pushback.
  this.ranOut = false;

  // the number of writers that are awaiting a drain event in .pipe()s
  this.awaitDrain = 0;

  // if true, a maybeReadMore has been scheduled
  this.readingMore = false;

  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}
function Readable$1(options) {

  if (!(this instanceof Readable$1)) return new Readable$1(options);

  this._readableState = new ReadableState(options, this);

  // legacy
  this.readable = true;

  if (options && typeof options.read === 'function') this._read = options.read;

  EventEmitter.call(this);
}

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
Readable$1.prototype.push = function (chunk, encoding) {
  var state = this._readableState;

  if (!state.objectMode && typeof chunk === 'string') {
    encoding = encoding || state.defaultEncoding;
    if (encoding !== state.encoding) {
      chunk = Buffer.from(chunk, encoding);
      encoding = '';
    }
  }

  return readableAddChunk(this, state, chunk, encoding, false);
};

// Unshift should *always* be something directly out of read()
Readable$1.prototype.unshift = function (chunk) {
  var state = this._readableState;
  return readableAddChunk(this, state, chunk, '', true);
};

Readable$1.prototype.isPaused = function () {
  return this._readableState.flowing === false;
};

function readableAddChunk(stream, state, chunk, encoding, addToFront) {
  var er = chunkInvalid(state, chunk);
  if (er) {
    stream.emit('error', er);
  } else if (chunk === null) {
    state.reading = false;
    onEofChunk(stream, state);
  } else if (state.objectMode || chunk && chunk.length > 0) {
    if (state.ended && !addToFront) {
      var e = new Error('stream.push() after EOF');
      stream.emit('error', e);
    } else if (state.endEmitted && addToFront) {
      var _e = new Error('stream.unshift() after end event');
      stream.emit('error', _e);
    } else {
      var skipAdd;
      if (state.decoder && !addToFront && !encoding) {
        chunk = state.decoder.write(chunk);
        skipAdd = !state.objectMode && chunk.length === 0;
      }

      if (!addToFront) state.reading = false;

      // Don't add to the buffer if we've decoded to an empty string chunk and
      // we're not in object mode
      if (!skipAdd) {
        // if we want the data now, just emit it.
        if (state.flowing && state.length === 0 && !state.sync) {
          stream.emit('data', chunk);
          stream.read(0);
        } else {
          // update the buffer info.
          state.length += state.objectMode ? 1 : chunk.length;
          if (addToFront) state.buffer.unshift(chunk);else state.buffer.push(chunk);

          if (state.needReadable) emitReadable(stream);
        }
      }

      maybeReadMore(stream, state);
    }
  } else if (!addToFront) {
    state.reading = false;
  }

  return needMoreData(state);
}

// if it's past the high water mark, we can push in some more.
// Also, if we have no data yet, we can stand some
// more bytes.  This is to work around cases where hwm=0,
// such as the repl.  Also, if the push() triggered a
// readable event, and the user called read(largeNumber) such that
// needReadable was set, then we ought to push more, so that another
// 'readable' event will be triggered.
function needMoreData(state) {
  return !state.ended && (state.needReadable || state.length < state.highWaterMark || state.length === 0);
}

// backwards compatibility.
Readable$1.prototype.setEncoding = function (enc) {
  this._readableState.decoder = new StringDecoder(enc);
  this._readableState.encoding = enc;
  return this;
};

// Don't raise the hwm > 8MB
var MAX_HWM = 0x800000;
function computeNewHighWaterMark(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2 to prevent increasing hwm excessively in
    // tiny amounts
    n--;
    n |= n >>> 1;
    n |= n >>> 2;
    n |= n >>> 4;
    n |= n >>> 8;
    n |= n >>> 16;
    n++;
  }
  return n;
}

// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function howMuchToRead(n, state) {
  if (n <= 0 || state.length === 0 && state.ended) return 0;
  if (state.objectMode) return 1;
  if (n !== n) {
    // Only flow one buffer at a time
    if (state.flowing && state.length) return state.buffer.head.data.length;else return state.length;
  }
  // If we're asking for more than the current hwm, then raise the hwm.
  if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);
  if (n <= state.length) return n;
  // Don't have enough
  if (!state.ended) {
    state.needReadable = true;
    return 0;
  }
  return state.length;
}

// you can override either this method, or the async _read(n) below.
Readable$1.prototype.read = function (n) {
  debug('read', n);
  n = parseInt(n, 10);
  var state = this._readableState;
  var nOrig = n;

  if (n !== 0) state.emittedReadable = false;

  // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  if (n === 0 && state.needReadable && (state.length >= state.highWaterMark || state.ended)) {
    debug('read: emitReadable', state.length, state.ended);
    if (state.length === 0 && state.ended) endReadable(this);else emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state);

  // if we've ended, and we're now clear, then finish it up.
  if (n === 0 && state.ended) {
    if (state.length === 0) endReadable(this);
    return null;
  }

  // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.

  // if we need a readable event, then we need to do some reading.
  var doRead = state.needReadable;
  debug('need readable', doRead);

  // if we currently have less than the highWaterMark, then also read some
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    debug('length less than watermark', doRead);
  }

  // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.
  if (state.ended || state.reading) {
    doRead = false;
    debug('reading or ended', doRead);
  } else if (doRead) {
    debug('do read');
    state.reading = true;
    state.sync = true;
    // if the length is currently zero, then we *need* a readable event.
    if (state.length === 0) state.needReadable = true;
    // call internal read method
    this._read(state.highWaterMark);
    state.sync = false;
    // If _read pushed data synchronously, then `reading` will be false,
    // and we need to re-evaluate how much data we can return to the user.
    if (!state.reading) n = howMuchToRead(nOrig, state);
  }

  var ret;
  if (n > 0) ret = fromList(n, state);else ret = null;

  if (ret === null) {
    state.needReadable = true;
    n = 0;
  } else {
    state.length -= n;
  }

  if (state.length === 0) {
    // If we have nothing in the buffer, then we want to know
    // as soon as we *do* get something into the buffer.
    if (!state.ended) state.needReadable = true;

    // If we tried to read() past the EOF, then emit end on the next tick.
    if (nOrig !== n && state.ended) endReadable(this);
  }

  if (ret !== null) this.emit('data', ret);

  return ret;
};

function chunkInvalid(state, chunk) {
  var er = null;
  if (!isBuffer(chunk) && typeof chunk !== 'string' && chunk !== null && chunk !== undefined && !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  return er;
}

function onEofChunk(stream, state) {
  if (state.ended) return;
  if (state.decoder) {
    var chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  // emit 'readable' now to make sure it gets picked up.
  emitReadable(stream);
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  var state = stream._readableState;
  state.needReadable = false;
  if (!state.emittedReadable) {
    debug('emitReadable', state.flowing);
    state.emittedReadable = true;
    if (state.sync) nextTick(emitReadable_, stream);else emitReadable_(stream);
  }
}

function emitReadable_(stream) {
  debug('emit readable');
  stream.emit('readable');
  flow(stream);
}

// at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    nextTick(maybeReadMore_, stream, state);
  }
}

function maybeReadMore_(stream, state) {
  var len = state.length;
  while (!state.reading && !state.flowing && !state.ended && state.length < state.highWaterMark) {
    debug('maybeReadMore read 0');
    stream.read(0);
    if (len === state.length)
      // didn't get any data, stop spinning.
      break;else len = state.length;
  }
  state.readingMore = false;
}

// abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable$1.prototype._read = function (n) {
  this.emit('error', new Error('not implemented'));
};

Readable$1.prototype.pipe = function (dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;
    case 1:
      state.pipes = [state.pipes, dest];
      break;
    default:
      state.pipes.push(dest);
      break;
  }
  state.pipesCount += 1;
  debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);

  var doEnd = (!pipeOpts || pipeOpts.end !== false);

  var endFn = doEnd ? onend : cleanup;
  if (state.endEmitted) nextTick(endFn);else src.once('end', endFn);

  dest.on('unpipe', onunpipe);
  function onunpipe(readable) {
    debug('onunpipe');
    if (readable === src) {
      cleanup();
    }
  }

  function onend() {
    debug('onend');
    dest.end();
  }

  // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.
  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);

  var cleanedUp = false;
  function cleanup() {
    debug('cleanup');
    // cleanup event handlers once the pipe is broken
    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', cleanup);
    src.removeListener('data', ondata);

    cleanedUp = true;

    // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain)) ondrain();
  }

  // If the user pushes more data while we're writing to dest then we'll end up
  // in ondata again. However, we only want to increase awaitDrain once because
  // dest will only emit one 'drain' event for the multiple writes.
  // => Introduce a guard on increasing awaitDrain.
  var increasedAwaitDrain = false;
  src.on('data', ondata);
  function ondata(chunk) {
    debug('ondata');
    increasedAwaitDrain = false;
    var ret = dest.write(chunk);
    if (false === ret && !increasedAwaitDrain) {
      // If the user unpiped during `dest.write()`, it is possible
      // to get stuck in a permanently paused state if that write
      // also returned false.
      // => Check whether `dest` is still a piping destination.
      if ((state.pipesCount === 1 && state.pipes === dest || state.pipesCount > 1 && indexOf(state.pipes, dest) !== -1) && !cleanedUp) {
        debug('false write response, pause', src._readableState.awaitDrain);
        src._readableState.awaitDrain++;
        increasedAwaitDrain = true;
      }
      src.pause();
    }
  }

  // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.
  function onerror(er) {
    debug('onerror', er);
    unpipe();
    dest.removeListener('error', onerror);
    if (listenerCount$1(dest, 'error') === 0) dest.emit('error', er);
  }

  // Make sure our error handler is attached before userland ones.
  prependListener(dest, 'error', onerror);

  // Both close and finish should trigger unpipe, but only once.
  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }
  dest.once('close', onclose);
  function onfinish() {
    debug('onfinish');
    dest.removeListener('close', onclose);
    unpipe();
  }
  dest.once('finish', onfinish);

  function unpipe() {
    debug('unpipe');
    src.unpipe(dest);
  }

  // tell the dest that it's being piped to
  dest.emit('pipe', src);

  // start the flow if it hasn't been started already.
  if (!state.flowing) {
    debug('pipe resume');
    src.resume();
  }

  return dest;
};

function pipeOnDrain(src) {
  return function () {
    var state = src._readableState;
    debug('pipeOnDrain', state.awaitDrain);
    if (state.awaitDrain) state.awaitDrain--;
    if (state.awaitDrain === 0 && src.listeners('data').length) {
      state.flowing = true;
      flow(src);
    }
  };
}

Readable$1.prototype.unpipe = function (dest) {
  var state = this._readableState;

  // if we're not piping anywhere, then do nothing.
  if (state.pipesCount === 0) return this;

  // just one destination.  most common case.
  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes) return this;

    if (!dest) dest = state.pipes;

    // got a match.
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;
    if (dest) dest.emit('unpipe', this);
    return this;
  }

  // slow case. multiple pipe destinations.

  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;

    for (var _i = 0; _i < len; _i++) {
      dests[_i].emit('unpipe', this);
    }return this;
  }

  // try to find the right one.
  var i = indexOf(state.pipes, dest);
  if (i === -1) return this;

  state.pipes.splice(i, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1) state.pipes = state.pipes[0];

  dest.emit('unpipe', this);

  return this;
};

// set up data events if they are asked for
// Ensure readable listeners eventually get something
Readable$1.prototype.on = function (ev, fn) {
  var res = EventEmitter.prototype.on.call(this, ev, fn);

  if (ev === 'data') {
    // Start flowing on next tick if stream isn't explicitly paused
    if (this._readableState.flowing !== false) this.resume();
  } else if (ev === 'readable') {
    var state = this._readableState;
    if (!state.endEmitted && !state.readableListening) {
      state.readableListening = state.needReadable = true;
      state.emittedReadable = false;
      if (!state.reading) {
        nextTick(nReadingNextTick, this);
      } else if (state.length) {
        emitReadable(this, state);
      }
    }
  }

  return res;
};
Readable$1.prototype.addListener = Readable$1.prototype.on;

function nReadingNextTick(self) {
  debug('readable nexttick read 0');
  self.read(0);
}

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable$1.prototype.resume = function () {
  var state = this._readableState;
  if (!state.flowing) {
    debug('resume');
    state.flowing = true;
    resume(this, state);
  }
  return this;
};

function resume(stream, state) {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    nextTick(resume_, stream, state);
  }
}

function resume_(stream, state) {
  if (!state.reading) {
    debug('resume read 0');
    stream.read(0);
  }

  state.resumeScheduled = false;
  state.awaitDrain = 0;
  stream.emit('resume');
  flow(stream);
  if (state.flowing && !state.reading) stream.read(0);
}

Readable$1.prototype.pause = function () {
  debug('call pause flowing=%j', this._readableState.flowing);
  if (false !== this._readableState.flowing) {
    debug('pause');
    this._readableState.flowing = false;
    this.emit('pause');
  }
  return this;
};

function flow(stream) {
  var state = stream._readableState;
  debug('flow', state.flowing);
  while (state.flowing && stream.read() !== null) {}
}

// wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable$1.prototype.wrap = function (stream) {
  var state = this._readableState;
  var paused = false;

  var self = this;
  stream.on('end', function () {
    debug('wrapped end');
    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length) self.push(chunk);
    }

    self.push(null);
  });

  stream.on('data', function (chunk) {
    debug('wrapped data');
    if (state.decoder) chunk = state.decoder.write(chunk);

    // don't skip over falsy values in objectMode
    if (state.objectMode && (chunk === null || chunk === undefined)) return;else if (!state.objectMode && (!chunk || !chunk.length)) return;

    var ret = self.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });

  // proxy all the other methods.
  // important when wrapping filters and duplexes.
  for (var i in stream) {
    if (this[i] === undefined && typeof stream[i] === 'function') {
      this[i] = function (method) {
        return function () {
          return stream[method].apply(stream, arguments);
        };
      }(i);
    }
  }

  // proxy certain important events.
  var events = ['error', 'close', 'destroy', 'pause', 'resume'];
  forEach(events, function (ev) {
    stream.on(ev, self.emit.bind(self, ev));
  });

  // when we try to consume some more bytes, simply unpause the
  // underlying stream.
  self._read = function (n) {
    debug('wrapped _read', n);
    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return self;
};

// exposed for testing purposes only.
Readable$1._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function fromList(n, state) {
  // nothing buffered
  if (state.length === 0) return null;

  var ret;
  if (state.objectMode) ret = state.buffer.shift();else if (!n || n >= state.length) {
    // read it all, truncate the list
    if (state.decoder) ret = state.buffer.join('');else if (state.buffer.length === 1) ret = state.buffer.head.data;else ret = state.buffer.concat(state.length);
    state.buffer.clear();
  } else {
    // read part of list
    ret = fromListPartial(n, state.buffer, state.decoder);
  }

  return ret;
}

// Extracts only enough buffered data to satisfy the amount requested.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function fromListPartial(n, list, hasStrings) {
  var ret;
  if (n < list.head.data.length) {
    // slice is the same for buffers and strings
    ret = list.head.data.slice(0, n);
    list.head.data = list.head.data.slice(n);
  } else if (n === list.head.data.length) {
    // first chunk is a perfect match
    ret = list.shift();
  } else {
    // result spans more than one buffer
    ret = hasStrings ? copyFromBufferString(n, list) : copyFromBuffer(n, list);
  }
  return ret;
}

// Copies a specified amount of characters from the list of buffered data
// chunks.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function copyFromBufferString(n, list) {
  var p = list.head;
  var c = 1;
  var ret = p.data;
  n -= ret.length;
  while (p = p.next) {
    var str = p.data;
    var nb = n > str.length ? str.length : n;
    if (nb === str.length) ret += str;else ret += str.slice(0, n);
    n -= nb;
    if (n === 0) {
      if (nb === str.length) {
        ++c;
        if (p.next) list.head = p.next;else list.head = list.tail = null;
      } else {
        list.head = p;
        p.data = str.slice(nb);
      }
      break;
    }
    ++c;
  }
  list.length -= c;
  return ret;
}

// Copies a specified amount of bytes from the list of buffered data chunks.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function copyFromBuffer(n, list) {
  var ret = Buffer.allocUnsafe(n);
  var p = list.head;
  var c = 1;
  p.data.copy(ret);
  n -= p.data.length;
  while (p = p.next) {
    var buf = p.data;
    var nb = n > buf.length ? buf.length : n;
    buf.copy(ret, ret.length - n, 0, nb);
    n -= nb;
    if (n === 0) {
      if (nb === buf.length) {
        ++c;
        if (p.next) list.head = p.next;else list.head = list.tail = null;
      } else {
        list.head = p;
        p.data = buf.slice(nb);
      }
      break;
    }
    ++c;
  }
  list.length -= c;
  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;

  // If we get here before consuming all the bytes, then that is a
  // bug in node.  Should never happen.
  if (state.length > 0) throw new Error('"endReadable()" called on non-empty stream');

  if (!state.endEmitted) {
    state.ended = true;
    nextTick(endReadableNT, state, stream);
  }
}

function endReadableNT(state, stream) {
  // Check that we didn't get one last unshift.
  if (!state.endEmitted && state.length === 0) {
    state.endEmitted = true;
    stream.readable = false;
    stream.emit('end');
  }
}

function forEach(xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

function indexOf(xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }
  return -1;
}

// A bit simpler than readable streams.
// Implement an async ._write(chunk, encoding, cb), and it'll handle all
// the drain event emission and buffering.


Writable$1.WritableState = WritableState;
inherits$2(Writable$1, EventEmitter);

function nop() {}

function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
  this.next = null;
}

function WritableState(options, stream) {
  Object.defineProperty(this, 'buffer', {
    get: deprecate(function () {
      return this.getBuffer();
    }, '_writableState.buffer is deprecated. Use _writableState.getBuffer ' + 'instead.')
  });
  options = options || {};

  // object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex$1) this.objectMode = this.objectMode || !!options.writableObjectMode;

  // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()
  var hwm = options.highWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~ ~this.highWaterMark;

  this.needDrain = false;
  // at the start of calling end()
  this.ending = false;
  // when end() has been called, and returned
  this.ended = false;
  // when 'finish' is emitted
  this.finished = false;

  // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  this.length = 0;

  // a flag to see when we're in the middle of a write.
  this.writing = false;

  // when true all writes will be buffered until .uncork() call
  this.corked = 0;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  this.bufferProcessing = false;

  // the callback that's passed to _write(chunk,cb)
  this.onwrite = function (er) {
    onwrite(stream, er);
  };

  // the callback that the user supplies to write(chunk,encoding,cb)
  this.writecb = null;

  // the amount that is being written when _write is called.
  this.writelen = 0;

  this.bufferedRequest = null;
  this.lastBufferedRequest = null;

  // number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted
  this.pendingcb = 0;

  // emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams
  this.prefinished = false;

  // True if the error was already emitted and should not be thrown again
  this.errorEmitted = false;

  // count buffered requests
  this.bufferedRequestCount = 0;

  // allocate the first CorkedRequest, there is always
  // one allocated and free to use, and we maintain at most two
  this.corkedRequestsFree = new CorkedRequest(this);
}

WritableState.prototype.getBuffer = function writableStateGetBuffer() {
  var current = this.bufferedRequest;
  var out = [];
  while (current) {
    out.push(current);
    current = current.next;
  }
  return out;
};

function Writable$1(options) {

  // Writable ctor is applied to Duplexes, though they're not
  // instanceof Writable, they're instanceof Readable.
  if (!(this instanceof Writable$1) && !(this instanceof Duplex$1)) return new Writable$1(options);

  this._writableState = new WritableState(options, this);

  // legacy.
  this.writable = true;

  if (options) {
    if (typeof options.write === 'function') this._write = options.write;

    if (typeof options.writev === 'function') this._writev = options.writev;
  }

  EventEmitter.call(this);
}

// Otherwise people can pipe Writable streams, which is just wrong.
Writable$1.prototype.pipe = function () {
  this.emit('error', new Error('Cannot pipe, not readable'));
};

function writeAfterEnd(stream, cb) {
  var er = new Error('write after end');
  // TODO: defer error events consistently everywhere, not just the cb
  stream.emit('error', er);
  nextTick(cb, er);
}

// If we get something that is not a buffer, string, null, or undefined,
// and we're not in objectMode, then that's an error.
// Otherwise stream chunks are all considered to be of length=1, and the
// watermarks determine how many objects to keep in the buffer, rather than
// how many bytes or characters.
function validChunk(stream, state, chunk, cb) {
  var valid = true;
  var er = false;
  // Always throw error if a null is written
  // if we are not in object mode then throw
  // if it is not a buffer, string, or undefined.
  if (chunk === null) {
    er = new TypeError('May not write null values to stream');
  } else if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string' && chunk !== undefined && !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  if (er) {
    stream.emit('error', er);
    nextTick(cb, er);
    valid = false;
  }
  return valid;
}

Writable$1.prototype.write = function (chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;

  if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (Buffer.isBuffer(chunk)) encoding = 'buffer';else if (!encoding) encoding = state.defaultEncoding;

  if (typeof cb !== 'function') cb = nop;

  if (state.ended) writeAfterEnd(this, cb);else if (validChunk(this, state, chunk, cb)) {
    state.pendingcb++;
    ret = writeOrBuffer(this, state, chunk, encoding, cb);
  }

  return ret;
};

Writable$1.prototype.cork = function () {
  var state = this._writableState;

  state.corked++;
};

Writable$1.prototype.uncork = function () {
  var state = this._writableState;

  if (state.corked) {
    state.corked--;

    if (!state.writing && !state.corked && !state.finished && !state.bufferProcessing && state.bufferedRequest) clearBuffer(this, state);
  }
};

Writable$1.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
  // node::ParseEncoding() requires lower case.
  if (typeof encoding === 'string') encoding = encoding.toLowerCase();
  if (!(['hex', 'utf8', 'utf-8', 'ascii', 'binary', 'base64', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le', 'raw'].indexOf((encoding + '').toLowerCase()) > -1)) throw new TypeError('Unknown encoding: ' + encoding);
  this._writableState.defaultEncoding = encoding;
  return this;
};

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode && state.decodeStrings !== false && typeof chunk === 'string') {
    chunk = Buffer.from(chunk, encoding);
  }
  return chunk;
}

// if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state, chunk, encoding, cb) {
  chunk = decodeChunk(state, chunk, encoding);

  if (Buffer.isBuffer(chunk)) encoding = 'buffer';
  var len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  var ret = state.length < state.highWaterMark;
  // we must ensure that previous needDrain will not be reset to false.
  if (!ret) state.needDrain = true;

  if (state.writing || state.corked) {
    var last = state.lastBufferedRequest;
    state.lastBufferedRequest = new WriteReq(chunk, encoding, cb);
    if (last) {
      last.next = state.lastBufferedRequest;
    } else {
      state.bufferedRequest = state.lastBufferedRequest;
    }
    state.bufferedRequestCount += 1;
  } else {
    doWrite(stream, state, false, len, chunk, encoding, cb);
  }

  return ret;
}

function doWrite(stream, state, writev, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  if (writev) stream._writev(chunk, state.onwrite);else stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  --state.pendingcb;
  if (sync) nextTick(cb, er);else cb(er);

  stream._writableState.errorEmitted = true;
  stream.emit('error', er);
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;

  onwriteStateUpdate(state);

  if (er) onwriteError(stream, state, sync, er, cb);else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(state);

    if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
      clearBuffer(stream, state);
    }

    if (sync) {
      /*<replacement>*/
        nextTick(afterWrite, stream, state, finished, cb);
      /*</replacement>*/
    } else {
        afterWrite(stream, state, finished, cb);
      }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished) onwriteDrain(stream, state);
  state.pendingcb--;
  cb();
  finishMaybe(stream, state);
}

// Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.
function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
}

// if there's something in the buffer waiting, then process it
function clearBuffer(stream, state) {
  state.bufferProcessing = true;
  var entry = state.bufferedRequest;

  if (stream._writev && entry && entry.next) {
    // Fast case, write everything using _writev()
    var l = state.bufferedRequestCount;
    var buffer = new Array(l);
    var holder = state.corkedRequestsFree;
    holder.entry = entry;

    var count = 0;
    while (entry) {
      buffer[count] = entry;
      entry = entry.next;
      count += 1;
    }

    doWrite(stream, state, true, state.length, buffer, '', holder.finish);

    // doWrite is almost always async, defer these to save a bit of time
    // as the hot path ends with doWrite
    state.pendingcb++;
    state.lastBufferedRequest = null;
    if (holder.next) {
      state.corkedRequestsFree = holder.next;
      holder.next = null;
    } else {
      state.corkedRequestsFree = new CorkedRequest(state);
    }
  } else {
    // Slow case, write chunks one-by-one
    while (entry) {
      var chunk = entry.chunk;
      var encoding = entry.encoding;
      var cb = entry.callback;
      var len = state.objectMode ? 1 : chunk.length;

      doWrite(stream, state, false, len, chunk, encoding, cb);
      entry = entry.next;
      // if we didn't call the onwrite immediately, then
      // it means that we need to wait until it does.
      // also, that means that the chunk and cb are currently
      // being processed, so move the buffer counter past them.
      if (state.writing) {
        break;
      }
    }

    if (entry === null) state.lastBufferedRequest = null;
  }

  state.bufferedRequestCount = 0;
  state.bufferedRequest = entry;
  state.bufferProcessing = false;
}

Writable$1.prototype._write = function (chunk, encoding, cb) {
  cb(new Error('not implemented'));
};

Writable$1.prototype._writev = null;

Writable$1.prototype.end = function (chunk, encoding, cb) {
  var state = this._writableState;

  if (typeof chunk === 'function') {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (chunk !== null && chunk !== undefined) this.write(chunk, encoding);

  // .end() fully uncorks
  if (state.corked) {
    state.corked = 1;
    this.uncork();
  }

  // ignore unnecessary end() calls.
  if (!state.ending && !state.finished) endWritable(this, state, cb);
};

function needFinish(state) {
  return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
}

function prefinish(stream, state) {
  if (!state.prefinished) {
    state.prefinished = true;
    stream.emit('prefinish');
  }
}

function finishMaybe(stream, state) {
  var need = needFinish(state);
  if (need) {
    if (state.pendingcb === 0) {
      prefinish(stream, state);
      state.finished = true;
      stream.emit('finish');
    } else {
      prefinish(stream, state);
    }
  }
  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);
  if (cb) {
    if (state.finished) nextTick(cb);else stream.once('finish', cb);
  }
  state.ended = true;
  stream.writable = false;
}

// It seems a linked list but it is not
// there will be only 2 of these for each stream
function CorkedRequest(state) {
  var _this = this;

  this.next = null;
  this.entry = null;

  this.finish = function (err) {
    var entry = _this.entry;
    _this.entry = null;
    while (entry) {
      var cb = entry.callback;
      state.pendingcb--;
      cb(err);
      entry = entry.next;
    }
    if (state.corkedRequestsFree) {
      state.corkedRequestsFree.next = _this;
    } else {
      state.corkedRequestsFree = _this;
    }
  };
}

inherits$2(Duplex$1, Readable$1);

var keys = Object.keys(Writable$1.prototype);
for (var v = 0; v < keys.length; v++) {
  var method = keys[v];
  if (!Duplex$1.prototype[method]) Duplex$1.prototype[method] = Writable$1.prototype[method];
}
function Duplex$1(options) {
  if (!(this instanceof Duplex$1)) return new Duplex$1(options);

  Readable$1.call(this, options);
  Writable$1.call(this, options);

  if (options && options.readable === false) this.readable = false;

  if (options && options.writable === false) this.writable = false;

  this.allowHalfOpen = true;
  if (options && options.allowHalfOpen === false) this.allowHalfOpen = false;

  this.once('end', onend);
}

// the no-half-open enforcer
function onend() {
  // if we allow half-open state, or if the writable side ended,
  // then we're ok.
  if (this.allowHalfOpen || this._writableState.ended) return;

  // no more data can be written.
  // But allow more writes to happen in this tick.
  nextTick(onEndNT, this);
}

function onEndNT(self) {
  self.end();
}

// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.


inherits$2(Transform$1, Duplex$1);

function TransformState(stream) {
  this.afterTransform = function (er, data) {
    return afterTransform(stream, er, data);
  };

  this.needTransform = false;
  this.transforming = false;
  this.writecb = null;
  this.writechunk = null;
  this.writeencoding = null;
}

function afterTransform(stream, er, data) {
  var ts = stream._transformState;
  ts.transforming = false;

  var cb = ts.writecb;

  if (!cb) return stream.emit('error', new Error('no writecb in Transform class'));

  ts.writechunk = null;
  ts.writecb = null;

  if (data !== null && data !== undefined) stream.push(data);

  cb(er);

  var rs = stream._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    stream._read(rs.highWaterMark);
  }
}
function Transform$1(options) {
  if (!(this instanceof Transform$1)) return new Transform$1(options);

  Duplex$1.call(this, options);

  this._transformState = new TransformState(this);

  // when the writable side finishes, then flush out anything remaining.
  var stream = this;

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true;

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false;

  if (options) {
    if (typeof options.transform === 'function') this._transform = options.transform;

    if (typeof options.flush === 'function') this._flush = options.flush;
  }

  this.once('prefinish', function () {
    if (typeof this._flush === 'function') this._flush(function (er) {
      done(stream, er);
    });else done(stream);
  });
}

Transform$1.prototype.push = function (chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex$1.prototype.push.call(this, chunk, encoding);
};

// This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.
Transform$1.prototype._transform = function (chunk, encoding, cb) {
  throw new Error('Not implemented');
};

Transform$1.prototype._write = function (chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark) this._read(rs.highWaterMark);
  }
};

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
Transform$1.prototype._read = function (n) {
  var ts = this._transformState;

  if (ts.writechunk !== null && ts.writecb && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};

function done(stream, er) {
  if (er) return stream.emit('error', er);

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  var ws = stream._writableState;
  var ts = stream._transformState;

  if (ws.length) throw new Error('Calling transform done when ws.length != 0');

  if (ts.transforming) throw new Error('Calling transform done when still transforming');

  return stream.push(null);
}

inherits$2(PassThrough$1, Transform$1);
function PassThrough$1(options) {
  if (!(this instanceof PassThrough$1)) return new PassThrough$1(options);

  Transform$1.call(this, options);
}

PassThrough$1.prototype._transform = function (chunk, encoding, cb) {
  cb(null, chunk);
};

inherits$2(Stream$1, EventEmitter);
Stream$1.Readable = Readable$1;
Stream$1.Writable = Writable$1;
Stream$1.Duplex = Duplex$1;
Stream$1.Transform = Transform$1;
Stream$1.PassThrough = PassThrough$1;

// Backwards-compat with node 0.4.x
Stream$1.Stream = Stream$1;

// old-style streams.  Note that the pipe method (the only relevant
// part of this class) is overridden in the Readable class.

function Stream$1() {
  EventEmitter.call(this);
}

Stream$1.prototype.pipe = function(dest, options) {
  var source = this;

  function ondata(chunk) {
    if (dest.writable) {
      if (false === dest.write(chunk) && source.pause) {
        source.pause();
      }
    }
  }

  source.on('data', ondata);

  function ondrain() {
    if (source.readable && source.resume) {
      source.resume();
    }
  }

  dest.on('drain', ondrain);

  // If the 'end' option is not supplied, dest.end() will be called when
  // source gets the 'end' or 'close' events.  Only dest.end() once.
  if (!dest._isStdio && (!options || options.end !== false)) {
    source.on('end', onend);
    source.on('close', onclose);
  }

  var didOnEnd = false;
  function onend() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest.end();
  }


  function onclose() {
    if (didOnEnd) return;
    didOnEnd = true;

    if (typeof dest.destroy === 'function') dest.destroy();
  }

  // don't leave dangling pipes when there are errors.
  function onerror(er) {
    cleanup();
    if (EventEmitter.listenerCount(this, 'error') === 0) {
      throw er; // Unhandled stream error in pipe.
    }
  }

  source.on('error', onerror);
  dest.on('error', onerror);

  // remove all the event listeners that were added.
  function cleanup() {
    source.removeListener('data', ondata);
    dest.removeListener('drain', ondrain);

    source.removeListener('end', onend);
    source.removeListener('close', onclose);

    source.removeListener('error', onerror);
    dest.removeListener('error', onerror);

    source.removeListener('end', cleanup);
    source.removeListener('close', cleanup);

    dest.removeListener('close', cleanup);
  }

  source.on('end', cleanup);
  source.on('close', cleanup);

  dest.on('close', cleanup);

  dest.emit('pipe', source);

  // Allow for unix-like usage: A.pipe(B).pipe(C)
  return dest;
};

// $FlowFixMe: Buffer exists
// $FlowFixMe: nextTick exists

/** @module Streams */

/**
 * Class representing a ReadStream.
 * @extends Readable
 */
var ReadStream = function (_Readable) {
  _inherits(ReadStream, _Readable);

  /**
   * Creates ReadStream.
   * It will asynchronously open the file descriptor if a file path was passed in.
   * It will automatically close the opened file descriptor by default.
   */
  function ReadStream(path, options, fs) {
    _classCallCheck(this, ReadStream);

    var _this = _possibleConstructorReturn(this, (ReadStream.__proto__ || _Object$getPrototypeOf(ReadStream)).call(this, {
      highWaterMark: options.highWaterMark,
      encoding: options.encoding
    }));

    _this._fs = fs;
    _this.bytesRead = 0;
    _this.path = path;
    _this.fd = options.fd === undefined ? null : options.fd;
    _this.flags = options.flags === undefined ? 'r' : options.flags;
    _this.mode = options.mode === undefined ? DEFAULT_FILE_PERM : options.mode;
    _this.autoClose = options.autoClose === undefined ? true : options.autoClose;
    _this.start = options.start;
    _this.end = options.end === undefined ? Infinity : options.end;
    _this.pos = options.start;
    if (typeof _this.fd !== 'number') {
      _this._open();
    }
    _get(ReadStream.prototype.__proto__ || _Object$getPrototypeOf(ReadStream.prototype), 'on', _this).call(_this, 'end', function () {
      if (_this.autoClose) {
        _this.destroy();
      }
    });
    return _this;
  }

  /**
   * Open file descriptor if ReadStream was constructed from a file path.
   * @private
   */


  _createClass(ReadStream, [{
    key: '_open',
    value: function _open() {
      var _this2 = this;

      this._fs.open(this.path, this.flags, this.mode, function (e, fd) {
        if (e) {
          if (_this2.autoClose) {
            _this2.destroy();
          }
          _get(ReadStream.prototype.__proto__ || _Object$getPrototypeOf(ReadStream.prototype), 'emit', _this2).call(_this2, 'error', e);
          return;
        }
        _this2.fd = fd;
        _get(ReadStream.prototype.__proto__ || _Object$getPrototypeOf(ReadStream.prototype), 'emit', _this2).call(_this2, 'open', fd);
        _get(ReadStream.prototype.__proto__ || _Object$getPrototypeOf(ReadStream.prototype), 'read', _this2).call(_this2);
      });
    }

    /**
     * Asynchronous read hook for stream implementation.
     * The size passed into this function is not the requested size, but the high watermark.
     * It's just a heuristic buffering size to avoid sending to many syscalls.
     * However since this is an in-memory filesystem, the size itself is irrelevant.
     * @private
     */

  }, {
    key: '_read',
    value: function _read(size) {
      var _this3 = this;

      if (typeof this.fd !== 'number') {
        _get(ReadStream.prototype.__proto__ || _Object$getPrototypeOf(ReadStream.prototype), 'once', this).call(this, 'open', function () {
          _this3._read(size);
        });
        return;
      }
      if (this.destroyed) return;
      // this.pos is only ever used if this.start is specified
      if (this.pos != null) {
        size = Math.min(this.end - this.pos + 1, size);
      }
      if (size <= 0) {
        this.push(null);
        return;
      }
      this._fs.read(this.fd, Buffer.allocUnsafe(size), 0, size, this.pos, function (e, bytesRead, buf) {
        if (e) {
          if (_this3.autoClose) {
            _this3.destroy();
          }
          _get(ReadStream.prototype.__proto__ || _Object$getPrototypeOf(ReadStream.prototype), 'emit', _this3).call(_this3, 'error', e);
          return;
        }
        if (bytesRead > 0) {
          _this3.bytesRead += bytesRead;
          _this3.push(buf.slice(0, bytesRead));
        } else {
          _this3.push(null);
        }
      });
      if (this.pos != null) {
        this.pos += size;
      }
    }

    /**
     * Destroy hook for stream implementation.
     * @private
     */

  }, {
    key: '_destroy',
    value: function _destroy(e, cb) {
      this._close(function (e_) {
        cb(e || e_);
      });
    }

    /**
     * Close file descriptor if ReadStream was constructed from a file path.
     * @private
     */

  }, {
    key: '_close',
    value: function _close(cb) {
      var _this4 = this;

      if (cb) {
        _get(ReadStream.prototype.__proto__ || _Object$getPrototypeOf(ReadStream.prototype), 'once', this).call(this, 'close', cb);
      }
      if (typeof this.fd !== 'number') {
        _get(ReadStream.prototype.__proto__ || _Object$getPrototypeOf(ReadStream.prototype), 'once', this).call(this, 'open', function () {
          _this4._close();
        });
        return;
      }
      if (this.closed) {
        return nextTick(function () {
          return _get(ReadStream.prototype.__proto__ || _Object$getPrototypeOf(ReadStream.prototype), 'emit', _this4).call(_this4, 'close');
        });
      }
      this.closed = true;
      this._fs.close(this.fd, function (e) {
        if (e) {
          _this4.emit('error', e);
        } else {
          _this4.emit('close');
        }
      });
      this.fd = null;
    }
  }]);

  return ReadStream;
}(Readable$1);

/**
 * Class representing a WriteStream.
 * @extends Writable
 */


var WriteStream = function (_Writable) {
  _inherits(WriteStream, _Writable);

  /**
   * Creates WriteStream.
   */
  function WriteStream(path, options, fs) {
    _classCallCheck(this, WriteStream);

    var _this5 = _possibleConstructorReturn(this, (WriteStream.__proto__ || _Object$getPrototypeOf(WriteStream)).call(this, {
      highWaterMark: options.highWaterMark
    }));

    _this5._fs = fs;
    _this5.bytesWritten = 0;
    _this5.path = path;
    _this5.fd = options.fd === undefined ? null : options.fd;
    _this5.flags = options.flags === undefined ? 'w' : options.flags;
    _this5.mode = options.mode === undefined ? DEFAULT_FILE_PERM : options.mode;
    _this5.autoClose = options.autoClose === undefined ? true : options.autoClose;
    _this5.start = options.start;
    _this5.pos = _this5.start; // WriteStream maintains its own position
    if (options.encoding) {
      _get(WriteStream.prototype.__proto__ || _Object$getPrototypeOf(WriteStream.prototype), 'setDefaultEncoding', _this5).call(_this5, options.encoding);
    }
    if (typeof _this5.fd !== 'number') {
      _this5._open();
    }
    _get(WriteStream.prototype.__proto__ || _Object$getPrototypeOf(WriteStream.prototype), 'on', _this5).call(_this5, 'finish', function () {
      if (_this5.autoClose) {
        _this5.destroy();
      }
    });
    return _this5;
  }

  /**
   * Open file descriptor if WriteStream was constructed from a file path.
   * @private
   */


  _createClass(WriteStream, [{
    key: '_open',
    value: function _open() {
      var _this6 = this;

      this._fs.open(this.path, this.flags, this.mode, function (e, fd) {
        if (e) {
          if (_this6.autoClose) {
            _this6.destroy();
          }
          _get(WriteStream.prototype.__proto__ || _Object$getPrototypeOf(WriteStream.prototype), 'emit', _this6).call(_this6, 'error', e);
          return;
        }
        _this6.fd = fd;
        _get(WriteStream.prototype.__proto__ || _Object$getPrototypeOf(WriteStream.prototype), 'emit', _this6).call(_this6, 'open', fd);
      });
    }

    /**
     * Asynchronous write hook for stream implementation.
     * @private
     */
    // $FlowFixMe: _write hook adapted from Node `lib/internal/fs/streams.js`

  }, {
    key: '_write',
    value: function _write(data, encoding, cb) {
      var _this7 = this;

      if (typeof this.fd !== 'number') {
        return _get(WriteStream.prototype.__proto__ || _Object$getPrototypeOf(WriteStream.prototype), 'once', this).call(this, 'open', function () {
          _this7._write(data, encoding, cb);
        });
      }
      this._fs.write(this.fd, data, 0, data.length, this.pos, function (e, bytesWritten) {
        if (e) {
          if (_this7.autoClose) {
            _this7.destroy();
          }
          cb(e);
          return;
        }
        _this7.bytesWritten += bytesWritten;
        cb();
      });
      if (this.pos !== undefined) {
        this.pos += data.length;
      }
    }

    /**
     * Vectorised write hook for stream implementation.
     * @private
     */

  }, {
    key: '_writev',
    value: function _writev(chunks, cb) {
      this._write(Buffer.concat(chunks.map(function (chunk) {
        return chunk.chunk;
      })), undefined, cb);
      return;
    }

    /**
     * Destroy hook for stream implementation.
     * @private
     */

  }, {
    key: '_destroy',
    value: function _destroy(e, cb) {
      this._close(function (e_) {
        cb(e || e_);
      });
    }

    /**
     * Close file descriptor if WriteStream was constructed from a file path.
     * @private
     */

  }, {
    key: '_close',
    value: function _close(cb) {
      var _this8 = this;

      if (cb) {
        _get(WriteStream.prototype.__proto__ || _Object$getPrototypeOf(WriteStream.prototype), 'once', this).call(this, 'close', cb);
      }
      if (typeof this.fd !== 'number') {
        _get(WriteStream.prototype.__proto__ || _Object$getPrototypeOf(WriteStream.prototype), 'once', this).call(this, 'open', function () {
          _this8._close();
        });
        return;
      }
      if (this.closed) {
        return nextTick(function () {
          return _get(WriteStream.prototype.__proto__ || _Object$getPrototypeOf(WriteStream.prototype), 'emit', _this8).call(_this8, 'close');
        });
      }
      this.closed = true;
      this._fs.close(this.fd, function (e) {
        if (e) {
          _this8.emit('error', e);
        } else {
          _this8.emit('close');
        }
      });
      this.fd = null;
    }

    /**
     * Final hook for stream implementation.
     * @private
     */

  }, {
    key: '_final',
    value: function _final(cb) {
      cb();
      return;
    }
  }]);

  return WriteStream;
}(Writable$1);

// $FlowFixMe: nextTick exists

/** @module VirtualFS */

/**
 * Prefer the posix join function if it exists.
 * Browser polyfills of the path module may not have the posix property.
 */
var pathJoin = pathNode.posix ? pathNode.posix.join : pathNode.join;

/**
 * Asynchronous callback backup.
 */
var callbackUp = function callbackUp(err) {
  if (err) throw err;
};

/**
 * Class representing a virtual filesystem.
 */

var VirtualFS = function () {

  /**
   * Creates VirtualFS.
   */
  function VirtualFS() {
    var umask$$1 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 18;
    var rootIndex = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
    var devMgr = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : new DeviceManager();
    var iNodeMgr = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : new INodeManager(devMgr);
    var fdMgr = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : new FileDescriptorManager(iNodeMgr);

    _classCallCheck(this, VirtualFS);

    var rootNode = void 0;
    if (typeof rootIndex === 'number') {
      rootNode = iNodeMgr.getINode(rootIndex);
      if (!(rootNode instanceof Directory)) {
        throw TypeError('rootIndex must point to a root directory');
      }
    } else {
      var _iNodeMgr$createINode = iNodeMgr.createINode(Directory, { mode: DEFAULT_ROOT_PERM, uid: DEFAULT_ROOT_UID, gid: DEFAULT_ROOT_GID });

      var _iNodeMgr$createINode2 = _slicedToArray(_iNodeMgr$createINode, 1);

      rootNode = _iNodeMgr$createINode2[0];
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
    this.ReadStream = ReadStream;
    this.WriteStream = WriteStream;
  }

  _createClass(VirtualFS, [{
    key: 'getUmask',
    value: function getUmask() {
      return this._umask;
    }
  }, {
    key: 'setUmask',
    value: function setUmask(umask$$1) {
      this._umask = umask$$1;
    }
  }, {
    key: 'getUid',
    value: function getUid() {
      return this._uid;
    }
  }, {
    key: 'setUid',
    value: function setUid(uid) {
      this._uid = uid;
    }
  }, {
    key: 'getGid',
    value: function getGid() {
      return this._gid;
    }
  }, {
    key: 'setGid',
    value: function setGid(gid) {
      this._gid = gid;
    }
  }, {
    key: 'getCwd',
    value: function getCwd() {
      return this._cwd.getPath();
    }
  }, {
    key: 'chdir',
    value: function chdir$$1(path) {
      path = this._getPath(path);
      var navigated = this._navigate(path, true);
      if (!navigated.target) {
        throw new VirtualFSError(errno_3.ENOENT, path);
      }
      if (!(navigated.target instanceof Directory)) {
        throw new VirtualFSError(errno_3.ENOTDIR, path);
      }
      if (!this._checkPermissions(constants.X_OK, navigated.target.getMetadata())) {
        throw new VirtualFSError(errno_3.EACCES, path);
      }
      this._cwd.changeDir(navigated.target, navigated.pathStack);
    }
  }, {
    key: 'access',
    value: function access(path) {
      for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        args[_key - 1] = arguments[_key];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.accessSync.bind(this), [path].concat(_toConsumableArray(args.slice(0, cbIndex))), callback, callback);
      return;
    }
  }, {
    key: 'accessSync',
    value: function accessSync(path) {
      var mode = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : constants.F_OK;

      path = this._getPath(path);
      var target = this._navigate(path, true).target;
      if (!target) {
        throw new VirtualFSError(errno_3.ENOENT, path);
      }
      if (mode === constants.F_OK) {
        return;
      }
      if (!this._checkPermissions(mode, target.getMetadata())) {
        throw new VirtualFSError(errno_3.EACCES, path);
      }
    }
  }, {
    key: 'appendFile',
    value: function appendFile(file, data) {
      for (var _len2 = arguments.length, args = Array(_len2 > 2 ? _len2 - 2 : 0), _key2 = 2; _key2 < _len2; _key2++) {
        args[_key2 - 2] = arguments[_key2];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.appendFileSync.bind(this), [file, data].concat(_toConsumableArray(args.slice(0, cbIndex))), callback, callback);
      return;
    }
  }, {
    key: 'appendFileSync',
    value: function appendFileSync(file) {
      var data = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 'undefined';
      var options = arguments[2];

      options = this._getOptions({
        encoding: 'utf8',
        mode: DEFAULT_FILE_PERM,
        flag: 'a'
      }, options);
      data = this._getBuffer(data, options.encoding);
      var fdIndex = void 0;
      try {
        var fd = void 0;
        if (typeof file === 'number') {
          fd = this._fdMgr.getFd(file);
          if (!fd) throw new VirtualFSError(errno_3.EBADF, null, null, 'appendFile');
          if (!(fd.getFlags() & (constants.O_WRONLY | constants.O_RDWR))) {
            throw new VirtualFSError(errno_3.EBADF, null, null, 'appendFile');
          }
        } else {
          var _openSync2 = this._openSync(file, options.flag, options.mode);

          var _openSync3 = _slicedToArray(_openSync2, 2);

          fd = _openSync3[0];
          fdIndex = _openSync3[1];
        }
        try {
          fd.write(data, null, constants.O_APPEND);
        } catch (e) {
          if (e instanceof RangeError) {
            throw new VirtualFSError(errno_3.EFBIG, null, null, 'appendFile');
          }
          throw e;
        }
      } finally {
        if (fdIndex !== undefined) this.closeSync(fdIndex);
      }
      return;
    }
  }, {
    key: 'chmod',
    value: function chmod(path, mode) {
      var callback = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : callbackUp;

      this._callAsync(this.chmodSync.bind(this), [path, mode], callback, callback);
      return;
    }
  }, {
    key: 'chmodSync',
    value: function chmodSync(path, mode) {
      path = this._getPath(path);
      var target = this._navigate(path, true).target;
      if (!target) {
        throw new VirtualFSError(errno_3.ENOENT, path);
      }
      if (typeof mode !== 'number') {
        throw new TypeError('mode must be an integer');
      }
      var targetMetadata = target.getMetadata();
      if (this._uid !== DEFAULT_ROOT_UID && this._uid !== targetMetadata.uid) {
        throw new VirtualFSError(errno_3.EPERM, null, null, 'chmod');
      }
      targetMetadata.mode = targetMetadata.mode & constants.S_IFMT | mode;
      return;
    }
  }, {
    key: 'chown',
    value: function chown(path, uid, gid) {
      var callback = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : callbackUp;

      this._callAsync(this.chownSync.bind(this), [path, uid, gid], callback, callback);
      return;
    }
  }, {
    key: 'chownSync',
    value: function chownSync(path, uid, gid) {
      path = this._getPath(path);
      var target = this._navigate(path, true).target;
      if (!target) {
        throw new VirtualFSError(errno_3.ENOENT, path);
      }
      var targetMetadata = target.getMetadata();
      if (this._uid !== DEFAULT_ROOT_UID) {
        // you don't own the file
        if (targetMetadata.uid !== this._uid) {
          throw new VirtualFSError(errno_3.EPERM, null, null, 'chown');
        }
        // you cannot give files to others
        if (this._uid !== uid) {
          throw new VirtualFSError(errno_3.EPERM, null, null, 'chown');
        }
        // because we don't have user group hierarchies, we allow chowning to any group
      }
      if (typeof uid === 'number') {
        targetMetadata.uid = uid;
      }
      if (typeof gid === 'number') {
        targetMetadata.gid = gid;
      }
      return;
    }
  }, {
    key: 'chownr',
    value: function chownr(path, uid, gid) {
      var callback = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : callbackUp;

      this._callAsync(this.chownrSync.bind(this), [path, uid, gid], callback, callback);
      return;
    }
  }, {
    key: 'chownrSync',
    value: function chownrSync(path, uid, gid) {
      var _this = this;

      path = this._getPath(path);
      this.chownSync(path, uid, gid);
      var children = void 0;
      try {
        children = this.readdirSync(path);
      } catch (e) {
        if (e && e.code === 'ENOTDIR') return;
        throw e;
      }
      children.forEach(function (child) {
        // $FlowFixMe: path is string
        var pathChild = pathJoin(path, child);
        // don't traverse symlinks
        if (!_this.lstatSync(pathChild).isSymbolicLink()) {
          _this.chownrSync(pathChild, uid, gid);
        }
      });
      return;
    }
  }, {
    key: 'close',
    value: function close(fdIndex) {
      var callback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : callbackUp;

      this._callAsync(this.closeSync.bind(this), [fdIndex], callback, callback);
      return;
    }
  }, {
    key: 'closeSync',
    value: function closeSync(fdIndex) {
      if (!this._fdMgr.getFd(fdIndex)) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'close');
      }
      this._fdMgr.deleteFd(fdIndex);
      return;
    }
  }, {
    key: 'copyFile',
    value: function copyFile(srcPath, dstPath) {
      for (var _len3 = arguments.length, args = Array(_len3 > 2 ? _len3 - 2 : 0), _key3 = 2; _key3 < _len3; _key3++) {
        args[_key3 - 2] = arguments[_key3];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.copyFileSync.bind(this), [srcPath, dstPath].concat(_toConsumableArray(args.slice(0, cbIndex))), callback, callback);
      return;
    }
  }, {
    key: 'copyFileSync',
    value: function copyFileSync(srcPath, dstPath) {
      var flags = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;

      srcPath = this._getPath(srcPath);
      dstPath = this._getPath(dstPath);
      var srcFd = void 0;
      var srcFdIndex = void 0;
      var dstFd = void 0;
      var dstFdIndex = void 0;
      try {
        var _openSync4 = this._openSync(srcPath, constants.O_RDONLY);
        // the only things that are copied is the data and the mode


        var _openSync5 = _slicedToArray(_openSync4, 2);

        srcFd = _openSync5[0];
        srcFdIndex = _openSync5[1];

        var srcINode = srcFd.getINode();
        if (srcINode instanceof Directory) {
          throw new VirtualFSError(errno_3.EBADF, srcPath, dstPath);
        }
        var dstFlags = constants.WRONLY | constants.O_CREAT;
        if (flags & constants.COPYFILE_EXCL) {
          dstFlags |= constants.O_EXCL;
        }

        var _openSync6 = this._openSync(dstPath, dstFlags, srcINode.getMetadata().mode);

        var _openSync7 = _slicedToArray(_openSync6, 2);

        dstFd = _openSync7[0];
        dstFdIndex = _openSync7[1];

        var dstINode = dstFd.getINode();
        if (dstINode instanceof File) {
          dstINode.setData(copy(srcINode.getData()));
        } else {
          throw new VirtualFSError(errno_3.EINVAL, srcPath, dstPath);
        }
      } finally {
        if (srcFdIndex !== undefined) this.closeSync(srcFdIndex);
        if (dstFdIndex !== undefined) this.closeSync(dstFdIndex);
      }
      return;
    }
  }, {
    key: 'createReadStream',
    value: function createReadStream(path, options) {
      path = this._getPath(path);
      options = this._getOptions({
        flags: 'r',
        encoding: null,
        fd: null,
        mode: DEFAULT_FILE_PERM,
        autoClose: true,
        end: Infinity
      }, options);
      if (options.start !== undefined) {
        if (options.start > options.end) {
          throw new RangeError('ERR_VALUE_OUT_OF_RANGE');
        }
      }
      return new ReadStream(path, options, this);
    }
  }, {
    key: 'createWriteStream',
    value: function createWriteStream(path, options) {
      path = this._getPath(path);
      options = this._getOptions({
        flags: 'w',
        defaultEncoding: 'utf8',
        fd: null,
        mode: DEFAULT_FILE_PERM,
        autoClose: true
      }, options);
      if (options.start !== undefined) {
        if (options.start < 0) {
          throw new RangeError('ERR_VALUE_OUT_OF_RANGE');
        }
      }
      return new WriteStream(path, options, this);
    }
  }, {
    key: 'exists',
    value: function exists(path, callback) {
      if (!callback) {
        callback = function callback() {};
      }
      this._callAsync(this.existsSync.bind(this), [path], callback, callback);
      return;
    }
  }, {
    key: 'existsSync',
    value: function existsSync(path) {
      path = this._getPath(path);
      try {
        return !!this._navigate(path, true).target;
      } catch (e) {
        return false;
      }
    }
  }, {
    key: 'fallocate',
    value: function fallocate(fdIndex, offset, len) {
      var callback = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : callbackUp;

      this._callAsync(this.fallocateSync.bind(this), [fdIndex, offset, len], callback, callback);
      return;
    }
  }, {
    key: 'fallocateSync',
    value: function fallocateSync(fdIndex, offset, len) {
      if (offset < 0 || len <= 0) {
        throw new VirtualFSError(errno_3.EINVAL, null, null, 'fallocate');
      }
      var fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'fallocate');
      }
      var iNode = fd.getINode();
      if (!(iNode instanceof File)) {
        throw new VirtualFSError(errno_3.ENODEV, null, null, 'fallocate');
      }
      if (!(fd.getFlags() & (constants.O_WRONLY | constants.O_RDWR))) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'fallocate');
      }
      var data = iNode.getData();
      var metadata = iNode.getMetadata();
      if (offset + len > data.length) {
        var newData = void 0;
        try {
          newData = realloc(data, offset + len - data.length);
        } catch (e) {
          if (e instanceof RangeError) {
            throw new VirtualFSError(errno_3.EFBIG, null, null, 'fallocate');
          }
          throw e;
        }
        iNode.setData(newData);
        metadata.size = newData.length;
      }
      metadata.ctime = new Date();
      return;
    }
  }, {
    key: 'mmap',
    value: function mmap(length, flags, fdIndex) {
      for (var _len4 = arguments.length, args = Array(_len4 > 3 ? _len4 - 3 : 0), _key4 = 3; _key4 < _len4; _key4++) {
        args[_key4 - 3] = arguments[_key4];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.mmapSync.bind(this), [length, flags, fdIndex].concat(_toConsumableArray(args.slice(0, cbIndex))), function (buffer) {
        return callback(null, buffer);
      }, callback);
      return;
    }
  }, {
    key: 'mmapSync',
    value: function mmapSync(length, flags, fdIndex) {
      var offset = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 0;

      if (length < 1 || offset < 0) {
        throw new VirtualFSError(errno_3.EINVAL, null, null, 'mmap');
      }
      var fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'mmap');
      }
      var access = fd.getFlags() & constants.O_ACCMODE;
      if (access === constants.O_WRONLY) {
        throw new VirtualFSError(errno_3.EACCES, null, null, 'mmap');
      }
      var iNode = fd.getINode();
      if (!(iNode instanceof File)) {
        throw new VirtualFSError(errno_3.ENODEV, null, null, 'mmap');
      }
      switch (flags) {
        case constants.MAP_PRIVATE:
          return copy(iNode.getData().slice(offset, offset + length));
        case constants.MAP_SHARED:
          if (access !== constants.O_RDWR) {
            throw new VirtualFSError(errno_3.EACCES, null, null, 'mmap');
          }
          return index_browser_umd(iNode, '_data').slice(offset, offset + length);
        default:
          throw new VirtualFSError(errno_3.EINVAL, null, null, 'mmap');
      }
    }
  }, {
    key: 'fchmod',
    value: function fchmod(fdIndex, mode) {
      var callback = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : callbackUp;

      this._callAsync(this.fchmodSync.bind(this), [fdIndex, mode], callback, callback);
      return;
    }
  }, {
    key: 'fchmodSync',
    value: function fchmodSync(fdIndex, mode) {
      var fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'fchmod');
      }
      if (typeof mode !== 'number') {
        throw new TypeError('mode must be an integer');
      }
      var fdMetadata = fd.getINode().getMetadata();
      if (this._uid !== DEFAULT_ROOT_UID && this._uid !== fdMetadata.uid) {
        throw new VirtualFSError(errno_3.EPERM, null, null, 'fchmod');
      }
      fdMetadata.mode = fdMetadata.mode & constants.S_IMFT | mode;
      return;
    }
  }, {
    key: 'fchown',
    value: function fchown(fdIndex, uid, gid) {
      var callback = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : callbackUp;

      this._callAsync(this.fchmodSync.bind(this), [fdIndex, uid, gid], callback, callback);
      return;
    }
  }, {
    key: 'fchownSync',
    value: function fchownSync(fdIndex, uid, gid) {
      var fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'fchown');
      }
      var fdMetadata = fd.getINode().getMetadata();
      if (this._uid !== DEFAULT_ROOT_UID) {
        // you don't own the file
        if (fdMetadata.uid !== this._uid) {
          throw new VirtualFSError(errno_3.EPERM, null, null, 'fchown');
        }
        // you cannot give files to others
        if (this._uid !== uid) {
          throw new VirtualFSError(errno_3.EPERM, null, null, 'fchown');
        }
        // because we don't have user group hierarchies, we allow chowning to any group
      }
      if (typeof uid === 'number') {
        fdMetadata.uid = uid;
      }
      if (typeof gid === 'number') {
        fdMetadata.gid = gid;
      }
      return;
    }
  }, {
    key: 'fdatasync',
    value: function fdatasync(fdIndex) {
      var callback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : callbackUp;

      this._callAsync(this.fchmodSync.bind(this), [fdIndex], callback, callback);
      return;
    }
  }, {
    key: 'fdatasyncSync',
    value: function fdatasyncSync(fdIndex) {
      if (!this._fdMgr.getFd(fdIndex)) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'fdatasync');
      }
      return;
    }
  }, {
    key: 'fstat',
    value: function fstat(fdIndex) {
      var callback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : callbackUp;

      this._callAsync(this.fstatSync.bind(this), [fdIndex], function (stat) {
        return callback(null, stat);
      }, callback);
      return;
    }
  }, {
    key: 'fstatSync',
    value: function fstatSync(fdIndex) {
      var fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'fstat');
      }
      return new Stat(_extends$1({}, fd.getINode().getMetadata()));
    }
  }, {
    key: 'fsync',
    value: function fsync(fdIndex) {
      var callback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : callbackUp;

      this._callAsync(this.fsyncSync.bind(this), [fdIndex], callback, callback);
      return;
    }
  }, {
    key: 'fsyncSync',
    value: function fsyncSync(fdIndex) {
      if (!this._fdMgr.getFd(fdIndex)) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'fsync');
      }
      return;
    }
  }, {
    key: 'ftruncate',
    value: function ftruncate(fdIndex) {
      for (var _len5 = arguments.length, args = Array(_len5 > 1 ? _len5 - 1 : 0), _key5 = 1; _key5 < _len5; _key5++) {
        args[_key5 - 1] = arguments[_key5];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.ftruncateSync.bind(this), [fdIndex].concat(_toConsumableArray(args.slice(0, cbIndex))), callback, callback);
      return;
    }
  }, {
    key: 'ftruncateSync',
    value: function ftruncateSync(fdIndex) {
      var len = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;

      if (len < 0) {
        throw new VirtualFSError(errno_3.EINVAL, null, null, 'ftruncate');
      }
      var fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'ftruncate');
      }
      var iNode = fd.getINode();
      if (!(iNode instanceof File)) {
        throw new VirtualFSError(errno_3.EINVAL, null, null, 'ftruncate');
      }
      if (!(fd.getFlags() & (constants.O_WRONLY | constants.O_RDWR))) {
        throw new VirtualFSError(errno_3.EINVAL, null, null, 'ftruncate');
      }
      var data = iNode.getData();
      var metadata = iNode.getMetadata();
      var newData = void 0;
      try {
        if (len > data.length) {
          newData = realloc(data, len);
          iNode.setData(newData);
        } else if (len < data.length) {
          data.resize(len);
          iNode.setData(newData);
        } else {
          newData = data;
        }
      } catch (e) {
        if (e instanceof RangeError) {
          throw new VirtualFSError(errno_3.EFBIG, null, null, 'ftruncate');
        }
        throw e;
      }
      var now = new Date();
      metadata.mtime = now;
      metadata.ctime = now;
      metadata.size = newData.length;
      fd.setPos(Math.min(newData.length, fd.getPos()));
      return;
    }
  }, {
    key: 'futimes',
    value: function futimes(fdIndex, atime, mtime) {
      var callback = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : callbackUp;

      this._callAsync(this.futimesSync.bind(this), [fdIndex, atime, mtime], callback, callback);
      return;
    }
  }, {
    key: 'futimesSync',
    value: function futimesSync(fdIndex, atime, mtime) {
      var fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'futimes');
      }
      var metadata = fd.getINode().getMetadata();
      var newAtime = void 0;
      var newMtime = void 0;
      if (typeof atime === 'number') {
        newAtime = new Date(atime * 1000);
      } else if (typeof atime === 'string') {
        newAtime = new Date(parseInt(atime) * 1000);
      } else if (atime instanceof Date) {
        newAtime = atime;
      } else {
        throw TypeError('atime and mtime must be dates or unixtime in seconds');
      }
      if (typeof mtime === 'number') {
        newMtime = new Date(mtime * 1000);
      } else if (typeof mtime === 'string') {
        newMtime = new Date(parseInt(mtime) * 1000);
      } else if (mtime instanceof Date) {
        newMtime = mtime;
      } else {
        throw TypeError('atime and mtime must be dates or unixtime in seconds');
      }
      metadata.atime = newAtime;
      metadata.mtime = newMtime;
      metadata.ctime = new Date();
      return;
    }
  }, {
    key: 'lchmod',
    value: function lchmod(path, mode) {
      var callback = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : callbackUp;

      this._callAsync(this.lchmodSync.bind(this), [path, mode], callback, callback);
      return;
    }
  }, {
    key: 'lchmodSync',
    value: function lchmodSync(path, mode) {
      path = this._getPath(path);
      var target = this._navigate(path, false).target;
      if (!target) {
        throw new VirtualFSError(errno_3.ENOENT, path);
      }
      if (typeof mode !== 'number') {
        throw new TypeError('mode must be an integer');
      }
      var targetMetadata = target.getMetadata();
      if (this._uid !== DEFAULT_ROOT_UID && this._uid !== targetMetadata.uid) {
        throw new VirtualFSError(errno_3.EPERM, null, null, 'lchmod');
      }
      targetMetadata.mode = targetMetadata.mode & constants.S_IFMT | mode;
      return;
    }
  }, {
    key: 'lchown',
    value: function lchown(path, uid, gid) {
      var callback = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : callbackUp;

      this._callAsync(this.lchownSync.bind(this), [path, uid, gid], callback, callback);
      return;
    }
  }, {
    key: 'lchownSync',
    value: function lchownSync(path, uid, gid) {
      path = this._getPath(path);
      var target = this._navigate(path, false).target;
      if (!target) {
        throw new VirtualFSError(errno_3.ENOENT, path);
      }
      var targetMetadata = target.getMetadata();
      if (this._uid !== DEFAULT_ROOT_UID) {
        // you don't own the file
        if (targetMetadata.uid !== this._uid) {
          throw new VirtualFSError(errno_3.EPERM, null, null, 'lchown');
        }
        // you cannot give files to others
        if (this._uid !== uid) {
          throw new VirtualFSError(errno_3.EPERM, null, null, 'lchown');
        }
        // because we don't have user group hierarchies, we allow chowning to any group
      }
      if (typeof uid === 'number') {
        targetMetadata.uid = uid;
      }
      if (typeof gid === 'number') {
        targetMetadata.gid = gid;
      }
      return;
    }
  }, {
    key: 'link',
    value: function link(existingPath, newPath) {
      var callback = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : callbackUp;

      this._callAsync(this.linkSync.bind(this), [existingPath, newPath], callback, callback);
      return;
    }
  }, {
    key: 'linkSync',
    value: function linkSync(existingPath, newPath) {
      existingPath = this._getPath(existingPath);
      newPath = this._getPath(newPath);
      var navigatedExisting = void 0;
      var navigatedNew = void 0;
      navigatedExisting = this._navigate(existingPath, false);
      navigatedNew = this._navigate(newPath, false);
      if (!navigatedExisting.target) {
        throw new VirtualFSError(errno_3.ENOENT, existingPath, newPath, 'link');
      }
      if (navigatedExisting.target instanceof Directory) {
        throw new VirtualFSError(errno_3.EPERM, existingPath, newPath, 'link');
      }
      if (!navigatedNew.target) {
        if (navigatedNew.dir.getMetadata().nlink < 2) {
          throw new VirtualFSError(errno_3.ENOENT, existingPath, newPath, 'link');
        }
        if (!this._checkPermissions(constants.W_OK, navigatedNew.dir.getMetadata())) {
          throw new VirtualFSError(errno_3.EACCES, existingPath, newPath, 'link');
        }
        var index = navigatedExisting.dir.getEntryIndex(navigatedExisting.name);
        navigatedNew.dir.addEntry(navigatedNew.name, index);
        navigatedExisting.target.getMetadata().ctime = new Date();
      } else {
        throw new VirtualFSError(errno_3.EEXIST, existingPath, newPath, 'link');
      }
      return;
    }
  }, {
    key: 'lseek',
    value: function lseek(fdIndex, position) {
      for (var _len6 = arguments.length, args = Array(_len6 > 2 ? _len6 - 2 : 0), _key6 = 2; _key6 < _len6; _key6++) {
        args[_key6 - 2] = arguments[_key6];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.lseekSync.bind(this), [fdIndex, position].concat(_toConsumableArray(args.slice(0, cbIndex))), callback, callback);
      return;
    }
  }, {
    key: 'lseekSync',
    value: function lseekSync(fdIndex, position) {
      var seekFlags = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : constants.SEEK_SET;

      var fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'lseek');
      }
      if ([constants.SEEK_SET, constants.SEEK_CUR, constants.SEEK_END].indexOf(seekFlags) === -1) {
        throw new VirtualFSError(errno_3.EINVAL, null, null, 'lseek');
      }
      try {
        fd.setPos(position, seekFlags);
      } catch (e) {
        if (e instanceof VirtualFSError) {
          e.setSyscall('lseek');
        }
        throw e;
      }
      return;
    }
  }, {
    key: 'lstat',
    value: function lstat(path) {
      var callback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : callbackUp;

      this._callAsync(this.lstatSync.bind(this), [path], function (stat) {
        return callback(null, stat);
      }, callback);
      return;
    }
  }, {
    key: 'lstatSync',
    value: function lstatSync(path) {
      path = this._getPath(path);
      var target = this._navigate(path, false).target;
      if (target) {
        return new Stat(_extends$1({}, target.getMetadata()));
      } else {
        throw new VirtualFSError(errno_3.ENOENT, path);
      }
    }
  }, {
    key: 'mkdir',
    value: function mkdir(path) {
      for (var _len7 = arguments.length, args = Array(_len7 > 1 ? _len7 - 1 : 0), _key7 = 1; _key7 < _len7; _key7++) {
        args[_key7 - 1] = arguments[_key7];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.mkdirSync.bind(this), [path].concat(_toConsumableArray(args.slice(0, cbIndex))), callback, callback);
      return;
    }
  }, {
    key: 'mkdirSync',
    value: function mkdirSync(path) {
      var mode = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : DEFAULT_DIRECTORY_PERM;

      path = this._getPath(path);
      // we expect a non-existent directory
      path = path.replace(/(.+?)\/+$/, '$1');
      var navigated = this._navigate(path, true);
      if (navigated.target) {
        throw new VirtualFSError(errno_3.EEXIST, path, null, 'mkdir');
      } else if (!navigated.target && navigated.remaining) {
        throw new VirtualFSError(errno_3.ENOENT, path, null, 'mkdir');
      } else if (!navigated.target) {
        if (navigated.dir.getMetadata().nlink < 2) {
          throw new VirtualFSError(errno_3.ENOENT, path, null, 'mkdir');
        }
        if (!this._checkPermissions(constants.W_OK, navigated.dir.getMetadata())) {
          throw new VirtualFSError(errno_3.EACCES, path, null, 'mkdir');
        }

        var _iNodeMgr$createINode3 = this._iNodeMgr.createINode(Directory, {
          mode: applyUmask(mode, this._umask),
          uid: this._uid,
          gid: this._gid,
          parent: navigated.dir.getEntryIndex('.')
        }),
            _iNodeMgr$createINode4 = _slicedToArray(_iNodeMgr$createINode3, 2),
            index = _iNodeMgr$createINode4[1];

        navigated.dir.addEntry(navigated.name, index);
      }
      return;
    }
  }, {
    key: 'mkdirp',
    value: function mkdirp(path) {
      for (var _len8 = arguments.length, args = Array(_len8 > 1 ? _len8 - 1 : 0), _key8 = 1; _key8 < _len8; _key8++) {
        args[_key8 - 1] = arguments[_key8];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.mkdirpSync.bind(this), [path].concat(_toConsumableArray(args.slice(0, cbIndex))), callback, callback);
      return;
    }
  }, {
    key: 'mkdirpSync',
    value: function mkdirpSync(path) {
      var mode = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : DEFAULT_DIRECTORY_PERM;

      path = this._getPath(path);
      // we expect a directory
      path = path.replace(/(.+?)\/+$/, '$1');
      var iNode = void 0;
      var index = void 0;
      var currentDir = void 0;
      var navigated = this._navigate(path, true);
      while (true) {
        if (!navigated.target) {
          if (navigated.dir.getMetadata().nlink < 2) {
            throw new VirtualFSError(errno_3.ENOENT, path);
          }
          if (!this._checkPermissions(constants.W_OK, navigated.dir.getMetadata())) {
            throw new VirtualFSError(errno_3.EACCES, path);
          }

          var _iNodeMgr$createINode5 = this._iNodeMgr.createINode(Directory, {
            mode: applyUmask(mode, this._umask),
            uid: this._uid,
            gid: this._gid,
            parent: navigated.dir.getEntryIndex('.')
          });

          var _iNodeMgr$createINode6 = _slicedToArray(_iNodeMgr$createINode5, 2);

          iNode = _iNodeMgr$createINode6[0];
          index = _iNodeMgr$createINode6[1];

          navigated.dir.addEntry(navigated.name, index);
          if (navigated.remaining) {
            currentDir = iNode;
            navigated = this._navigateFrom(currentDir, navigated.remaining, true);
          } else {
            break;
          }
        } else if (!(navigated.target instanceof Directory)) {
          throw new VirtualFSError(errno_3.ENOTDIR, path);
        } else {
          break;
        }
      }
      return;
    }
  }, {
    key: 'mkdtemp',
    value: function mkdtemp(pathSPrefix) {
      for (var _len9 = arguments.length, args = Array(_len9 > 1 ? _len9 - 1 : 0), _key9 = 1; _key9 < _len9; _key9++) {
        args[_key9 - 1] = arguments[_key9];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.mkdtempSync.bind(this), [pathSPrefix].concat(_toConsumableArray(args.slice(0, cbIndex))), function (pathS) {
        return callback(null, pathS);
      }, callback);
      return;
    }

    /* mkdtempSync (pathSPrefix: string, options?: options): string|ArrayBuffer {
      options = this._getOptions({encoding: 'utf8'}, options);
      if (!pathSPrefix || typeof pathSPrefix !== 'string') {
        throw new TypeError('filename prefix is required');
      }
      const getChar = () => {
        const possibleChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        return possibleChars[Math.floor(Math.random() * possibleChars.length)];
      };
      let pathS;
      while (true) {
        pathS = pathSPrefix.concat(
          Array.from({length: 6}, () => getChar).map((f) => f()).join('')
        );
        try {
          this.mkdirSync(pathS);
          if (options.encoding === 'buffer') {
            return Buffer.from(pathS);
          } else {
            return Buffer.from(pathS).toString(options.encoding);
          }
        } catch (e) {
          if (e.code !== errno.EEXIST) {
            throw e;
          }
        }
      }
    }*/

  }, {
    key: 'mknod',
    value: function mknod(path, type, major, minor) {
      for (var _len10 = arguments.length, args = Array(_len10 > 4 ? _len10 - 4 : 0), _key10 = 4; _key10 < _len10; _key10++) {
        args[_key10 - 4] = arguments[_key10];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.mknodSync.bind(this), [path, type, major, minor].concat(_toConsumableArray(args.slice(0, cbIndex))), callback, callback);
      return;
    }
  }, {
    key: 'mknodSync',
    value: function mknodSync(path, type, major, minor) {
      var mode = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : DEFAULT_FILE_PERM;

      path = this._getPath(path);
      var navigated = this._navigate(path, false);
      if (navigated.target) {
        throw new VirtualFSError(errno_3.EEXIST, path, null, 'mknod');
      }
      if (navigated.dir.getMetadata().nlink < 2) {
        throw new VirtualFSError(errno_3.ENOENT, path, null, 'mknod');
      }
      if (!this._checkPermissions(constants.W_OK, navigated.dir.getMetadata())) {
        throw new VirtualFSError(errno_3.EACCES, path, null, 'mknod');
      }
      var index = void 0;
      switch (type) {
        case constants.S_IFREG:
          var _iNodeMgr$createINode7 = this._iNodeMgr.createINode(File, {
            mode: applyUmask(mode, this._umask),
            uid: this._uid,
            gid: this._gid
          });

          var _iNodeMgr$createINode8 = _slicedToArray(_iNodeMgr$createINode7, 2);

          index = _iNodeMgr$createINode8[1];

          break;
        case constants.S_IFCHR:
          if (typeof major !== 'number' || typeof minor !== 'number') {
            throw TypeError('major and minor must set as numbers when creating device nodes');
          }
          if (major > MAJOR_MAX || minor > MINOR_MAX || minor < MAJOR_MIN || minor < MINOR_MIN) {
            throw new VirtualFSError(errno_3.EINVAL, path, null, 'mknod');
          }

          var _iNodeMgr$createINode9 = this._iNodeMgr.createINode(CharacterDev, {
            mode: applyUmask(mode, this._umask),
            uid: this._uid,
            gid: this._gid,
            rdev: mkDev(major, minor)
          });

          var _iNodeMgr$createINode10 = _slicedToArray(_iNodeMgr$createINode9, 2);

          index = _iNodeMgr$createINode10[1];

          break;
        default:
          throw new VirtualFSError(errno_3.EPERM, path, null, 'mknod');
      }
      navigated.dir.addEntry(navigated.name, index);
      return;
    }
  }, {
    key: 'open',
    value: function open(path, flags) {
      for (var _len11 = arguments.length, args = Array(_len11 > 2 ? _len11 - 2 : 0), _key11 = 2; _key11 < _len11; _key11++) {
        args[_key11 - 2] = arguments[_key11];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.openSync.bind(this), [path, flags].concat(_toConsumableArray(args.slice(0, cbIndex))), function (fdIndex) {
        return callback(null, fdIndex);
      }, callback);
      return;
    }
  }, {
    key: 'openSync',
    value: function openSync(path, flags) {
      var mode = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : DEFAULT_FILE_PERM;

      return this._openSync(path, flags, mode)[1];
    }
  }, {
    key: '_openSync',
    value: function _openSync(path, flags) {
      var mode = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : DEFAULT_FILE_PERM;

      path = this._getPath(path);
      if (typeof flags === 'string') {
        switch (flags) {
          case 'r':
          case 'rs':
            flags = constants.O_RDONLY;
            break;
          case 'r+':
          case 'rs+':
            flags = constants.O_RDWR;
            break;
          case 'w':
            flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC;
            break;
          case 'wx':
            flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_EXCL;
            break;
          case 'w+':
            flags = constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC;
            break;
          case 'wx+':
            flags = constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC | constants.O_EXCL;
            break;
          case 'a':
            flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT;
            break;
          case 'ax':
            flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL;
            break;
          case 'a+':
            flags = constants.O_RDWR | constants.O_APPEND | constants.O_CREAT;
            break;
          case 'ax+':
            flags = constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL;
            break;
          default:
            throw new TypeError('Unknown file open flag: ' + flags);
        }
      }
      if (typeof flags !== 'number') {
        throw new TypeError('Unknown file open flag: ' + flags);
      }
      var navigated = this._navigate(path, false);
      if (navigated.target instanceof Symlink) {
        // cannot be symlink if O_NOFOLLOW
        if (flags & constants.O_NOFOLLOW) {
          throw new VirtualFSError(errno_3.ELOOP, path, null, 'open');
        }
        navigated = this._navigateFrom(navigated.dir, navigated.name + navigated.remaining, true, undefined, undefined, path);
      }
      var target = navigated.target;
      // cannot be missing unless O_CREAT
      if (!target) {
        // O_CREAT only applies if there's a left over name without any remaining path
        if (!navigated.remaining && flags & constants.O_CREAT) {
          // cannot create if the current directory has been unlinked from its parent directory
          if (navigated.dir.getMetadata().nlink < 2) {
            throw new VirtualFSError(errno_3.ENOENT, path, null, 'open');
          }
          if (!this._checkPermissions(constants.W_OK, navigated.dir.getMetadata())) {
            throw new VirtualFSError(errno_3.EACCES, path, null, 'open');
          }
          var index = void 0;

          var _iNodeMgr$createINode11 = this._iNodeMgr.createINode(File, {
            mode: applyUmask(mode, this._umask),
            uid: this._uid,
            gid: this._gid
          });

          var _iNodeMgr$createINode12 = _slicedToArray(_iNodeMgr$createINode11, 2);

          target = _iNodeMgr$createINode12[0];
          index = _iNodeMgr$createINode12[1];

          navigated.dir.addEntry(navigated.name, index);
        } else {
          throw new VirtualFSError(errno_3.ENOENT, path, null, 'open');
        }
      } else {
        // target already exists cannot be created exclusively
        if (flags & constants.O_CREAT && flags & constants.O_EXCL) {
          throw new VirtualFSError(errno_3.EEXIST, path, null, 'open');
        }
        // cannot be directory if write capabilities are requested
        if (target instanceof Directory && flags & (constants.O_WRONLY | flags & constants.O_RDWR)) {
          throw new VirtualFSError(errno_3.EISDIR, path, null, 'open');
        }
        // must be directory if O_DIRECTORY
        if (flags & constants.O_DIRECTORY && !(target instanceof Directory)) {
          throw new VirtualFSError(errno_3.ENOTDIR, path, null, 'open');
        }
        // must truncate a file if O_TRUNC
        if (flags & constants.O_TRUNC && target instanceof File && flags & (constants.O_WRONLY | constants.O_RDWR)) {
          target.setData(new ArrayBuffer(0));
        }
        // convert file descriptor access flags into bitwise permission flags
        var access = void 0;
        if (flags & constants.O_RDWR) {
          access = constants.R_OK | constants.W_OK;
        } else if (flags & constants.O_WRONLY) {
          access = constants.W_OK;
        } else {
          access = constants.R_OK;
        }
        if (!this._checkPermissions(access, target.getMetadata())) {
          throw new VirtualFSError(errno_3.EACCES, path, null, 'open');
        }
      }
      try {
        var fd = this._fdMgr.createFd(target, flags);
        return fd;
      } catch (e) {
        if (e instanceof VirtualFSError) {
          e.setPaths(path);
          e.setSyscall('open');
        }
        throw e;
      }
    }
  }, {
    key: 'read',
    value: function read(fdIndex, buffer) {
      for (var _len12 = arguments.length, args = Array(_len12 > 2 ? _len12 - 2 : 0), _key12 = 2; _key12 < _len12; _key12++) {
        args[_key12 - 2] = arguments[_key12];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.readSync.bind(this), [fdIndex, buffer].concat(_toConsumableArray(args.slice(0, cbIndex))), function (bytesRead) {
        return callback(null, bytesRead, buffer);
      }, callback);
      return;
    }
  }, {
    key: 'readSync',
    value: function readSync(fdIndex, buffer) {
      var offset = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
      var length = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 0;
      var position = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : null;

      var fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'read');
      }
      if (typeof position === 'number' && position < 0) {
        throw new VirtualFSError(errno_3.EINVAL, null, null, 'read');
      }
      if (fd.getINode().getMetadata().isDirectory()) {
        throw new VirtualFSError(errno_3.EISDIR, null, null, 'read');
      }
      var flags = fd.getFlags();
      if (flags & constants.O_WRONLY) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'read');
      }
      if (offset < 0 || offset > buffer.length) {
        throw new RangeError('Offset is out of bounds');
      }
      if (length < 0 || length > buffer.length) {
        throw new RangeError('Length extends beyond buffer');
      }
      buffer = this._getBuffer(buffer).slice(offset, offset + length);
      var bytesRead = void 0;
      try {
        bytesRead = fd.read(buffer, position);
      } catch (e) {
        if (e instanceof VirtualFSError) {
          e.syscall = 'read';
        }
        throw e;
      }
      return bytesRead;
    }
  }, {
    key: 'readdir',
    value: function readdir(path) {
      for (var _len13 = arguments.length, args = Array(_len13 > 1 ? _len13 - 1 : 0), _key13 = 1; _key13 < _len13; _key13++) {
        args[_key13 - 1] = arguments[_key13];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.readdirSync.bind(this), [path].concat(_toConsumableArray(args.slice(0, cbIndex))), function (files) {
        return callback(null, files);
      }, callback);
      return;
    }

    /*readdirSync (path: path, options?: options): Array<string|ArrayBuffer> {
      path = this._getPath(path);
      options = this._getOptions({encoding: 'utf8'}, options);
      let navigated = this._navigate(path, true);
      if (!navigated.target) {
        throw new VirtualFSError(errno.ENOENT, path, null, 'readdir');
      }
      if (!(navigated.target instanceof Directory)) {
        throw new VirtualFSError(errno.ENOTDIR, path, null, 'readdir');
      }
      if (!this._checkPermissions(constants.R_OK, navigated.target.getMetadata())) {
        throw new VirtualFSError(errno.EACCES, path, null, 'readdir');
      }
      return [...navigated.target.getEntries()]
        .filter(([name, _]) => name !== '.' && name !== '..')
        .map(([name, _]) => {
          // $FlowFixMe: options exists
          if (options.encoding === 'buffer') {
            return Buffer.from(name);
          } else {
            // $FlowFixMe: options exists and is not a string
            return Buffer.from(name).toString(options.encoding);
          }
        });
    }*/

  }, {
    key: 'readFile',
    value: function readFile(file) {
      for (var _len14 = arguments.length, args = Array(_len14 > 1 ? _len14 - 1 : 0), _key14 = 1; _key14 < _len14; _key14++) {
        args[_key14 - 1] = arguments[_key14];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.readFileSync.bind(this), [file].concat(_toConsumableArray(args.slice(0, cbIndex))), function (data) {
        return callback(null, data);
      }, callback);
      return;
    }
  }, {
    key: 'readFileSync',
    value: function readFileSync(file, options) {
      options = this._getOptions({ encoding: null, flag: 'r' }, options);
      var fdIndex = void 0;
      try {
        var buffer = new ArrayBuffer(4096);
        var totalBuffer = new ArrayBuffer(0);
        var bytesRead = null;
        if (typeof file === 'number') {
          while (bytesRead !== 0) {
            bytesRead = this.readSync(file, buffer, 0, buffer.length);
            totalBuffer = concat(totalBuffer, buffer.slice(0, bytesRead));
          }
        } else {
          fdIndex = this.openSync(file, options.flag);
          while (bytesRead !== 0) {
            bytesRead = this.readSync(fdIndex, buffer, 0, buffer.length);
            totalBuffer = concat(totalBuffer, buffer.slice(0, bytesRead));
          }
        }
        return options.encoding ? totalBuffer.toString(options.encoding) : totalBuffer;
      } finally {
        if (fdIndex !== undefined) this.closeSync(fdIndex);
      }
    }
  }, {
    key: 'readlink',
    value: function readlink(path) {
      for (var _len15 = arguments.length, args = Array(_len15 > 1 ? _len15 - 1 : 0), _key15 = 1; _key15 < _len15; _key15++) {
        args[_key15 - 1] = arguments[_key15];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.readlinkSync.bind(this), [path].concat(_toConsumableArray(args.slice(0, cbIndex))), function (linkString) {
        return callback(null, linkString);
      }, callback);
      return;
    }

    /*readlinkSync (path: path, options?: options): string|Buffer {
      path = this._getPath(path);
      options = this._getOptions({encoding: 'utf8'}, options);
      let target = this._navigate(path, false).target;
      if (!target) {
        throw new VirtualFSError(errno.ENOENT, path);
      }
      if (!(target instanceof Symlink)) {
        throw new VirtualFSError(errno.EINVAL, path);
      }
      const link = target.getLink();
      if (options.encoding === 'buffer') {
        return Buffer.from(link);
      } else {
        return Buffer.from(link).toString(options.encoding);
      }
    }*/

    /*realpath (path: path, ...args: Array<any>): void {
      let cbIndex = args.findIndex((arg) => typeof arg === 'function');
      const callback = args[cbIndex] || callbackUp;
      cbIndex = (cbIndex >= 0) ? cbIndex : args.length;
      this._callAsync(
        this.realpathSync.bind(this),
        [path, ...args.slice(0, cbIndex)],
        (path) => callback(null, path),
        callback
      );
      return;
    }*/

    /*realpathSync (path: path, options?: options): string|ArrayBuffer {
      path = this._getPath(path);
      options = this._getOptions({encoding: 'utf8'}, options);
      const navigated = this._navigate(path, true);
      if (!navigated.target) {
        throw new VirtualFSError(errno.ENOENT, path);
      }
      if (options.encoding === 'buffer') {
        return Buffer.from('/' + navigated.pathStack.join('/'));
      } else {
        return Buffer.from('/' + navigated.pathStack.join('/')).toString(options.encoding);
      }
    }*/

  }, {
    key: 'rename',
    value: function rename(oldPath, newPath) {
      var callback = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : callbackUp;

      this._callAsync(this.renameSync.bind(this), [oldPath, newPath], callback, callback);
      return;
    }
  }, {
    key: 'renameSync',
    value: function renameSync(oldPath, newPath) {
      oldPath = this._getPath(oldPath);
      newPath = this._getPath(newPath);
      var navigatedSource = this._navigate(oldPath, false);
      var navigatedTarget = this._navigate(newPath, false);
      if (!navigatedSource.target) {
        throw new VirtualFSError(errno_3.ENOENT, oldPath, newPath, 'rename');
      }
      if (navigatedSource.target instanceof Directory) {
        // if oldPath is a directory, target must be a directory (if it exists)
        if (navigatedTarget.target && !(navigatedTarget.target instanceof Directory)) {
          throw new VirtualFSError(errno_3.ENOTDIR, oldPath, newPath, 'rename');
        }
        // neither oldPath nor newPath can point to root
        if (navigatedSource.target === this._root || navigatedTarget.target === this._root) {
          throw new VirtualFSError(errno_3.EBUSY, oldPath, newPath, 'rename');
        }
        // if the target directory contains elements this cannot be done
        // this can be done without read permissions
        if (navigatedTarget.target && [].concat(_toConsumableArray(navigatedTarget.target.getEntries())).length - 2) {
          throw new VirtualFSError(errno_3.ENOTEMPTY, oldPath, newPath, 'rename');
        }
        // if any of the paths used .. or ., then `dir` is not the parent directory
        if (navigatedSource.name === '.' || navigatedSource.name === '..' || navigatedTarget.name === '.' || navigatedTarget.name === '..') {
          throw new VirtualFSError(errno_3.EBUSY, oldPath, newPath, 'rename');
        }
        // cannot rename a source prefix of target
        if (navigatedSource.pathStack.length < navigatedTarget.pathStack.length) {
          var prefixOf = true;
          for (var i = 0; i < navigatedSource.pathStack.length; ++i) {
            if (navigatedSource.pathStack[i] !== navigatedTarget.pathStack[i]) {
              prefixOf = false;
              break;
            }
          }
          if (prefixOf) {
            throw new VirtualFSError(errno_3.EINVAL, oldPath, newPath, 'rename');
          }
        }
      } else {
        // if oldPath is not a directory, then newPath cannot be an existing directory
        if (navigatedTarget.target && navigatedTarget.target instanceof Directory) {
          throw new VirtualFSError(errno_3.EISDIR, oldPath, newPath, 'rename');
        }
      }
      // both the navigatedSource.dir and navigatedTarget.dir must support write permissions
      if (!this._checkPermissions(constants.W_OK, navigatedSource.dir.getMetadata()) || !this._checkPermissions(constants.W_OK, navigatedTarget.dir.getMetadata())) {
        throw new VirtualFSError(errno_3.EACCES, oldPath, newPath, 'rename');
      }
      // if they are in the same directory, it is simple rename
      if (navigatedSource.dir === navigatedTarget.dir) {
        navigatedSource.dir.renameEntry(navigatedSource.name, navigatedTarget.name);
        return;
      }
      var index = navigatedSource.dir.getEntryIndex(navigatedSource.name);
      if (navigatedTarget.target) {
        navigatedTarget.target.getMetadata().ctime = new Date();
        navigatedTarget.dir.deleteEntry(navigatedTarget.name);
        navigatedTarget.dir.addEntry(navigatedTarget.name, index);
      } else {
        if (navigatedTarget.dir.getMetadata().nlink < 2) {
          throw new VirtualFSError(errno_3.ENOENT, oldPath, newPath, 'rename');
        }
        navigatedTarget.dir.addEntry(navigatedTarget.name, index);
      }
      navigatedSource.target.getMetadata().ctime = new Date();
      navigatedSource.dir.deleteEntry(navigatedSource.name);
      return;
    }
  }, {
    key: 'rmdir',
    value: function rmdir(path) {
      var callback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : callbackUp;

      this._callAsync(this.rmdirSync.bind(this), [path], callback, callback);
      return;
    }
  }, {
    key: 'rmdirSync',
    value: function rmdirSync(path) {
      path = this._getPath(path);
      // if the path has trailing slashes, navigation would traverse into it
      // we must trim off these trailing slashes to allow these directories to be removed
      path = path.replace(/(.+?)\/+$/, '$1');
      var navigated = this._navigate(path, false);
      // this is for if the path resolved to root
      if (!navigated.name) {
        throw new VirtualFSError(errno_3.EBUSY, path, null, 'rmdir');
      }
      // on linux, when .. is used, the parent directory becomes unknown
      // in that case, they return with ENOTEMPTY
      // but the directory may in fact be empty
      // for this edge case, we instead use EINVAL
      if (navigated.name === '.' || navigated.name === '..') {
        throw new VirtualFSError(errno_3.EINVAL, path, null, 'rmdir');
      }
      if (!navigated.target) {
        throw new VirtualFSError(errno_3.ENOENT, path, null, 'rmdir');
      }
      if (!(navigated.target instanceof Directory)) {
        throw new VirtualFSError(errno_3.ENOTDIR, path, null, 'rmdir');
      }
      if ([].concat(_toConsumableArray(navigated.target.getEntries())).length - 2) {
        throw new VirtualFSError(errno_3.ENOTEMPTY, path, null, 'rmdir');
      }
      if (!this._checkPermissions(constants.W_OK, navigated.dir.getMetadata())) {
        throw new VirtualFSError(errno_3.EACCES, path, null, 'rmdir');
      }
      navigated.dir.deleteEntry(navigated.name);
      return;
    }
  }, {
    key: 'stat',
    value: function stat(path) {
      var callback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : callbackUp;

      this._callAsync(this.statSync.bind(this), [path], function (stat) {
        return callback(null, stat);
      }, callback);
      return;
    }
  }, {
    key: 'statSync',
    value: function statSync(path) {
      path = this._getPath(path);
      var target = this._navigate(path, true).target;
      if (target) {
        return new Stat(_extends$1({}, target.getMetadata()));
      } else {
        throw new VirtualFSError(errno_3.ENOENT, path);
      }
    }
  }, {
    key: 'symlink',
    value: function symlink(dstPath, srcPath) {
      for (var _len16 = arguments.length, args = Array(_len16 > 2 ? _len16 - 2 : 0), _key16 = 2; _key16 < _len16; _key16++) {
        args[_key16 - 2] = arguments[_key16];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.symlinkSync.bind(this), [dstPath, srcPath].concat(_toConsumableArray(args.slice(0, cbIndex))), callback, callback);
      return;
    }
  }, {
    key: 'symlinkSync',
    value: function symlinkSync(dstPath, srcPath) {
      dstPath = this._getPath(dstPath);
      srcPath = this._getPath(srcPath);
      if (!dstPath) {
        throw new VirtualFSError(errno_3.ENOENT, srcPath, dstPath, 'symlink');
      }
      var navigated = this._navigate(srcPath, false);
      if (!navigated.target) {
        if (navigated.dir.getMetadata().nlink < 2) {
          throw new VirtualFSError(errno_3.ENOENT, srcPath, dstPath, 'symlink');
        }
        if (!this._checkPermissions(constants.W_OK, navigated.dir.getMetadata())) {
          throw new VirtualFSError(errno_3.EACCES, srcPath, dstPath, 'symlink');
        }

        var _iNodeMgr$createINode13 = this._iNodeMgr.createINode(Symlink, {
          mode: DEFAULT_SYMLINK_PERM,
          uid: this._uid,
          gid: this._gid,
          link: dstPath
        }),
            _iNodeMgr$createINode14 = _slicedToArray(_iNodeMgr$createINode13, 2),
            index = _iNodeMgr$createINode14[1];

        navigated.dir.addEntry(navigated.name, index);
        return;
      } else {
        throw new VirtualFSError(errno_3.EEXIST, srcPath, dstPath, 'symlink');
      }
    }
  }, {
    key: 'truncate',
    value: function truncate(file) {
      for (var _len17 = arguments.length, args = Array(_len17 > 1 ? _len17 - 1 : 0), _key17 = 1; _key17 < _len17; _key17++) {
        args[_key17 - 1] = arguments[_key17];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.truncateSync.bind(this), [file].concat(_toConsumableArray(args.slice(0, cbIndex))), callback, callback);
      return;
    }
  }, {
    key: 'truncateSync',
    value: function truncateSync(file) {
      var len = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;

      if (len < 0) {
        throw new VirtualFSError(errno_3.EINVAL, null, null, 'ftruncate');
      }
      if (typeof file === 'number') {
        this.ftruncateSync(file, len);
      } else {
        file = this._getPath(file);
        var fdIndex = void 0;
        try {
          fdIndex = this.openSync(file, constants.O_WRONLY);
          this.ftruncateSync(fdIndex, len);
        } finally {
          if (fdIndex !== undefined) this.closeSync(fdIndex);
        }
      }
      return;
    }
  }, {
    key: 'unlink',
    value: function unlink(path) {
      var callback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : callbackUp;

      this._callAsync(this.unlinkSync.bind(this), [path], callback, callback);
      return;
    }
  }, {
    key: 'unlinkSync',
    value: function unlinkSync(path) {
      path = this._getPath(path);
      var navigated = this._navigate(path, false);
      if (!navigated.target) {
        throw new VirtualFSError(errno_3.ENOENT, path);
      }
      if (!this._checkPermissions(constants.W_OK, navigated.dir.getMetadata())) {
        throw new VirtualFSError(errno_3.EACCES, path);
      }
      if (navigated.target instanceof Directory) {
        throw new VirtualFSError(errno_3.EISDIR, path);
      }
      navigated.target.getMetadata().ctime = new Date();
      navigated.dir.deleteEntry(navigated.name);
      return;
    }
  }, {
    key: 'utimes',
    value: function utimes(path, atime, mtime) {
      var callback = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : callbackUp;

      this._callAsync(this.utimesSync.bind(this), [path, atime, mtime], callback, callback);
      return;
    }
  }, {
    key: 'utimesSync',
    value: function utimesSync(path, atime, mtime) {
      path = this._getPath(path);
      var target = this._navigate(path, true).target;
      if (!target) {
        throw new VirtualFSError(errno_3.ENOENT, path, null, 'utimes');
      }
      var metadata = target.getMetadata();
      var newAtime = void 0;
      var newMtime = void 0;
      if (typeof atime === 'number') {
        newAtime = new Date(atime * 1000);
      } else if (typeof atime === 'string') {
        newAtime = new Date(parseInt(atime) * 1000);
      } else if (atime instanceof Date) {
        newAtime = atime;
      } else {
        throw TypeError('atime and mtime must be dates or unixtime in seconds');
      }
      if (typeof mtime === 'number') {
        newMtime = new Date(mtime * 1000);
      } else if (typeof mtime === 'string') {
        newMtime = new Date(parseInt(mtime) * 1000);
      } else if (mtime instanceof Date) {
        newMtime = mtime;
      } else {
        throw TypeError('atime and mtime must be dates or unixtime in seconds');
      }
      metadata.atime = newAtime;
      metadata.mtime = newMtime;
      metadata.ctime = new Date();
      return;
    }
  }, {
    key: 'write',
    value: function write(fdIndex, data) {
      for (var _len18 = arguments.length, args = Array(_len18 > 2 ? _len18 - 2 : 0), _key18 = 2; _key18 < _len18; _key18++) {
        args[_key18 - 2] = arguments[_key18];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.writeSync.bind(this), [fdIndex, data].concat(_toConsumableArray(args.slice(0, cbIndex))), function (bytesWritten) {
        return callback(null, bytesWritten, data);
      }, callback);
      return;
    }
  }, {
    key: 'writeSync',
    value: function writeSync(fdIndex, data, offsetOrPos, lengthOrEncoding) {
      var position = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : null;

      var fd = this._fdMgr.getFd(fdIndex);
      if (!fd) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'write');
      }
      if (typeof position === 'number' && position < 0) {
        throw new VirtualFSError(errno_3.EINVAL, null, null, 'write');
      }
      var flags = fd.getFlags();
      if (!(flags & (constants.O_WRONLY | constants.O_RDWR))) {
        throw new VirtualFSError(errno_3.EBADF, null, null, 'write');
      }
      var buffer = void 0;
      if (typeof data === 'string') {
        position = typeof offsetOrPos === 'number' ? offsetOrPos : null;
        lengthOrEncoding = typeof lengthOrEncoding === 'string' ? lengthOrEncoding : 'utf8';
        buffer = this._getBuffer(data, lengthOrEncoding);
      } else {
        offsetOrPos = typeof offsetOrPos === 'number' ? offsetOrPos : 0;
        if (offsetOrPos < 0 || offsetOrPos > data.length) {
          throw new RangeError('Offset is out of bounds');
        }
        lengthOrEncoding = typeof lengthOrEncoding === 'number' ? lengthOrEncoding : data.length;
        if (lengthOrEncoding < 0 || lengthOrEncoding > data.length) {
          throw new RangeError('Length is out of bounds');
        }
        buffer = this._getBuffer(data).slice(offsetOrPos, offsetOrPos + lengthOrEncoding);
      }
      try {
        return fd.write(buffer, position);
      } catch (e) {
        if (e instanceof RangeError) {
          throw new VirtualFSError(errno_3.EFBIG, null, null, 'write');
        }
        if (e instanceof VirtualFSError) {
          e.setSyscall('write');
        }
        throw e;
      }
    }
  }, {
    key: 'writeFile',
    value: function writeFile(file, data) {
      for (var _len19 = arguments.length, args = Array(_len19 > 2 ? _len19 - 2 : 0), _key19 = 2; _key19 < _len19; _key19++) {
        args[_key19 - 2] = arguments[_key19];
      }

      var cbIndex = args.findIndex(function (arg) {
        return typeof arg === 'function';
      });
      var callback = args[cbIndex] || callbackUp;
      cbIndex = cbIndex >= 0 ? cbIndex : args.length;
      this._callAsync(this.writeFileSync.bind(this), [file, data].concat(_toConsumableArray(args.slice(0, cbIndex))), callback, callback);
      return;
    }
  }, {
    key: 'writeFileSync',
    value: function writeFileSync(file) {
      var data = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 'undefined';
      var options = arguments[2];

      options = this._getOptions({
        encoding: 'utf8',
        mode: DEFAULT_FILE_PERM,
        flag: 'w'
      }, options);
      var fdIndex = void 0;
      try {
        var buffer = this._getBuffer(data, options.encoding);
        if (typeof file === 'number') {
          this.writeSync(file, buffer, 0, buffer.length, 0);
        } else {
          fdIndex = this.openSync(file, options.flag, options.mode);
          this.writeSync(fdIndex, buffer, 0, buffer.length, 0);
        }
      } finally {
        if (fdIndex !== undefined) this.closeSync(fdIndex);
      }
      return;
    }

    /**
     * Sets up an asynchronous call in accordance with Node behaviour.
     * This function should be implemented with microtask semantics.
     * Because the internal readable-stream package uses process.nextTick.
     * This must also use process.nextTick as well to be on the same queue.
     * It is required to polyfill the process.nextTick for browsers.
     * @private
     */

  }, {
    key: '_callAsync',
    value: function _callAsync(syncFn, args, successCall, failCall) {
      nextTick(function () {
        try {
          var result = syncFn.apply(undefined, _toConsumableArray(args));
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

  }, {
    key: '_getPath',
    value: function _getPath(path) {
      if (typeof path === 'string') {
        return path;
      }
      if (path instanceof ArrayBuffer) {
        return new TextDecoder().decode(path);
      }
      if ((typeof path === 'undefined' ? 'undefined' : _typeof(path)) === 'object' && typeof path.pathname === 'string') {
        return this._getPathFromURL(path);
      }
      throw new TypeError('path must be a string or Buffer or URL');
    }

    /**
     * Acquires the file path from an URL object.
     * @private
     */

  }, {
    key: '_getPathFromURL',
    value: function _getPathFromURL(url) {
      if (url.hostname) {
        throw new TypeError('ERR_INVALID_FILE_URL_HOST');
      }
      var pathname = url.pathname;
      if (pathname.match(/%2[fF]/)) {
        // must not allow encoded slashes
        throw new TypeError('ERR_INVALID_FILE_URL_PATH');
      }
      return decodeURIComponent(pathname);
    }

    /**
     * Processes data types and collapses it to a Buffer.
     * The data types can be Buffer or Uint8Array or string.
     * @private
     */
    /*_getBuffer (data: data, encoding: string|null = null): ArrayBuffer {
      if (data instanceof ArrayBuffer) {
        return data;
      }
      if (data instanceof Uint8Array) {
        // zero copy implementation
        // also sliced to the view's constraint
        return Buffer.from(data.buffer).slice(
          data.byteOffset,
          data.byteOffset + data.byteLength
        );
      }
      if (typeof data === 'string') {
        return Buffer.from(data, encoding);
      }
      throw new TypeError('data must be Buffer or Uint8Array or string');
    }*/

    /**
     * Takes a default set of options, and merges them shallowly into the user provided options.
     * Object spread syntax will ignore an undefined or null options object.
     * @private
     */

  }, {
    key: '_getOptions',
    value: function _getOptions(defaultOptions, options) {
      if (typeof options === 'string') {
        return _extends$1({}, defaultOptions, { encoding: options });
      } else {
        return _extends$1({}, defaultOptions, options);
      }
    }

    /**
     * Checks the permissions fixng the current uid and gid.
     * If the user is root, they can access anything.
     * @private
     */

  }, {
    key: '_checkPermissions',
    value: function _checkPermissions(access, stat) {
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

  }, {
    key: '_parsePath',
    value: function _parsePath(pathS) {
      var matches = pathS.match(/^([\s\S]*?)(?:\/+|$)([\s\S]*)/);
      if (matches) {
        var _segment = matches[1] || '';
        var _rest = matches[2] || '';
        return {
          segment: _segment,
          rest: _rest
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

  }, {
    key: '_navigate',
    value: function _navigate(pathS) {
      var resolveLinks = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;
      var origPathS = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : pathS;

      if (pathS === undefined) {
        throw new VirtualFSError(errno_3.ENOENT, origPathS);
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

  }, {
    key: '_navigateFrom',
    value: function _navigateFrom(curdir, pathS) {
      var resolveLinks = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;
      var pathStack = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : [];
      var origPathS = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : pathS;

      if (!pathS) {
        throw new VirtualFSError(errno_3.ENOENT, origPathS);
      }
      if (!this._checkPermissions(constants.X_OK, curdir.getMetadata())) {
        throw new VirtualFSError(errno_3.EACCES, origPathS);
      }
      var parse = this._parsePath(pathS);
      if (parse.segment !== '.') {
        if (parse.segment === '..') {
          pathStack.pop(); // this is a noop if the pathStack is empty
        } else {
          pathStack.push(parse.segment);
        }
      }
      var nextDir = void 0;
      var nextPath = void 0;
      var target = curdir.getEntry(parse.segment);
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
        throw new VirtualFSError(errno_3.ENOTDIR, origPathS);
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
  }]);

  return VirtualFS;
}();

var nullDev = {
  setPos: function setPos(fd, position, flags) {
    fd._pos = 0;
    return;
  },
  read: function read(fd, buffer, position) {
    return 0;
  },
  write: function write(fd, buffer, position, extraFlags) {
    return buffer.length;
  }
};

var zeroDev = {
  setPos: function setPos(fd, position, flags) {
    fd._pos = 0;
    return;
  },
  read: function read(fd, buffer, position) {
    buffer.fill(0);
    return buffer.length;
  },
  write: function write(fd, buffer, position, extraFlags) {
    return buffer.length;
  }
};

/** @module Full */

var fullDev = {
  setPos: function setPos(fd, position, flags) {
    fd._pos = 0;
    return;
  },
  read: function read(fd, buffer, position) {
    buffer.fill(0);
    return buffer.length;
  },
  write: function write(fd, buffer, position, extraFlags) {
    throw new VirtualFSError(errno_3.ENOSPC);
  }
};

var win;

if (typeof window !== "undefined") {
    win = window;
} else if (typeof commonjsGlobal !== "undefined") {
    win = commonjsGlobal;
} else if (typeof self !== "undefined"){
    win = self;
} else {
    win = {};
}

var window_1 = win;

var empty$1 = {};


var empty$2 = Object.freeze({
	default: empty$1
});

var nodeCrypto = ( empty$2 && empty$1 ) || empty$2;

function getRandomValues(buf) {
  if (window_1.crypto && window_1.crypto.getRandomValues) {
    return window_1.crypto.getRandomValues(buf);
  }
  if (typeof window_1.msCrypto === 'object' && typeof window_1.msCrypto.getRandomValues === 'function') {
    return window_1.msCrypto.getRandomValues(buf);
  }
  if (nodeCrypto.randomBytes) {
    if (!(buf instanceof Uint8Array)) {
      throw new TypeError('expected Uint8Array');
    }
    if (buf.length > 65536) {
      var e = new Error();
      e.code = 22;
      e.message = 'Failed to execute \'getRandomValues\' on \'Crypto\': The ' +
        'ArrayBufferView\'s byte length (' + buf.length + ') exceeds the ' +
        'number of bytes of entropy available via this API (65536).';
      e.name = 'QuotaExceededError';
      throw e;
    }
    var bytes = nodeCrypto.randomBytes(buf.length);
    buf.set(bytes);
    return buf;
  }
  else {
    throw new Error('No secure random number generator available.');
  }
}

var getRandomValues_1 = getRandomValues;

/**
 * Generates a cryptographically secure octet.
 *
 * @returns {number} A cryptographically secure octet
 */
function secureRandomOctet() {
  var buf = new Uint8Array(1);
  getRandomValues_1(buf);
  return buf[0];
}

var secureRandomOctet_1 = secureRandomOctet;

function randomBytes(length) {
  var result = '';
  for (var i = 0; i < length; i++) {
    result += String.fromCharCode(secureRandomOctet_1());
  }
  return result;
}

var secureRandomBytes = randomBytes;

/** @module Random */

var randomDev = {
  setPos: function setPos(fd, position, flags) {
    fd._pos = 0;
    return;
  },
  read: function read(fd, buffer, position) {
    var randomBuf = Buffer.from(secureRandomBytes(buffer.length), 'ascii');
    randomBuf.copy(buffer);
    return randomBuf.length;
  },
  write: function write(fd, buffer, position, extraFlags) {
    return buffer.length;
  }
};

/** @module VirtualFSSingleton */

var devMgr = new DeviceManager();

devMgr.registerChr(nullDev, 1, 3);
devMgr.registerChr(zeroDev, 1, 5);
devMgr.registerChr(fullDev, 1, 7);
devMgr.registerChr(randomDev, 1, 8);
devMgr.registerChr(randomDev, 1, 9);

var fs = new VirtualFS(undefined, undefined, devMgr);

fs.mkdirSync('/dev');
fs.chmodSync('/dev', 509);

fs.mknodSync('/dev/null', constants.S_IFCHR, 1, 3);
fs.mknodSync('/dev/zero', constants.S_IFCHR, 1, 5);
fs.mknodSync('/dev/full', constants.S_IFCHR, 1, 7);
fs.mknodSync('/dev/random', constants.S_IFCHR, 1, 8);
fs.mknodSync('/dev/urandom', constants.S_IFCHR, 1, 9);
fs.chmodSync('/dev/null', 438);
fs.chmodSync('/dev/zero', 438);
fs.chmodSync('/dev/full', 438);
fs.chmodSync('/dev/random', 438);
fs.chmodSync('/dev/urandom', 438);

// tty0 points to the currently active virtual console (on linux this is usually tty1 or tty7)
// tty points to the currently active console (physical, virtual or pseudo)
// console points to the system console (it defaults to tty0)
// refer to the tty character device to understand its implementation
fs.mkdirSync('/tmp');
fs.chmodSync('/tmp', 511);

fs.mkdirSync('/root');
fs.chmodSync('/root', 448);

export { VirtualFS, Stat, constants, nullDev, zeroDev, fullDev, randomDev, Buffer, nextTick, VirtualFSError, errno_3 as errno, MAJOR_BITSIZE, MINOR_BITSIZE, MAJOR_MAX, MINOR_MAX, MAJOR_MIN, MINOR_MIN, DeviceManager, DeviceError, mkDev, unmkDev, File, Directory, Symlink, CharacterDev, INodeManager, Fifo, FileDescriptor, FileDescriptorManager, ReadStream, WriteStream, DEFAULT_ROOT_UID, DEFAULT_ROOT_GID, DEFAULT_ROOT_PERM, DEFAULT_FILE_PERM, DEFAULT_DIRECTORY_PERM, DEFAULT_SYMLINK_PERM, applyUmask, checkPermissions };
export default fs;
