# Flutter Web Exception Mapper
## Overview
Currently, when using Flutter Web, references to source code in exceptions are not mapped from JS back to Dart.

This utility automatically converts such references to (clickable) references to Dart files, at the correct position in the file.

To use it, pipe the output of Flutter through it. It will:
1. Detect exception lines.
2. Download the relevant JS file.
3. Extract the source map data from the JS file.
4. Translate the JS file/line/column to their corresponding Dart values.
5. Output the data in a format that is recognized by the Flutter Plugin (to make it clickable).

Related Flutter issues:
* https://github.com/flutter/flutter/issues/88636
* https://github.com/dart-lang/webdev/issues/1265 (this one is related, but not about console output and I don't think it would be solved by this tool). 

## IDE Support
I tested this with the following setup:
* Flutter 2.2.3
* Android Studio 4.2.1
  * Flutter plugin 58.0.1
  * Dart plugin 202.8488
* Ubuntu 20.04

I haven't tried it with VS Code, but I believe it should work pretty much out of the box (I'm just not 100% sure about the necessary formatting to make the callstack lines clickable).


## Setup
1. Clone this repository.
2. Go to the cloned directory and `npm install` (if you get an error - delete `package-lock.json` and try again).
3. Locate your `flutter/bin/flutter` file.
4. **BACK IT UP**
5. Rename it to `flutter-org`.
6. Overwrite it with `flutter.sample` (from this repository).
7. Edit it and change the paths to the correct and **full** path on your system to reference `flutter-org` and `flutter-web-exception-mapper.js` from this repository.
    1. This is necessary because I couldn't find a way to get Android Studio to pipe `flutter` output to another program.
    2. If there's a cleaner way then please let me know :)

That's it.

Now, when you invoke your application (in both debug and run modes) - you should see the text "Flutter Web Exception Mapper is active!" at the top, and exceptions should be translated.

## Example
When running this program:
```
void main() {
  func();
}

void func() {
  func2();
}

void func2() {
  throw "My Hello World Exception";
}
```

*Without* this tool, you should get:

```
Error: My Hello World Exception
    at Object.throw_ [as throw] (http://localhost:36891/dart_sdk.js:5041:11)
    at Object.func2 (http://localhost:36891/packages/test2/main.dart.lib.js:18:15)
    at Object.func (http://localhost:36891/packages/test2/main.dart.lib.js:15:10)
    at main$ (http://localhost:36891/packages/test2/main.dart.lib.js:12:10)
    at main (http://localhost:36891/web_entrypoint.dart.lib.js:33:29)
    at main.next (<anonymous>)
    at http://localhost:36891/dart_sdk.js:37403:33
    at _RootZone.runUnary (http://localhost:36891/dart_sdk.js:37274:59)
    ...
```

With this tool, you should get:
```
Error: My Hello World Exception
    at Object.throw_ [as throw] (package:../../../dart-sdk/lib/_internal/js_dev_runtime/private/ddc_runtime/errors.dart:236:48)
    at Object.func2 (package:test2/main.dart:10:8)
    at Object.func (package:test2/main.dart:6:2)
    at main$ (package:test2/main.dart:2:2)
    at main (package:web_entrypoint.dart:16:26)
    at main.next (<anonymous>)
    at (package:../../../dart-sdk/lib/_internal/js_dev_runtime/patch/async_patch.dart:45:49)
    at _RootZone.runUnary (package:../../../dart-sdk/lib/async/zone.dart:1613:53)
    ...
```

And the `package:test2/main.dart` text should be clickable, and open `main.dart` (and put the caret on the specified line/column).
