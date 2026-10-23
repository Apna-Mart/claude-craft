#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  check-no-dev-artifacts.sh <build-dir-or-archive> [--name FILE_NAME]... [--text STRING]...
  check-no-dev-artifacts.sh --self-test

Searches a release build for debug-only code that must never ship.
  --name  a file name that must not exist anywhere in the build (for example mockServiceWorker.js)
  --text  a string that must not appear inside any file (a class name, a module name, a marker)
The build is copied to a temporary folder and every archive in it is unpacked, including archives nested
inside archives, so compressed code is searched too: zip archives (.apk, .aab, .ipa, .zip, .jar, .aar, .war,
.ear, or any file that starts like a zip) with unzip; tar archives, plain or compressed with gzip, bzip2, xz
or zstd, and 7z archives with tar; a gzip-compressed single file with gzip. An archive that won't unpack
stops the check with exit 2. Any other file (a mapping.txt, a compiled binary) is searched as it is.

Exit codes: 0 clean, 1 debug artifact found (each hit is listed), 2 could not check.
EOF
}

archive_kind() {
  case "$1" in
    *.apk | *.aab | *.ipa | *.zip | *.jar | *.aar | *.war | *.ear) echo zip; return ;;
  esac
  local magic
  magic="$(head -c 6 "$1" | od -An -tx1 | tr -d ' \n')"
  case "$magic" in
    504b0304*) echo zip ;;
    1f8b*) echo gzip ;;
    fd377a585a00 | 28b52ffd* | 425a683[1-9]* | 377abcaf271c) echo tar ;;
    *) [[ "$(head -c 262 "$1" | tail -c 5)" == "ustar" ]] && echo tar || echo none ;;
  esac
}

unpack() {
  local file="$1" kind="$2" out="$1.unpacked"
  mkdir -p "$out"
  case "$kind" in
    zip) unzip -qq -o "$file" -d "$out" ;;
    tar) tar -xf "$file" -C "$out" ;;
    gzip) tar -xf "$file" -C "$out" 2>/dev/null || gzip -dc "$file" > "$out/$(basename "${file%.gz}")" ;;
  esac
}

unpack_all() {
  local dir="$1" file kind pass unpacked_any
  for pass in 1 2 3 4 5 6; do
    unpacked_any=0
    while IFS= read -r file; do
      kind="$(archive_kind "$file")"
      [[ "$kind" == none ]] && continue
      if [[ "$kind" == zip ]] && ! command -v unzip >/dev/null 2>&1; then
        echo "Cannot check: 'unzip' is not installed, so archives can't be searched." >&2
        return 2
      fi
      if ! unpack "$file" "$kind" >/dev/null 2>&1; then
        echo "Cannot check: '${file#"$dir"/}' looks like an archive but won't unpack." >&2
        return 2
      fi
      chmod -R u+rwX "$file.unpacked"
      rm -f "$file"
      unpacked_any=1
    done < <(find "$dir" -type f)
    ((unpacked_any)) || return 0
  done
  echo "Cannot check: archives are nested more than $pass levels deep." >&2
  return 2
}

search() {
  local dir="$1" label="$2"
  shift 2
  local names=() texts=()
  while (($#)); do
    case "$1" in
      --name) names+=("$2") ;;
      --text) texts+=("$2") ;;
    esac
    shift 2
  done

  local found=0 hit
  for name in ${names[@]+"${names[@]}"}; do
    while IFS= read -r hit; do
      echo "FOUND file '$name': ${hit#"$dir"/}"
      found=1
    done < <(find "$dir" -type f -name "$name")
  done
  for text in ${texts[@]+"${texts[@]}"}; do
    while IFS= read -r hit; do
      echo "FOUND text '$text' in: ${hit#"$dir"/}"
      found=1
    done < <(grep -rlaF -- "$text" "$dir" || true)
  done

  if ((found)); then
    echo "FAIL: debug-only artifacts are in '$label'." >&2
    return 1
  fi
  echo "PASS: no debug-only artifacts in '$label'."
}

scan() {
  local target="$1"
  shift
  local terms=() count=0
  while (($#)); do
    case "$1" in
      --name | --text)
        if (($# < 2)) || [[ -z "$2" ]]; then
          echo "$1 needs a value." >&2
          return 2
        fi
        terms+=("$1" "$2")
        count=$((count + 1))
        shift 2
        ;;
      *) echo "Unknown argument: $1" >&2; usage; return 2 ;;
    esac
  done
  if ((count == 0)); then
    echo "Nothing to search for: pass at least one --name or --text." >&2
    return 2
  fi
  if [[ ! -e "$target" ]]; then
    echo "Cannot check: '$target' does not exist. Build the release artifact first." >&2
    return 2
  fi
  if [[ -z "$(find "$target" -type f -print -quit)" ]]; then
    echo "Cannot check: '$target' contains no files. An empty build proves nothing." >&2
    return 2
  fi

  local work status=0
  work="$(mktemp -d)"
  if [[ -d "$target" ]]; then
    cp -R "$target/." "$work/"
  else
    cp "$target" "$work/"
  fi
  unpack_all "$work" || status=$?
  if ((status == 0)); then
    search "$work" "$target" "${terms[@]}" || status=$?
  fi
  rm -rf "$work"
  return "$status"
}

expect() {
  local want="$1" label="$2"
  shift 2
  local got=0
  scan "$@" >/dev/null 2>&1 || got=$?
  if [[ "$got" == "$want" ]]; then
    echo "self-test PASS: $label (exit $got)"
    return 0
  fi
  echo "self-test FAIL: $label (expected exit $want, got $got)" >&2
  return 1
}

self_test() {
  local root failures=0
  root="$(mktemp -d)"
  mkdir -p "$root/clean/assets" "$root/leaked-file/assets" "$root/leaked-text" "$root/empty" "$root/zip-src"
  printf 'console.log("orders")\n' > "$root/clean/assets/app.js"
  printf 'console.log("orders")\n' > "$root/leaked-file/assets/app.js"
  printf 'self.addEventListener("fetch", () => {})\n' > "$root/leaked-file/mockServiceWorker.js"
  printf 'new FakeOrdersSource()\n' > "$root/leaked-text/app.js"
  printf 'new FakeOrdersSource()\n' > "$root/zip-src/classes.txt"
  (cd "$root/zip-src" && zip -qq "$root/app-release.apk" classes.txt)
  mkdir -p "$root/nested-src/BOOT-INF/lib"
  for _ in $(seq 200); do printf 'new FakeOrdersSource()\n'; done > "$root/nested-src/classes.txt"
  (cd "$root/nested-src" && zip -qq -9 BOOT-INF/lib/lib-debug.jar classes.txt && zip -qq -0 -r "$root/service.jar" BOOT-INF/lib/lib-debug.jar)
  mkdir -p "$root/exported/app"
  cp "$root/nested-src/BOOT-INF/lib/lib-debug.jar" "$root/exported/app/service.jar"
  printf 'not a zip archive\n' > "$root/broken.jar"
  printf 'com.example.RealOrdersSource -> a.b:\n' > "$root/mapping-clean.txt"
  printf 'com.example.FakeOrdersSource -> a.c:\n' > "$root/mapping-leaked.txt"
  mkdir -p "$root/layer-src/app/lib" "$root/exported-tar"
  for _ in $(seq 200); do printf 'new FakeOrdersSource()\n'; done > "$root/layer-src/app/lib/classes.txt"
  tar -czf "$root/image.tar.gz" -C "$root/layer-src" app
  tar -cf "$root/exported-tar/layer.tar" -C "$root/layer-src" app
  gzip -c "$root/layer-src/app/lib/classes.txt" > "$root/app.js.gz"
  printf '7z\274\257\047\034' > "$root/bundle.7z"

  expect 0 "clean build passes" "$root/clean" --name mockServiceWorker.js --text FakeOrdersSource || failures=$((failures + 1))
  expect 1 "leaked worker file is caught" "$root/leaked-file" --name mockServiceWorker.js || failures=$((failures + 1))
  expect 1 "leaked class name is caught" "$root/leaked-text" --text FakeOrdersSource || failures=$((failures + 1))
  expect 1 "leak inside an archive is caught" "$root/app-release.apk" --text FakeOrdersSource || failures=$((failures + 1))
  expect 1 "leak inside a nested archive is caught" "$root/service.jar" --text FakeOrdersSource || failures=$((failures + 1))
  expect 1 "leak inside an archive in a build folder is caught" "$root/exported" --text FakeOrdersSource || failures=$((failures + 1))
  expect 1 "leak inside a gzipped tar is caught" "$root/image.tar.gz" --text FakeOrdersSource || failures=$((failures + 1))
  expect 1 "leak inside a tar in a build folder is caught" "$root/exported-tar" --text FakeOrdersSource || failures=$((failures + 1))
  expect 1 "leak inside a gzip-compressed file is caught" "$root/app.js.gz" --text FakeOrdersSource || failures=$((failures + 1))
  expect 2 "an archive that won't unpack cannot pass" "$root/broken.jar" --text FakeOrdersSource || failures=$((failures + 1))
  expect 2 "a 7z archive that won't unpack cannot pass" "$root/bundle.7z" --text FakeOrdersSource || failures=$((failures + 1))
  expect 2 "a search term with no value cannot pass" "$root/clean" --name || failures=$((failures + 1))
  expect 0 "clean single file passes" "$root/mapping-clean.txt" --text FakeOrdersSource || failures=$((failures + 1))
  expect 1 "leak in a single file is caught" "$root/mapping-leaked.txt" --text FakeOrdersSource || failures=$((failures + 1))
  expect 2 "empty build cannot pass" "$root/empty" --text FakeOrdersSource || failures=$((failures + 1))
  expect 2 "missing build cannot pass" "$root/does-not-exist" --text FakeOrdersSource || failures=$((failures + 1))
  expect 2 "no search terms cannot pass" "$root/clean" || failures=$((failures + 1))

  rm -rf "$root"
  if ((failures)); then
    echo "self-test FAILED: $failures case(s) wrong." >&2
    return 1
  fi
  echo "self-test PASSED: the check catches leaks and refuses to pass on nothing."
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
elif (($# == 0)) || [[ "$1" == "--help" || "$1" == "-h" ]]; then
  usage
  exit 2
else
  scan "$@"
fi
