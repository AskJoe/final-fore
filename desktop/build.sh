#!/bin/zsh
# Builds "Final Fore.app" into desktop/build. Needs only Apple's Command Line Tools.
# Pass --install to also copy the app into /Applications.
set -euo pipefail
cd -- "${0:A:h}"

out="build"
app="$out/Final Fore.app"
rm -rf "$app" "$out/AppIcon.iconset"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$out/AppIcon.iconset"

# One binary that runs on Apple silicon and Intel Macs.
for arch in arm64 x86_64; do
  clang -O2 -fobjc-arc -Wall -target "$arch-apple-macos13.0" \
    -framework Cocoa -framework WebKit FinalFore/main.m -o "$out/FinalFore-$arch"
done
lipo -create "$out/FinalFore-arm64" "$out/FinalFore-x86_64" -output "$app/Contents/MacOS/FinalFore"
rm "$out/FinalFore-arm64" "$out/FinalFore-x86_64"

clang -fobjc-arc -framework Cocoa make-icon.m -o "$out/make-icon"
"$out/make-icon" ../public/brand/final-fore-monogram.png "$out/AppIcon-1024.png"
rm "$out/make-icon"
for size in 16 32 128 256 512; do
  sips -z $size $size "$out/AppIcon-1024.png" --out "$out/AppIcon.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$out/AppIcon-1024.png" --out "$out/AppIcon.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$out/AppIcon.iconset" -o "$app/Contents/Resources/AppIcon.icns"
rm -rf "$out/AppIcon.iconset"

cp Info.plist "$app/Contents/Info.plist"
codesign --force --sign - "$app" >/dev/null 2>&1
print "Built $PWD/$app"

if [[ "${1:-}" == "--install" ]]; then
  rm -rf "/Applications/Final Fore.app"
  ditto "$app" "/Applications/Final Fore.app"
  print "Installed /Applications/Final Fore.app"
fi
