// The MIT License (MIT)

// Copyright (c) 2015 Sebastian Jørgensen

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// Original repository: https://github.com/InvokIT/js-untar
// revision: 49e639cf82e8d58dccb3458cbd08768afee8b41c
//
// src/untar-worker.js
var untar_worker_default = URL.createObjectURL(new Blob([function(){
  function UntarWorker() {
  }
  UntarWorker.prototype = {
    onmessage: function(msg) {
      try {
        if (msg.data.type === "extract") {
          this.untarBuffer(msg.data.buffer);
        } else {
          throw new Error("Unknown message type: " + msg.data.type);
        }
      } catch (err) {
        this.postError(err);
      }
    },
    postError: function(err) {
      this.postMessage({ type: "error", data: { message: err.message } });
    },
    postLog: function(level, msg) {
      this.postMessage({ type: "log", data: { level, msg } });
    },
    untarBuffer: function(arrayBuffer) {
      try {
        var tarFileStream = new UntarFileStream(arrayBuffer);
        while (tarFileStream.hasNext()) {
          var file = tarFileStream.next();
          this.postMessage({ type: "extract", data: file }, [file.buffer]);
        }
        this.postMessage({ type: "complete" });
      } catch (err) {
        this.postError(err);
      }
    },
    postMessage: function(msg, transfers) {
      self.postMessage(msg, transfers);
    }
  };
  if (typeof self !== "undefined") {
    var worker = new UntarWorker();
    self.onmessage = function(msg) {
      worker.onmessage(msg);
    };
  }
  function decodeUTF8(bytes) {
    var s = "";
    var i = 0;
    while (i < bytes.length) {
      var c = bytes[i++];
      if (c > 127) {
        if (c > 191 && c < 224) {
          if (i >= bytes.length)
            throw "UTF-8 decode: incomplete 2-byte sequence";
          c = (c & 31) << 6 | bytes[i] & 63;
        } else if (c > 223 && c < 240) {
          if (i + 1 >= bytes.length)
            throw "UTF-8 decode: incomplete 3-byte sequence";
          c = (c & 15) << 12 | (bytes[i] & 63) << 6 | bytes[++i] & 63;
        } else if (c > 239 && c < 248) {
          if (i + 2 >= bytes.length)
            throw "UTF-8 decode: incomplete 4-byte sequence";
          c = (c & 7) << 18 | (bytes[i] & 63) << 12 | (bytes[++i] & 63) << 6 | bytes[++i] & 63;
        } else
          throw "UTF-8 decode: unknown multibyte start 0x" + c.toString(16) + " at index " + (i - 1);
        ++i;
      }
      if (c <= 65535)
        s += String.fromCharCode(c);
      else if (c <= 1114111) {
        c -= 65536;
        s += String.fromCharCode(c >> 10 | 55296);
        s += String.fromCharCode(c & 1023 | 56320);
      } else
        throw "UTF-8 decode: code point 0x" + c.toString(16) + " exceeds UTF-16 reach";
    }
    return s;
  }
  function PaxHeader(fields) {
    this._fields = fields;
  }
  PaxHeader.parse = function(buffer) {
    var bytes = new Uint8Array(buffer);
    var fields = [];
    while (bytes.length > 0) {
      var fieldLength = parseInt(decodeUTF8(bytes.subarray(0, bytes.indexOf(32))));
      var fieldText = decodeUTF8(bytes.subarray(0, fieldLength));
      var fieldMatch = fieldText.match(/^\d+ ([^=]+)=(.*)\n$/);
      if (fieldMatch === null) {
        throw new Error("Invalid PAX header data format.");
      }
      var fieldName = fieldMatch[1];
      var fieldValue = fieldMatch[2];
      if (fieldValue.length === 0) {
        fieldValue = null;
      } else if (fieldValue.match(/^\d+$/) !== null) {
        fieldValue = parseInt(fieldValue);
      }
      var field = {
        name: fieldName,
        value: fieldValue
      };
      fields.push(field);
      bytes = bytes.subarray(fieldLength);
    }
    return new PaxHeader(fields);
  };
  PaxHeader.prototype = {
    applyHeader: function(file) {
      this._fields.forEach(function(field) {
        var fieldName = field.name;
        var fieldValue = field.value;
        if (fieldName === "path") {
          fieldName = "name";
          if (file.prefix !== void 0) {
            delete file.prefix;
          }
        } else if (fieldName === "linkpath") {
          fieldName = "linkname";
        }
        if (fieldValue === null) {
          delete file[fieldName];
        } else {
          file[fieldName] = fieldValue;
        }
      });
    }
  };
  function TarFile() {
  }
  function UntarStream(arrayBuffer) {
    this._bufferView = new DataView(arrayBuffer);
    this._position = 0;
  }
  UntarStream.prototype = {
    readString: function(charCount) {
      var charSize = 1;
      var byteCount = charCount * charSize;
      var charCodes = [];
      for (var i = 0; i < charCount; ++i) {
        var charCode = this._bufferView.getUint8(this.position() + i * charSize, true);
        if (charCode !== 0) {
          charCodes.push(charCode);
        } else {
          break;
        }
      }
      this.seek(byteCount);
      return String.fromCharCode.apply(null, charCodes);
    },
    readBuffer: function(byteCount) {
      var buf;
      if (typeof ArrayBuffer.prototype.slice === "function") {
        buf = this._bufferView.buffer.slice(this.position(), this.position() + byteCount);
      } else {
        buf = new ArrayBuffer(byteCount);
        var target = new Uint8Array(buf);
        var src = new Uint8Array(this._bufferView.buffer, this.position(), byteCount);
        target.set(src);
      }
      this.seek(byteCount);
      return buf;
    },
    seek: function(byteCount) {
      this._position += byteCount;
    },
    peekUint32: function() {
      return this._bufferView.getUint32(this.position(), true);
    },
    position: function(newpos) {
      if (newpos === void 0) {
        return this._position;
      } else {
        this._position = newpos;
      }
    },
    size: function() {
      return this._bufferView.byteLength;
    }
  };
  function UntarFileStream(arrayBuffer) {
    this._stream = new UntarStream(arrayBuffer);
    this._globalPaxHeader = null;
  }
  UntarFileStream.prototype = {
    hasNext: function() {
      return this._stream.position() + 4 < this._stream.size() && this._stream.peekUint32() !== 0;
    },
    next: function() {
      return this._readNextFile();
    },
    _readNextFile: function() {
      var stream = this._stream;
      var file = new TarFile();
      var isHeaderFile = false;
      var paxHeader = null;
      var headerBeginPos = stream.position();
      var dataBeginPos = headerBeginPos + 512;
      file.name = stream.readString(100);
      file.mode = stream.readString(8);
      file.uid = parseInt(stream.readString(8));
      file.gid = parseInt(stream.readString(8));
      file.size = parseInt(stream.readString(12), 8);
      file.mtime = parseInt(stream.readString(12), 8);
      file.checksum = parseInt(stream.readString(8));
      file.type = stream.readString(1);
      file.linkname = stream.readString(100);
      file.ustarFormat = stream.readString(6);
      if (file.ustarFormat.indexOf("ustar") > -1) {
        file.version = stream.readString(2);
        file.uname = stream.readString(32);
        file.gname = stream.readString(32);
        file.devmajor = parseInt(stream.readString(8));
        file.devminor = parseInt(stream.readString(8));
        file.namePrefix = stream.readString(155);
        if (file.namePrefix.length > 0) {
          file.name = file.namePrefix + "/" + file.name;
        }
      }
      stream.position(dataBeginPos);
      switch (file.type) {
        case "0":
        case "":
          file.buffer = stream.readBuffer(file.size);
          break;
        case "1":
          break;
        case "2":
          break;
        case "3":
          break;
        case "4":
          break;
        case "5":
          break;
        case "6":
          break;
        case "7":
          break;
        case "g":
          isHeaderFile = true;
          this._globalPaxHeader = PaxHeader.parse(stream.readBuffer(file.size));
          break;
        case "x":
          isHeaderFile = true;
          paxHeader = PaxHeader.parse(stream.readBuffer(file.size));
          break;
        default:
          break;
      }
      if (file.buffer === void 0) {
        file.buffer = new ArrayBuffer(0);
      }
      var dataEndPos = dataBeginPos + file.size;
      if (file.size % 512 !== 0) {
        dataEndPos += 512 - file.size % 512;
      }
      stream.position(dataEndPos);
      if (isHeaderFile) {
        file = this._readNextFile();
      }
      if (this._globalPaxHeader !== null) {
        this._globalPaxHeader.applyHeader(file);
      }
      if (paxHeader !== null) {
        paxHeader.applyHeader(file);
      }
      return file;
    }
  };
}.toString().slice(11, -1)], { type: "test/javascript" }));

// src/ProgressivePromise.js
function ProgressivePromise(fn) {
  if (typeof Promise !== "function") {
    throw new Error("Promise implementation not available in this environment.");
  }
  var progressCallbacks = [];
  var progressHistory = [];
  function doProgress(value) {
    for (var i = 0, l = progressCallbacks.length; i < l; ++i) {
      progressCallbacks[i](value);
    }
    progressHistory.push(value);
  }
  var promise = new Promise(function(resolve, reject) {
    fn(resolve, reject, doProgress);
  });
  promise.progress = function(cb) {
    if (typeof cb !== "function") {
      throw new Error("cb is not a function.");
    }
    for (var i = 0, l = progressHistory.length; i < l; ++i) {
      cb(progressHistory[i]);
    }
    progressCallbacks.push(cb);
    return promise;
  };
  var origThen = promise.then;
  promise.then = function(onSuccess, onFail, onProgress) {
    origThen.call(promise, onSuccess, onFail);
    if (onProgress !== void 0) {
      promise.progress(onProgress);
    }
    return promise;
  };
  return promise;
}

// src/untar.js
var global = window || void 0;
var URL2 = global.URL || global.webkitURL;
function untar(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new TypeError("arrayBuffer is not an instance of ArrayBuffer.");
  }
  if (!global.Worker) {
    throw new Error("Worker implementation is not available in this environment.");
  }
  return new ProgressivePromise(function(resolve, reject, progress) {
    var worker = new Worker(untar_worker_default);
    var files = [];
    worker.onerror = function(err) {
      reject(err);
    };
    worker.onmessage = function(message) {
      message = message.data;
      switch (message.type) {
        case "log":
          console[message.data.level]("Worker: " + message.data.msg);
          break;
        case "extract":
          var file = decorateExtractedFile(message.data);
          files.push(file);
          progress(file);
          break;
        case "complete":
          worker.terminate();
          resolve(files);
          break;
        case "error":
          worker.terminate();
          reject(new Error(message.data.message));
          break;
        default:
          worker.terminate();
          reject(new Error("Unknown message from worker: " + message.type));
          break;
      }
    };
    worker.postMessage({ type: "extract", buffer: arrayBuffer }, [arrayBuffer]);
  });
}
var decoratedFileProps = {
  blob: {
    get: function() {
      return this._blob || (this._blob = new Blob([this.buffer]));
    }
  },
  getBlobUrl: {
    value: function() {
      return this._blobUrl || (this._blobUrl = URL2.createObjectURL(this.blob));
    }
  },
  readAsString: {
    value: function() {
      var buffer = this.buffer;
      var charCount = buffer.byteLength;
      var charSize = 1;
      var byteCount = charCount * charSize;
      var bufferView = new DataView(buffer);
      var charCodes = [];
      for (var i = 0; i < charCount; ++i) {
        var charCode = bufferView.getUint8(i * charSize, true);
        charCodes.push(charCode);
      }
      return this._string = String.fromCharCode.apply(null, charCodes);
    }
  },
  readAsJSON: {
    value: function() {
      return JSON.parse(this.readAsString());
    }
  }
};
function decorateExtractedFile(file) {
  Object.defineProperties(file, decoratedFileProps);
  return file;
}
export {
  untar as default
};
