var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/path-browserify/index.js
var require_path_browserify = __commonJS({
  "node_modules/path-browserify/index.js"(exports, module) {
    "use strict";
    function assertPath(path2) {
      if (typeof path2 !== "string") {
        throw new TypeError("Path must be a string. Received " + JSON.stringify(path2));
      }
    }
    function normalizeStringPosix(path2, allowAboveRoot) {
      var res = "";
      var lastSegmentLength = 0;
      var lastSlash = -1;
      var dots = 0;
      var code;
      for (var i = 0; i <= path2.length; ++i) {
        if (i < path2.length)
          code = path2.charCodeAt(i);
        else if (code === 47)
          break;
        else
          code = 47;
        if (code === 47) {
          if (lastSlash === i - 1 || dots === 1) {
          } else if (lastSlash !== i - 1 && dots === 2) {
            if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 || res.charCodeAt(res.length - 2) !== 46) {
              if (res.length > 2) {
                var lastSlashIndex = res.lastIndexOf("/");
                if (lastSlashIndex !== res.length - 1) {
                  if (lastSlashIndex === -1) {
                    res = "";
                    lastSegmentLength = 0;
                  } else {
                    res = res.slice(0, lastSlashIndex);
                    lastSegmentLength = res.length - 1 - res.lastIndexOf("/");
                  }
                  lastSlash = i;
                  dots = 0;
                  continue;
                }
              } else if (res.length === 2 || res.length === 1) {
                res = "";
                lastSegmentLength = 0;
                lastSlash = i;
                dots = 0;
                continue;
              }
            }
            if (allowAboveRoot) {
              if (res.length > 0)
                res += "/..";
              else
                res = "..";
              lastSegmentLength = 2;
            }
          } else {
            if (res.length > 0)
              res += "/" + path2.slice(lastSlash + 1, i);
            else
              res = path2.slice(lastSlash + 1, i);
            lastSegmentLength = i - lastSlash - 1;
          }
          lastSlash = i;
          dots = 0;
        } else if (code === 46 && dots !== -1) {
          ++dots;
        } else {
          dots = -1;
        }
      }
      return res;
    }
    function _format(sep, pathObject) {
      var dir = pathObject.dir || pathObject.root;
      var base = pathObject.base || (pathObject.name || "") + (pathObject.ext || "");
      if (!dir) {
        return base;
      }
      if (dir === pathObject.root) {
        return dir + base;
      }
      return dir + sep + base;
    }
    var posix = {
      // path.resolve([from ...], to)
      resolve: function resolve() {
        var resolvedPath = "";
        var resolvedAbsolute = false;
        var cwd;
        for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
          var path2;
          if (i >= 0)
            path2 = arguments[i];
          else {
            if (cwd === void 0)
              cwd = process.cwd();
            path2 = cwd;
          }
          assertPath(path2);
          if (path2.length === 0) {
            continue;
          }
          resolvedPath = path2 + "/" + resolvedPath;
          resolvedAbsolute = path2.charCodeAt(0) === 47;
        }
        resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute);
        if (resolvedAbsolute) {
          if (resolvedPath.length > 0)
            return "/" + resolvedPath;
          else
            return "/";
        } else if (resolvedPath.length > 0) {
          return resolvedPath;
        } else {
          return ".";
        }
      },
      normalize: function normalize2(path2) {
        assertPath(path2);
        if (path2.length === 0) return ".";
        var isAbsolute = path2.charCodeAt(0) === 47;
        var trailingSeparator = path2.charCodeAt(path2.length - 1) === 47;
        path2 = normalizeStringPosix(path2, !isAbsolute);
        if (path2.length === 0 && !isAbsolute) path2 = ".";
        if (path2.length > 0 && trailingSeparator) path2 += "/";
        if (isAbsolute) return "/" + path2;
        return path2;
      },
      isAbsolute: function isAbsolute(path2) {
        assertPath(path2);
        return path2.length > 0 && path2.charCodeAt(0) === 47;
      },
      join: function join() {
        if (arguments.length === 0)
          return ".";
        var joined;
        for (var i = 0; i < arguments.length; ++i) {
          var arg = arguments[i];
          assertPath(arg);
          if (arg.length > 0) {
            if (joined === void 0)
              joined = arg;
            else
              joined += "/" + arg;
          }
        }
        if (joined === void 0)
          return ".";
        return posix.normalize(joined);
      },
      relative: function relative(from, to) {
        assertPath(from);
        assertPath(to);
        if (from === to) return "";
        from = posix.resolve(from);
        to = posix.resolve(to);
        if (from === to) return "";
        var fromStart = 1;
        for (; fromStart < from.length; ++fromStart) {
          if (from.charCodeAt(fromStart) !== 47)
            break;
        }
        var fromEnd = from.length;
        var fromLen = fromEnd - fromStart;
        var toStart = 1;
        for (; toStart < to.length; ++toStart) {
          if (to.charCodeAt(toStart) !== 47)
            break;
        }
        var toEnd = to.length;
        var toLen = toEnd - toStart;
        var length = fromLen < toLen ? fromLen : toLen;
        var lastCommonSep = -1;
        var i = 0;
        for (; i <= length; ++i) {
          if (i === length) {
            if (toLen > length) {
              if (to.charCodeAt(toStart + i) === 47) {
                return to.slice(toStart + i + 1);
              } else if (i === 0) {
                return to.slice(toStart + i);
              }
            } else if (fromLen > length) {
              if (from.charCodeAt(fromStart + i) === 47) {
                lastCommonSep = i;
              } else if (i === 0) {
                lastCommonSep = 0;
              }
            }
            break;
          }
          var fromCode = from.charCodeAt(fromStart + i);
          var toCode = to.charCodeAt(toStart + i);
          if (fromCode !== toCode)
            break;
          else if (fromCode === 47)
            lastCommonSep = i;
        }
        var out = "";
        for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
          if (i === fromEnd || from.charCodeAt(i) === 47) {
            if (out.length === 0)
              out += "..";
            else
              out += "/..";
          }
        }
        if (out.length > 0)
          return out + to.slice(toStart + lastCommonSep);
        else {
          toStart += lastCommonSep;
          if (to.charCodeAt(toStart) === 47)
            ++toStart;
          return to.slice(toStart);
        }
      },
      _makeLong: function _makeLong(path2) {
        return path2;
      },
      dirname: function dirname(path2) {
        assertPath(path2);
        if (path2.length === 0) return ".";
        var code = path2.charCodeAt(0);
        var hasRoot = code === 47;
        var end = -1;
        var matchedSlash = true;
        for (var i = path2.length - 1; i >= 1; --i) {
          code = path2.charCodeAt(i);
          if (code === 47) {
            if (!matchedSlash) {
              end = i;
              break;
            }
          } else {
            matchedSlash = false;
          }
        }
        if (end === -1) return hasRoot ? "/" : ".";
        if (hasRoot && end === 1) return "//";
        return path2.slice(0, end);
      },
      basename: function basename(path2, ext) {
        if (ext !== void 0 && typeof ext !== "string") throw new TypeError('"ext" argument must be a string');
        assertPath(path2);
        var start = 0;
        var end = -1;
        var matchedSlash = true;
        var i;
        if (ext !== void 0 && ext.length > 0 && ext.length <= path2.length) {
          if (ext.length === path2.length && ext === path2) return "";
          var extIdx = ext.length - 1;
          var firstNonSlashEnd = -1;
          for (i = path2.length - 1; i >= 0; --i) {
            var code = path2.charCodeAt(i);
            if (code === 47) {
              if (!matchedSlash) {
                start = i + 1;
                break;
              }
            } else {
              if (firstNonSlashEnd === -1) {
                matchedSlash = false;
                firstNonSlashEnd = i + 1;
              }
              if (extIdx >= 0) {
                if (code === ext.charCodeAt(extIdx)) {
                  if (--extIdx === -1) {
                    end = i;
                  }
                } else {
                  extIdx = -1;
                  end = firstNonSlashEnd;
                }
              }
            }
          }
          if (start === end) end = firstNonSlashEnd;
          else if (end === -1) end = path2.length;
          return path2.slice(start, end);
        } else {
          for (i = path2.length - 1; i >= 0; --i) {
            if (path2.charCodeAt(i) === 47) {
              if (!matchedSlash) {
                start = i + 1;
                break;
              }
            } else if (end === -1) {
              matchedSlash = false;
              end = i + 1;
            }
          }
          if (end === -1) return "";
          return path2.slice(start, end);
        }
      },
      extname: function extname(path2) {
        assertPath(path2);
        var startDot = -1;
        var startPart = 0;
        var end = -1;
        var matchedSlash = true;
        var preDotState = 0;
        for (var i = path2.length - 1; i >= 0; --i) {
          var code = path2.charCodeAt(i);
          if (code === 47) {
            if (!matchedSlash) {
              startPart = i + 1;
              break;
            }
            continue;
          }
          if (end === -1) {
            matchedSlash = false;
            end = i + 1;
          }
          if (code === 46) {
            if (startDot === -1)
              startDot = i;
            else if (preDotState !== 1)
              preDotState = 1;
          } else if (startDot !== -1) {
            preDotState = -1;
          }
        }
        if (startDot === -1 || end === -1 || // We saw a non-dot character immediately before the dot
        preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
        preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
          return "";
        }
        return path2.slice(startDot, end);
      },
      format: function format(pathObject) {
        if (pathObject === null || typeof pathObject !== "object") {
          throw new TypeError('The "pathObject" argument must be of type Object. Received type ' + typeof pathObject);
        }
        return _format("/", pathObject);
      },
      parse: function parse(path2) {
        assertPath(path2);
        var ret = { root: "", dir: "", base: "", ext: "", name: "" };
        if (path2.length === 0) return ret;
        var code = path2.charCodeAt(0);
        var isAbsolute = code === 47;
        var start;
        if (isAbsolute) {
          ret.root = "/";
          start = 1;
        } else {
          start = 0;
        }
        var startDot = -1;
        var startPart = 0;
        var end = -1;
        var matchedSlash = true;
        var i = path2.length - 1;
        var preDotState = 0;
        for (; i >= start; --i) {
          code = path2.charCodeAt(i);
          if (code === 47) {
            if (!matchedSlash) {
              startPart = i + 1;
              break;
            }
            continue;
          }
          if (end === -1) {
            matchedSlash = false;
            end = i + 1;
          }
          if (code === 46) {
            if (startDot === -1) startDot = i;
            else if (preDotState !== 1) preDotState = 1;
          } else if (startDot !== -1) {
            preDotState = -1;
          }
        }
        if (startDot === -1 || end === -1 || // We saw a non-dot character immediately before the dot
        preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
        preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
          if (end !== -1) {
            if (startPart === 0 && isAbsolute) ret.base = ret.name = path2.slice(1, end);
            else ret.base = ret.name = path2.slice(startPart, end);
          }
        } else {
          if (startPart === 0 && isAbsolute) {
            ret.name = path2.slice(1, startDot);
            ret.base = path2.slice(1, end);
          } else {
            ret.name = path2.slice(startPart, startDot);
            ret.base = path2.slice(startPart, end);
          }
          ret.ext = path2.slice(startDot, end);
        }
        if (startPart > 0) ret.dir = path2.slice(0, startPart - 1);
        else if (isAbsolute) ret.dir = "/";
        return ret;
      },
      sep: "/",
      delimiter: ":",
      win32: null,
      posix: null
    };
    posix.posix = posix;
    module.exports = posix;
  }
});

// node_modules/queue-microtask/index.js
var require_queue_microtask = __commonJS({
  "node_modules/queue-microtask/index.js"(exports, module) {
    var promise;
    module.exports = typeof queueMicrotask === "function" ? queueMicrotask.bind(typeof window !== "undefined" ? window : global) : (cb) => (promise || (promise = Promise.resolve())).then(cb).catch((err) => setTimeout(() => {
      throw err;
    }, 0));
  }
});

// node_modules/uint8-util/dist/src/util.js
var decoder = new TextDecoder();
var arr2text = (data, enc) => {
  if (!enc)
    return decoder.decode(data);
  const dec = new TextDecoder(enc);
  return dec.decode(data);
};
function concat(chunks, size = 0) {
  const length = chunks.length;
  if (!size)
    for (let i = 0; i < length; i++)
      size += chunks[i].length;
  const b = new Uint8Array(size);
  let offset = 0;
  for (let i = 0; i < length; i++) {
    b.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  return b;
}

// node_modules/uint8-util/dist/src/browser.js
var alphabet = "0123456789abcdef";
var encodeLookup = [];
var decodeLookup = new Uint8Array(128);
for (let i = 0; i < 16; ++i) {
  const i16 = i * 16;
  for (let j = 0; j < 16; ++j) {
    encodeLookup[i16 + j] = alphabet[i] + alphabet[j];
  }
  if (i < 10) {
    decodeLookup[48 + i] = i;
  } else {
    decodeLookup[97 - 10 + i] = i;
    decodeLookup[65 - 10 + i] = i;
  }
}
var arr2hex = (data) => data.toHex();
var hex2arr = (str) => {
  const len = str.length;
  if (len > 64)
    return Uint8Array.fromHex(str);
  const out = new Uint8Array(len >> 1);
  let j = 0;
  let i = 0;
  while (i < len) {
    out[j++] = decodeLookup[str.charCodeAt(i++)] << 4 | decodeLookup[str.charCodeAt(i++)];
  }
  return out;
};
var encoder = new TextEncoder();
var text2arr = (str) => encoder.encode(str);
var arr2base = (bytes) => bytes.toBase64();
var formatMap = {
  hex: arr2hex,
  base64: arr2base
};
async function hash(data, format, algo = "sha-1") {
  if (typeof data === "string")
    data = text2arr(data);
  const out = new Uint8Array(await crypto.subtle.digest(algo, data));
  return format ? formatMap[format](out) : out;
}

// node_modules/bencode/lib/util.js
function digitCount(value) {
  const sign = value < 0 ? 1 : 0;
  value = Math.abs(Number(value || 1));
  return Math.floor(Math.log10(value)) + 1 + sign;
}
function getType(value) {
  if (ArrayBuffer.isView(value)) return "arraybufferview";
  if (Array.isArray(value)) return "array";
  if (value instanceof Number) return "number";
  if (value instanceof Boolean) return "boolean";
  if (value instanceof Set) return "set";
  if (value instanceof Map) return "map";
  if (value instanceof String) return "string";
  if (value instanceof ArrayBuffer) return "arraybuffer";
  return typeof value;
}

// node_modules/bencode/lib/encode.js
function encode(data, buffer, offset) {
  const buffers = [];
  let result = null;
  encode._encode(buffers, data);
  result = concat(buffers);
  encode.bytes = result.length;
  if (ArrayBuffer.isView(buffer)) {
    buffer.set(result, offset);
    return buffer;
  }
  return result;
}
encode.bytes = -1;
encode._floatConversionDetected = false;
encode._encode = function(buffers, data) {
  if (data == null) {
    return;
  }
  switch (getType(data)) {
    case "object":
      encode.dict(buffers, data);
      break;
    case "map":
      encode.dictMap(buffers, data);
      break;
    case "array":
      encode.list(buffers, data);
      break;
    case "set":
      encode.listSet(buffers, data);
      break;
    case "string":
      encode.string(buffers, data);
      break;
    case "number":
      encode.number(buffers, data);
      break;
    case "boolean":
      encode.number(buffers, data);
      break;
    case "arraybufferview":
      encode.buffer(buffers, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      break;
    case "arraybuffer":
      encode.buffer(buffers, new Uint8Array(data));
      break;
  }
};
var buffE = new Uint8Array([101]);
var buffD = new Uint8Array([100]);
var buffL = new Uint8Array([108]);
encode.buffer = function(buffers, data) {
  buffers.push(text2arr(data.length + ":"), data);
};
encode.string = function(buffers, data) {
  buffers.push(text2arr(text2arr(data).byteLength + ":" + data));
};
encode.number = function(buffers, data) {
  if (Number.isInteger(data)) return buffers.push(text2arr("i" + BigInt(data) + "e"));
  const maxLo = 2147483648;
  const hi = data / maxLo << 0;
  const lo = data % maxLo << 0;
  const val = hi * maxLo + lo;
  buffers.push(text2arr("i" + val + "e"));
  if (val !== data && !encode._floatConversionDetected) {
    encode._floatConversionDetected = true;
    console.warn(
      'WARNING: Possible data corruption detected with value "' + data + '":',
      'Bencoding only defines support for integers, value was converted to "' + val + '"'
    );
    console.trace();
  }
};
encode.dict = function(buffers, data) {
  buffers.push(buffD);
  let j = 0;
  let k;
  const keys = Object.keys(data).sort();
  const kl = keys.length;
  for (; j < kl; j++) {
    k = keys[j];
    if (data[k] == null) continue;
    encode.string(buffers, k);
    encode._encode(buffers, data[k]);
  }
  buffers.push(buffE);
};
encode.dictMap = function(buffers, data) {
  buffers.push(buffD);
  const keys = Array.from(data.keys()).sort();
  for (const key of keys) {
    if (data.get(key) == null) continue;
    ArrayBuffer.isView(key) ? encode._encode(buffers, key) : encode.string(buffers, String(key));
    encode._encode(buffers, data.get(key));
  }
  buffers.push(buffE);
};
encode.list = function(buffers, data) {
  let i = 0;
  const c = data.length;
  buffers.push(buffL);
  for (; i < c; i++) {
    if (data[i] == null) continue;
    encode._encode(buffers, data[i]);
  }
  buffers.push(buffE);
};
encode.listSet = function(buffers, data) {
  buffers.push(buffL);
  for (const item of data) {
    if (item == null) continue;
    encode._encode(buffers, item);
  }
  buffers.push(buffE);
};
var encode_default = encode;

// node_modules/bencode/lib/decode.js
var INTEGER_START = 105;
var STRING_DELIM = 58;
var DICTIONARY_START = 100;
var LIST_START = 108;
var END_OF_TYPE = 101;
function getIntFromBuffer(buffer, start, end) {
  let sum = 0;
  let sign = 1;
  for (let i = start; i < end; i++) {
    const num = buffer[i];
    if (num < 58 && num >= 48) {
      sum = sum * 10 + (num - 48);
      continue;
    }
    if (i === start && num === 43) {
      continue;
    }
    if (i === start && num === 45) {
      sign = -1;
      continue;
    }
    if (num === 46) {
      break;
    }
    throw new Error("not a number: buffer[" + i + "] = " + num);
  }
  return sum * sign;
}
function decode(data, start, end, encoding) {
  if (data == null || data.length === 0) {
    return null;
  }
  if (typeof start !== "number" && encoding == null) {
    encoding = start;
    start = void 0;
  }
  if (typeof end !== "number" && encoding == null) {
    encoding = end;
    end = void 0;
  }
  decode.position = 0;
  decode.encoding = encoding || null;
  decode.data = !ArrayBuffer.isView(data) ? text2arr(data) : new Uint8Array(data.slice(start, end));
  decode.bytes = decode.data.length;
  return decode.next();
}
decode.bytes = 0;
decode.position = 0;
decode.data = null;
decode.encoding = null;
decode.next = function() {
  switch (decode.data[decode.position]) {
    case DICTIONARY_START:
      return decode.dictionary();
    case LIST_START:
      return decode.list();
    case INTEGER_START:
      return decode.integer();
    default:
      return decode.buffer();
  }
};
decode.find = function(chr) {
  let i = decode.position;
  const c = decode.data.length;
  const d = decode.data;
  while (i < c) {
    if (d[i] === chr) return i;
    i++;
  }
  throw new Error(
    'Invalid data: Missing delimiter "' + String.fromCharCode(chr) + '" [0x' + chr.toString(16) + "]"
  );
};
decode.dictionary = function() {
  decode.position++;
  const dict = {};
  while (decode.data[decode.position] !== END_OF_TYPE) {
    const buffer = decode.buffer();
    let key = arr2text(buffer);
    if (key.includes("\uFFFD")) key = arr2hex(buffer);
    dict[key] = decode.next();
  }
  decode.position++;
  return dict;
};
decode.list = function() {
  decode.position++;
  const lst = [];
  while (decode.data[decode.position] !== END_OF_TYPE) {
    lst.push(decode.next());
  }
  decode.position++;
  return lst;
};
decode.integer = function() {
  const end = decode.find(END_OF_TYPE);
  const number = getIntFromBuffer(decode.data, decode.position + 1, end);
  decode.position += end + 1 - decode.position;
  return number;
};
decode.buffer = function() {
  let sep = decode.find(STRING_DELIM);
  const length = getIntFromBuffer(decode.data, decode.position, sep);
  const end = ++sep + length;
  decode.position = end;
  return decode.encoding ? arr2text(decode.data.slice(sep, end)) : decode.data.slice(sep, end);
};
var decode_default = decode;

// node_modules/bencode/lib/encoding-length.js
function listLength(list) {
  let length = 1 + 1;
  for (const value of list) {
    length += encodingLength(value);
  }
  return length;
}
function mapLength(map) {
  let length = 1 + 1;
  for (const [key, value] of map) {
    const keyLength = text2arr(key).byteLength;
    length += digitCount(keyLength) + 1 + keyLength;
    length += encodingLength(value);
  }
  return length;
}
function objectLength(value) {
  let length = 1 + 1;
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    const keyLength = text2arr(keys[i]).byteLength;
    length += digitCount(keyLength) + 1 + keyLength;
    length += encodingLength(value[keys[i]]);
  }
  return length;
}
function stringLength(value) {
  const length = text2arr(value).byteLength;
  return digitCount(length) + 1 + length;
}
function arrayBufferLength(value) {
  const length = value.byteLength - value.byteOffset;
  return digitCount(length) + 1 + length;
}
function encodingLength(value) {
  const length = 0;
  if (value == null) return length;
  const type = getType(value);
  switch (type) {
    case "arraybufferview":
      return arrayBufferLength(value);
    case "string":
      return stringLength(value);
    case "array":
    case "set":
      return listLength(value);
    case "number":
      return 1 + digitCount(Math.floor(value)) + 1;
    case "bigint":
      return 1 + value.toString().length + 1;
    case "object":
      return objectLength(value);
    case "map":
      return mapLength(value);
    default:
      throw new TypeError(`Unsupported value of type "${type}"`);
  }
}
var encoding_length_default = encodingLength;

// node_modules/bencode/index.js
var encodingLength2 = encoding_length_default;
var bencode_default = { encode: encode_default, decode: decode_default, byteLength: encoding_length_default, encodingLength: encodingLength2 };

// node_modules/cross-fetch-ponyfill/browser.js
var Blob2 = self.Blob;
var File = self.File;
var FormData = self.FormData;
var Headers = self.Headers;
var Request = self.Request;
var Response = self.Response;
var AbortController = self.AbortController;
var AbortSignal2 = self.AbortSignal;
var fetch2 = self.fetch || (() => {
  throw new Error("global fetch is not available!");
});

// node_modules/@thaunknown/thirty-two/lib/thirty-two/index.js
var byteTable = [
  255,
  255,
  26,
  27,
  28,
  29,
  30,
  31,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  21,
  22,
  23,
  24,
  25,
  255,
  255,
  255,
  255,
  255,
  255,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  21,
  22,
  23,
  24,
  25,
  255,
  255,
  255,
  255,
  255
];
var decode2 = function(encoded) {
  if (!ArrayBuffer.isView(encoded) && typeof encoded !== "string") {
    throw new TypeError("base32.decode only takes Buffer or string as parameter");
  }
  let shiftIndex = 0;
  let plainDigit = 0;
  let plainChar;
  let plainPos = 0;
  if (!ArrayBuffer.isView(encoded)) {
    encoded = text2arr(encoded);
  }
  const decoded = new Uint8Array(Math.ceil(encoded.length * 5 / 8));
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === 61) {
      break;
    }
    const encodedByte = encoded[i] - 48;
    if (encodedByte < byteTable.length) {
      plainDigit = byteTable[encodedByte];
      if (shiftIndex <= 3) {
        shiftIndex = (shiftIndex + 5) % 8;
        if (shiftIndex === 0) {
          plainChar |= plainDigit;
          decoded[plainPos] = plainChar;
          plainPos++;
          plainChar = 0;
        } else {
          plainChar |= 255 & plainDigit << 8 - shiftIndex;
        }
      } else {
        shiftIndex = (shiftIndex + 5) % 8;
        plainChar |= 255 & plainDigit >>> shiftIndex;
        decoded[plainPos] = plainChar;
        plainPos++;
        plainChar = 255 & plainDigit << 8 - shiftIndex;
      }
    } else {
      throw new Error("Invalid input - it is not base32 encoded string");
    }
  }
  return decoded.subarray(0, plainPos);
};

// node_modules/bep53-range/index.js
function parseRange(range) {
  const generateRange = (start, end = start) => Array.from({ length: end - start + 1 }, (cur, idx) => idx + start);
  return range.reduce((acc, cur, idx, arr) => {
    const r = cur.split("-").map((cur2) => parseInt(cur2));
    return acc.concat(generateRange(...r));
  }, []);
}

// node_modules/magnet-uri/index.js
function magnetURIDecode(uri) {
  const result = {};
  const data = uri.split("magnet:?")[1];
  const params = data && data.length >= 0 ? data.split("&") : [];
  params.forEach((param) => {
    const keyval = param.split("=");
    if (keyval.length !== 2) return;
    const key = keyval[0];
    let val = keyval[1];
    if (key === "dn") val = decodeURIComponent(val).replace(/\+/g, " ");
    if (key === "tr" || key === "xs" || key === "as" || key === "ws") {
      val = decodeURIComponent(val);
    }
    if (key === "kt") val = decodeURIComponent(val).split("+");
    if (key === "ix") val = Number(val);
    if (key === "so") val = parseRange(decodeURIComponent(val).split(","));
    if (result[key]) {
      if (!Array.isArray(result[key])) {
        result[key] = [result[key]];
      }
      result[key].push(val);
    } else {
      result[key] = val;
    }
  });
  let m;
  if (result.xt) {
    const xts = Array.isArray(result.xt) ? result.xt : [result.xt];
    xts.forEach((xt) => {
      if (m = xt.match(/^urn:btih:(.{40})/)) {
        result.infoHash = m[1].toLowerCase();
      } else if (m = xt.match(/^urn:btih:(.{32})/)) {
        result.infoHash = arr2hex(decode2(m[1]));
      } else if (m = xt.match(/^urn:btmh:1220(.{64})/)) {
        result.infoHashV2 = m[1].toLowerCase();
      }
    });
  }
  if (result.xs) {
    const xss = Array.isArray(result.xs) ? result.xs : [result.xs];
    xss.forEach((xs) => {
      if (m = xs.match(/^urn:btpk:(.{64})/)) {
        result.publicKey = m[1].toLowerCase();
      }
    });
  }
  if (result.infoHash) result.infoHashBuffer = hex2arr(result.infoHash);
  if (result.infoHashV2) result.infoHashV2Buffer = hex2arr(result.infoHashV2);
  if (result.publicKey) result.publicKeyBuffer = hex2arr(result.publicKey);
  if (result.dn) result.name = result.dn;
  if (result.kt) result.keywords = result.kt;
  result.announce = [];
  if (typeof result.tr === "string" || Array.isArray(result.tr)) {
    result.announce = result.announce.concat(result.tr);
  }
  result.urlList = [];
  if (typeof result.as === "string" || Array.isArray(result.as)) {
    result.urlList = result.urlList.concat(result.as);
  }
  if (typeof result.ws === "string" || Array.isArray(result.ws)) {
    result.urlList = result.urlList.concat(result.ws);
  }
  result.peerAddresses = [];
  if (typeof result["x.pe"] === "string" || Array.isArray(result["x.pe"])) {
    result.peerAddresses = result.peerAddresses.concat(result["x.pe"]);
  }
  result.announce = Array.from(new Set(result.announce));
  result.urlList = Array.from(new Set(result.urlList));
  result.peerAddresses = Array.from(new Set(result.peerAddresses));
  return result;
}
var magnet_uri_default = magnetURIDecode;

// node_modules/parse-torrent/index.js
var import_path = __toESM(require_path_browserify(), 1);
var import_queue_microtask = __toESM(require_queue_microtask(), 1);
async function parseTorrent(torrentId) {
  if (typeof torrentId === "string" && /^(stream-)?magnet:/.test(torrentId)) {
    const torrentObj = magnet_uri_default(torrentId);
    if (!torrentObj.infoHash) {
      throw new Error("Invalid torrent identifier");
    }
    return torrentObj;
  } else if (typeof torrentId === "string" && (/^[a-f0-9]{40}$/i.test(torrentId) || /^[a-z2-7]{32}$/i.test(torrentId))) {
    return magnet_uri_default(`magnet:?xt=urn:btih:${torrentId}`);
  } else if (ArrayBuffer.isView(torrentId) && torrentId.length === 20) {
    return magnet_uri_default(`magnet:?xt=urn:btih:${arr2hex(torrentId)}`);
  } else if (ArrayBuffer.isView(torrentId)) {
    return await decodeTorrentFile(torrentId);
  } else if (torrentId && torrentId.infoHash) {
    torrentId.infoHash = torrentId.infoHash.toLowerCase();
    if (!torrentId.announce) torrentId.announce = [];
    if (typeof torrentId.announce === "string") {
      torrentId.announce = [torrentId.announce];
    }
    if (!torrentId.urlList) torrentId.urlList = [];
    return torrentId;
  } else {
    throw new Error("Invalid torrent identifier");
  }
}
async function decodeTorrentFile(torrent) {
  if (ArrayBuffer.isView(torrent)) {
    torrent = bencode_default.decode(torrent);
  }
  ensure(torrent.info, "info");
  ensure(torrent.info["name.utf-8"] || torrent.info.name, "info.name");
  ensure(torrent.info["piece length"], "info['piece length']");
  ensure(torrent.info.pieces, "info.pieces");
  if (torrent.info.files) {
    torrent.info.files.forEach((file) => {
      ensure(typeof file.length === "number", "info.files[0].length");
      ensure(file["path.utf-8"] || file.path, "info.files[0].path");
    });
  } else {
    ensure(typeof torrent.info.length === "number", "info.length");
  }
  const result = {
    info: torrent.info,
    infoBuffer: bencode_default.encode(torrent.info),
    name: arr2text(torrent.info["name.utf-8"] || torrent.info.name),
    announce: []
  };
  result.infoHashBuffer = await hash(result.infoBuffer);
  result.infoHash = arr2hex(result.infoHashBuffer);
  if (torrent.info.private !== void 0) result.private = !!torrent.info.private;
  if (torrent["creation date"]) result.created = new Date(torrent["creation date"] * 1e3);
  if (torrent["created by"]) result.createdBy = arr2text(torrent["created by"]);
  if (ArrayBuffer.isView(torrent.comment)) result.comment = arr2text(torrent.comment);
  if (Array.isArray(torrent["announce-list"]) && torrent["announce-list"].length > 0) {
    torrent["announce-list"].forEach((urls) => {
      urls.forEach((url) => {
        result.announce.push(arr2text(url));
      });
    });
  } else if (torrent.announce) {
    result.announce.push(arr2text(torrent.announce));
  }
  if (ArrayBuffer.isView(torrent["url-list"])) {
    torrent["url-list"] = torrent["url-list"].length > 0 ? [torrent["url-list"]] : [];
  }
  result.urlList = (torrent["url-list"] || []).map((url) => arr2text(url));
  result.announce = Array.from(new Set(result.announce));
  result.urlList = Array.from(new Set(result.urlList));
  let sum = 0;
  const files = torrent.info.files || [torrent.info];
  result.files = files.map((file, i) => {
    const parts = [].concat(result.name, file["path.utf-8"] || file.path || []).map((p) => ArrayBuffer.isView(p) ? arr2text(p) : p);
    sum += file.length;
    return {
      path: import_path.default.join.apply(null, [import_path.default.sep].concat(parts)).slice(1),
      name: parts[parts.length - 1],
      length: file.length,
      offset: sum - file.length
    };
  });
  result.length = sum;
  const lastFile = result.files[result.files.length - 1];
  result.pieceLength = torrent.info["piece length"];
  result.lastPieceLength = (lastFile.offset + lastFile.length) % result.pieceLength || result.pieceLength;
  result.pieces = splitPieces(torrent.info.pieces);
  return result;
}
function splitPieces(buf) {
  const pieces = [];
  for (let i = 0; i < buf.length; i += 20) {
    pieces.push(arr2hex(buf.slice(i, i + 20)));
  }
  return pieces;
}
function ensure(bool, fieldName) {
  if (!bool) throw new Error(`Torrent is missing required field: ${fieldName}`);
}
var parse_torrent_default = parseTorrent;

// lib/catalog.js
function catalogLoader(url) {
  let cached, expires = 0, pending;
  return async (fetchFn, refresh = false) => {
    if (!refresh && cached && Date.now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetchFn(url, { signal: AbortSignal.timeout(15e3) });
      if (!response.ok) throw new Error(`Cat\xE1logo: HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data) || data.some((s) => !s.title || !Array.isArray(s.episodes))) throw new Error("Cat\xE1logo inv\xE1lido");
      cached = data;
      expires = Date.now() + 3e5;
      return data;
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  };
}

// lib/matching.js
var VIDEO = /\.(mkv|mp4|webm|avi|m4v)$/i;
var normalize = (value) => String(value ?? "").normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
var crc = (value) => String(value ?? "").match(/\[([a-f\d]{8})\]/i)?.[1].toUpperCase();
var resolution = (value) => String(value ?? "").match(/(?:^|[^\d])(2160|1080|720|540|480)p?(?=$|[^\d])/i)?.[1];
function fileName(ep) {
  try {
    const name = decodeURIComponent(new URL(ep.url).pathname.split("/").pop());
    if (VIDEO.test(name)) return name;
  } catch {
  }
  return ep.fileName || "";
}
var canonicalFile = (value) => String(value ?? "").normalize("NFC").toLowerCase().trim();
function episodeNumber(value) {
  const text = String(value ?? "").replace(/\[[^\]]*\]/g, " ");
  const tagged = text.match(/(?:\bS\d+[ ._-]*)?\b(?:E|EP|Episode)[ ._-]*0*(\d+(?:\.\d+)?)(?=\b|v\d)/i) ?? text.match(/\bS\d+E0*(\d+(?:\.\d+)?)(?=\b|v\d)/i);
  if (tagged) return Number(tagged[1]);
  const separated = text.match(/\s-\s*0*(\d{1,3}(?:\.\d+)?)(?:v\d+)?(?=\s|\.[a-z]|$)/i);
  return separated ? Number(separated[1]) : null;
}
function seasonNumber(value) {
  const text = String(value ?? "");
  const match = text.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i) ?? text.match(/\bseason\s*(\d+)\b/i) ?? text.match(/\bS0*(\d+)(?:E\d+|\b)/i);
  if (match) return Number(match[1]);
  const roman = text.match(/\b(II|III|IV|V)\s*$/);
  return roman ? { II: 2, III: 3, IV: 4, V: 5 }[roman[1]] : 1;
}
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] !== b[j - 1]));
    row = next;
  }
  return row[b.length];
}
function matchSeries(catalog, titles = [], id) {
  const byId = id ? catalog.filter((s) => Number(s.anilistId) === Number(id)) : [];
  if (byId.length) return byId;
  const available = catalog.filter((s) => !id || !s.anilistId);
  const wanted = titles.filter((t) => normalize(t));
  const names = (s) => [s.title, ...s.aliases ?? []].filter(Boolean);
  const exact = available.filter((s) => names(s).some((n) => wanted.some((t) => normalize(n) === normalize(t))));
  if (exact.length) return exact;
  const fuzzy = available.filter((s) => names(s).some((n) => wanted.some((t) => {
    const a = normalize(n), b = normalize(t);
    return a.length >= 6 && b.length >= 6 && seasonNumber(n) === seasonNumber(t) && editDistance(a, b) <= 1;
  })));
  return fuzzy.length === 1 ? fuzzy : [];
}
function sameRelease(ep, name) {
  const expected = fileName(ep);
  if (!expected || !name) return false;
  const aCrc = crc(expected) || ep.crc32?.toUpperCase(), bCrc = crc(name);
  if (aCrc && bCrc && aCrc !== bCrc) return false;
  const aRes = resolution(expected) || String(ep.resolution || ""), bRes = resolution(name);
  if (aRes && bRes && aRes !== bRes) return false;
  const aEp = episodeNumber(expected), bEp = episodeNumber(name);
  if (aEp !== null && bEp !== null && aEp !== bEp) return false;
  const codec = (text) => /\b(hevc|x265|h[ .]?265)\b/i.test(text) ? "hevc" : /\b(avc|x264|h[ .]?264)\b/i.test(text) ? "avc" : null;
  if (codec(expected) && codec(name) && codec(expected) !== codec(name)) return false;
  if (canonicalFile(expected) === canonicalFile(name)) return true;
  const core = (value) => normalize(value.replace(/\[[^\]]*\]/g, "").replace(/\.(mkv|mp4|webm|avi|m4v)$/i, ""));
  if (Boolean(aCrc && bCrc && aCrc === bCrc && core(expected) && core(expected) === core(name))) return true;
  const group = (text) => String(text).match(/^\[([^\]]+)\]/)?.[1]?.toLowerCase();
  const aGroup = ep.group?.toLowerCase() || group(expected), bGroup = group(name);
  if (aGroup && bGroup && aGroup === bGroup && core(expected) && core(expected) === core(name)) return true;
  return false;
}
function isBatchTorrent(item) {
  if (Array.isArray(item.files)) return item.files.filter((f) => VIDEO.test(f.name || f.path || "")).length > 1;
  const title = `${item.title || ""} ${item.torrent_name || ""}`;
  return /\b(batch|complete\s+(?:series|season)|season\s*\d*\s*complete)\b|(?:^|[\s[(])\d{1,3}\s*[-~]\s*\d{1,3}(?=[\s\])]|$)/i.test(title);
}
function onlineState(ep, now = Date.now()) {
  const checked = Date.parse(ep.checkedAt);
  if (!Number.isFinite(checked) || checked > now || now - checked > 864e5) return null;
  return typeof ep.isOnline === "boolean" ? ep.isOnline : null;
}

// torrent.js
var INDEX_URL = "https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/dist/indexed-catalog.json";
var validHash = (value) => /^[a-f\d]{40}$/i.test(value || "");
var count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
function createTorrentSource(indexUrl = INDEX_URL) {
  const load = catalogLoader(indexUrl);
  const cache = /* @__PURE__ */ new Map();
  async function memo(key, action) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await action();
    if (value !== null) {
      cache.delete(key);
      if (cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(key, { value, expires: Date.now() + 3e5 });
    }
    return value;
  }
  async function metadata(url, expectedHash, ep, fetchFn) {
    if (!/^https?:\/\//.test(url) || !validHash(expectedHash)) return null;
    try {
      const parsed = await memo("torrent:" + url, async () => {
        const response = await fetchFn(url);
        if (!response.ok) return null;
        if (Number(response.headers?.get("content-length")) > 4 * 1024 * 1024) {
          await response.body?.cancel();
          return null;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 4 * 1024 * 1024) return null;
        return parse_torrent_default(bytes);
      });
      if (!parsed || parsed.infoHash !== expectedHash.toLowerCase()) return null;
      if (!Number.isSafeInteger(parsed.length) || parsed.length <= 0 || !Number.isSafeInteger(parsed.pieceLength) || parsed.pieceLength <= 0 || parsed.pieces.length !== Math.ceil(parsed.length / parsed.pieceLength)) return null;
      if (parsed.files.length !== 1 || !VIDEO.test(parsed.files[0].name) || isBatchTorrent(parsed)) return null;
      if (!sameRelease(ep, parsed.files[0].name)) return null;
      if (ep.size && Number(ep.size) !== parsed.length) return null;
      return parsed;
    } catch {
      return null;
    }
  }
  async function search(series, ep, titles, fetchFn, signal, movie) {
    const number = Number(ep.episode);
    const queries = /* @__PURE__ */ new Set();
    const crc2 = ep.crc32 || fileName(ep).match(/\[([a-f\d]{8})\]/i)?.[1];
    if (crc2) queries.add(crc2);
    queries.add(fileName(ep).replace(/\.[a-z0-9]+$/i, ""));
    for (const title of [...titles, series.title].filter(Boolean).slice(0, 3)) {
      queries.add(movie ? title : `${title} ${String(number).padStart(2, "0")}`);
    }
    for (const q of queries) {
      if (!q || signal.aborted) break;
      let items;
      try {
        items = await memo("query:" + q, async () => {
          const response = await fetchFn(`https://feed.animetosho.org/json?q=${encodeURIComponent(q)}`);
          if (!response.ok) return null;
          const data = await response.json();
          return Array.isArray(data) ? data : null;
        });
      } catch {
        continue;
      }
      const candidates = (items || []).filter((item) => {
        if (!validHash(item.info_hash) || !item.torrent_url || isBatchTorrent(item)) return false;
        const title = item.title || item.torrent_name || "";
        if (sameRelease(ep, title) || sameRelease(ep, title + ".mkv") || sameRelease(ep, title + ".mp4")) return true;
        const r = resolution(title), expectedRes = resolution(fileName(ep)) || String(ep.resolution || "");
        if (r && expectedRes && r !== expectedRes) return false;
        if (!movie && episodeNumber(title) !== number) return false;
        return [...titles, series.title, ...series.aliases || []].some((t) => normalize(t).length >= 6 && normalize(title).includes(normalize(t)));
      }).sort((a, b) => Number(Boolean(crc2 && String(b.title).includes(crc2))) - Number(Boolean(crc2 && String(a.title).includes(crc2))));
      for (const item of candidates.slice(0, 4)) {
        if (signal.aborted) return null;
        const parsed = await metadata(item.torrent_url, item.info_hash, ep, fetchFn);
        if (parsed) return { parsed, url: item.torrent_url, item };
      }
    }
    return null;
  }
  async function single(query, movie = false) {
    const signal = AbortSignal.timeout(18e3);
    const fetchFn = (url, options = {}) => (query.fetch ?? fetch)(url, { ...options, signal: AbortSignal.any([signal, options.signal ?? AbortSignal.timeout(5e3)]) });
    const number = Number(movie ? 1 : query.episode);
    if (!Number.isFinite(number) || number < 0) return [];
    const requested = String(query.resolution || "").replace(/p$/i, "");
    const exclusions = (query.exclusions || []).map((x) => String(x).toLowerCase()).filter(Boolean);
    if (query.anilistId) {
      try {
        const dataUrl = new URL(`data/${query.anilistId}.json`, indexUrl).href;
        const dataRes = await fetchFn(dataUrl);
        if (dataRes.ok) {
          const animeData = await dataRes.json();
          const matched = (animeData.episodes || []).filter((ep) => {
            if (Number(ep.episode) !== number) return false;
            if (requested && String(ep.resolution) !== requested) return false;
            const title = ep.fileName || ep.title || "";
            if (exclusions.some((x) => title.toLowerCase().includes(x))) return false;
            return true;
          });
          if (matched.length > 0) {
            return matched.map((ep) => {
              const original = ep.fileName || `${animeData.title} - ${String(ep.episode).padStart(2, "0")} [${ep.resolution}p].mkv`;
              const ext = original.match(/\.[^.]+$/)?.[0] || "";
              const baseName = ext ? original.slice(0, -ext.length) : original;
              return {
                title: `${baseName} [DDL verificado]${ext}`,
                link: new URL(ep.torrent || ep.torrentPath, indexUrl).href,
                hash: (ep.hash || ep.infoHash).toLowerCase(),
                size: ep.size,
                date: new Date(ep.verified?.verifiedAt || 0),
                seeders: 0,
                leechers: 0,
                downloads: 0,
                accuracy: "high"
              };
            });
          }
        }
      } catch {
      }
    }
    const catalog = await load(fetchFn);
    const series = matchSeries(catalog, query.titles, query.anilistId);
    const results = [], seen = /* @__PURE__ */ new Set();
    for (const s of series) {
      for (const ep of s.episodes || []) {
        if (signal.aborted) return results;
        if (Number(ep.episode) !== number || requested && (resolution(fileName(ep)) || String(ep.resolution)) !== requested) continue;
        if (exclusions.some((x) => `${fileName(ep)} ${ep.quality}`.toLowerCase().includes(x))) continue;
        let match;
        if (ep.torrentPath && validHash(ep.infoHash)) {
          const url2 = new URL(ep.torrentPath, indexUrl).href;
          const parsed2 = await metadata(url2, ep.infoHash, ep, fetchFn);
          if (parsed2) match = { parsed: parsed2, url: url2, item: {} };
        }
        if (!match) match = await search(s, ep, query.titles || [], fetchFn, signal, movie);
        if (!match || seen.has(match.parsed.infoHash)) continue;
        const { parsed, url, item } = match;
        if (exclusions.some((x) => parsed.files[0].name.toLowerCase().includes(x))) continue;
        seen.add(parsed.infoHash);
        const state = onlineState(ep);
        const tag = state === true ? "[DDL verificado]" : state === false ? "[DDL ca\xEDdo - Solo P2P]" : "[DDL sin verificar]";
        const original = parsed.files[0].name;
        const extension = original.match(/\.[^.]+$/)?.[0] || "";
        results.push({
          title: original.slice(0, original.length - extension.length) + " " + tag + extension,
          link: url,
          hash: parsed.infoHash,
          size: parsed.length,
          date: new Date(item.timestamp ? item.timestamp * 1e3 : ep.hashedAt || 0),
          seeders: count(item.seeders),
          leechers: count(item.leechers),
          downloads: count(item.downloads),
          accuracy: s.anilistId ? "medium" : "low"
        });
      }
    }
    return results;
  }
  return {
    async test() {
      await load(fetch, true);
      return true;
    },
    single: (query) => single(query),
    movie: (query) => single(query, true),
    async batch() {
      return [];
    }
  };
}
var torrent_default = createTorrentSource();
export {
  createTorrentSource,
  torrent_default as default
};
/*! Bundled license information:

queue-microtask/index.js:
  (*! queue-microtask. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> *)

magnet-uri/index.js:
  (*! magnet-uri. MIT License. WebTorrent LLC <https://webtorrent.io/opensource> *)

parse-torrent/index.js:
  (*! parse-torrent. MIT License. WebTorrent LLC <https://webtorrent.io/opensource> *)
*/
