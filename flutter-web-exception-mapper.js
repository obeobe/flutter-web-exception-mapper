import {SourceMapConsumer} from "source-map";
import fetch from "node-fetch";

const SOURCE_MAPS_CACHE_SECONDS = 10; // after 10 seconds - re-download file

let arrBuffer = [ ];
let objCachedSourceMaps = { }; // { <url>: { objSourceMap: <SourceMapConsumer sourcemap structure>, timestamp: <seconds since epoch when cached> } }
let isDumpingBuffer = false;

console.log("Flutter Web Exception Mapper is active!");

process.stdin.on("data", (data) => {
	processData(data);
});

function processData(data) {
	let lines = data.toString();
	let arrLines = lines
		.replace("/\r\n/g", "\n")
		.split("\n")
		.map(x => x.trim())
		.filter(x => x.length > 0)
	;

	arrLines.forEach((line) => {
		processLine(line);
	});

	dumpBufferIfNeeded().then();
}

function processLine(line) {
	let objCallstackLine = tryParseCallstackLine(line);
	if (objCallstackLine == null) {
		// doesn't seem to be a callstack line. process as a regular line
		let effectiveLine = processRegularLine(line);
		scheduleLineOrPromiseForDump(effectiveLine);
	}
	else {
		let promise = processCallstackLineAndGetTranslatedLine(objCallstackLine);
		scheduleLineOrPromiseForDump(promise);
	}
}

function processRegularLine(line) {
	if (line.startsWith("at ")) {
		// this can happen in some cases, e.g. "at main.next (<anonymous>)", which is not recognized as a callstack
		// line, but actually is (even though there's no point in processing it as such because it has no file/line/col
		// info).
		// though we do want to indent it.
		return `    ${line}`;
	}
	return line;
}

function scheduleLineOrPromiseForDump(lineOrPromise) {
	arrBuffer.push(lineOrPromise);
}

async function dumpBufferIfNeeded() {
	if (isDumpingBuffer) {
		// not re-entrant
		return;
	}

	if (arrBuffer.length == 0) {
		return;
	}

	isDumpingBuffer = true;
	let len = arrBuffer.length;
	for (let i = 0; i < len; i++) {
		let lineOrPromise = arrBuffer[i];
		let lineForSure = lineOrPromise;
		if (!isString(lineOrPromise)) {
			// we have a promise for a line
			// wait for the line to become available
			lineForSure = await lineOrPromise;
		}
		console.log(lineForSure);
	}

	// clear the processed lines
	arrBuffer.splice(0, len);

	// allow to dump
	isDumpingBuffer = false;

	// the buffer may have filled up in the meanwhile. dump if needed
	dumpBufferIfNeeded().then();
}

function isString(s) {
	return (typeof s == "string");
}

// returns:
// 		{
// 			originalLine: string;
//			functionText: string;
// 			url: string;
// 			line: number;
// 			col: number;
//			dartFilePath: string;
// 		}
// 		| null (if not a callstack line format)
function tryParseCallstackLine(maybeCallstackLine) {
	// variation #1:
	// at tap.TapGestureRecognizer.new.invokeCallback (http://localhost:5555/packages/flutter/src/gestures/recognizer.dart.lib.js:183:18)

	// variation #2:
	// at http://localhost:5555/packages/pkg1/src/Some/Path/AndFile.dart.lib.js:5497:49

	let effectiveLine = maybeCallstackLine;
	if (effectiveLine.startsWith("at http")) {
		// "convert" to variation #1
		let arrParts = effectiveLine.split(" ");
		if (arrParts.length != 2) {
			// not a proper "variation #2"
			return null;
		}
		effectiveLine = `${arrParts[0]} (${arrParts[1]})`;
	}

	if (!doesLookLikeCallstackLine(effectiveLine)) {
		return null;
	}

	// at Object._microtaskLoop (http://localhost:5555/dart_sdk.js:37526:13)
	let arrParts = effectiveLine.split("(");
	if (arrParts.length != 2) {
		return null;
	}

	let urlAndPos = arrParts[1].substr(0, arrParts[1].length - 1);
	let arrParts2 = urlAndPos.split(":");
	if (arrParts2.length < 3) {
		return null;
	}

	let len = arrParts2.length;
	let arrToCombine = [ ...arrParts2 ];
	arrToCombine.splice(len - 2, 2); // get rid of the line and col parts
	let url = arrToCombine.join(":"); // join back

	let dartFilePath = null;
	let packagesPos = url.indexOf("/packages/");
	let filenamePos = url.lastIndexOf("/");
	if (packagesPos != -1 && filenamePos != -1) {
		let afterPackagesPos = packagesPos + "/packages/".length;
		dartFilePath = url.substring(afterPackagesPos, filenamePos);
	}

	let ret = {
		originalLine: effectiveLine,
		functionText: arrParts[0],
		url: url,
		line: arrParts2[len - 2] * 1,
		col: arrParts2[len - 1] * 1,
		dartFilePath: dartFilePath,
	};
	return ret;
}

function doesLookLikeCallstackLine(line) {
	// examples for a callstack line:
	//     at Object._microtaskLoop (http://localhost:5555/dart_sdk.js:37526:13)

	if (!line.startsWith("at ")) {
		return false;
	}

	if (line.indexOf("http://") == -1 && line.indexOf("https://") == -1) {
		return false;
	}

	if (line.indexOf("(") == -1 || line.indexOf(")") == -1 || line.indexOf(".js:") == -1 || line.indexOf("/") == -1) {
		return false;
	}

	// assume that we're looking at a callstack line
	return true;
}

// objCallstackLine:
// 		{
// 			originalLine: string;
//			functionText: string;
// 			url: string;
// 			line: number;
// 			col: number;
//			dartFilePath: string;
// 		}
async function processCallstackLineAndGetTranslatedLine(objCallstackLine) {
	let originalLine = objCallstackLine.originalLine;
	let functionText = objCallstackLine.functionText;
	let url = objCallstackLine.url;
	let line = objCallstackLine.line;
	let col = objCallstackLine.col;
	let dartFilePath = objCallstackLine.dartFilePath;

	let objSourceMap = await tryGetSourceMapForUrl(url);
	if (objSourceMap == null) {
		// failed to get source map. just output the original line
		return originalLine;
	}

	let objDecoded = await decodeWithSourceMap(objSourceMap, line, col);
	if (objDecoded == null) {
		// failed to decode
		return originalLine;
	}

	let dartFile = objDecoded.file;
	let dartLine = objDecoded.line;
	let dartCol = objDecoded.col;
	let path = "";
	if (dartFilePath != null) {
		path = `${dartFilePath}/`;
	}

	let s = `    ${functionText}(package:${path}${dartFile}:${dartLine}:${dartCol})`;
	return s;
}

async function tryGetSourceMapForUrl(url) {
	let objCache = tryGetCacheObject(url);
	if (objCache == null) {
		// need to (re?)download file
		let js = await download(url);
		if (js == null) {
			// failed to download
			return null;
		}

		// try to parse out the sourcemap stuff
		let objSourceMap = tryParseSourceMapFromJs(js);
		if (objSourceMap == null) {
			console.log(`failed to parse the sourcemap out of the JS of: ${url}`);
			return null;
		}

		objCache = {
			objSourceMap: objSourceMap,
			timestamp: getSecondsSinceEpoch(),
		};

		objCachedSourceMaps[url] = objCache;
	}

	return objCache.objSourceMap;
}

function tryParseSourceMapFromJs(js) {
	let posVeryEnd = js.lastIndexOf("// Exports");
	if (posVeryEnd == -1) {
		return null;
	}

	let posEnd = js.lastIndexOf("');", posVeryEnd);
	if (posEnd == -1) {
		return null;
	}

	let posStart = js.lastIndexOf('{"', posEnd);
	if (posStart == -1) {
		return null;
	}

	let length = posEnd - posStart;
	let json = js.substr(posStart, length);
	let objSourceMap = null;
	try {
		objSourceMap = JSON.parse(json);
	}
	catch (ex) {
		console.log("error occurred when parsing json. error: ", ex);
	}

	return objSourceMap;
}

async function download(url) {
	let body = null;

	try {
		let response = await fetch(url);
		body = await response.text();
	}
	catch (ex) {
		console.log(`error when downloading [${url}]: `, ex);
	}

	return body;
}

function tryGetCacheObject(url) {
	let objCache = objCachedSourceMaps[url];
	if (!objCache) {
		return null;
	}

	let cachedAt = objCache.timestamp;
	let nowSeconds = getSecondsSinceEpoch();
	if (nowSeconds > cachedAt + SOURCE_MAPS_CACHE_SECONDS) {
		// expired
		return null;
	}

	return objCache;
}

function getSecondsSinceEpoch() {
	let d = new Date();
	let seconds = d.getTime() / 1000;
	return seconds;
}

// returns: { file: string, line: number, col: number }|null
async function decodeWithSourceMap(objSourceMap, line, col) {
	let result = null;
	try {
		result = await SourceMapConsumer.with(objSourceMap, null, consumer => {
			let objOriginal = consumer.originalPositionFor({
				line: line,
				column: col
			})
			return objOriginal;
		});
	}
	catch (ex) {
		console.log(`error occurred when decoding position [${line}:${col}] in objSourceMap: `, objSourceMap);
		return null;
	}

	let ret = {
		file: result.source,
		line: result.line,
		col: result.column,
	};

	if (result.source == null) {
		// could not figure out the source (happens with dart sdk)
		return null;
	}

	return ret;
}
