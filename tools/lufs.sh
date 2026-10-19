#!/usr/bin/env bash
# Print integrated loudness (LUFS) of every stem in a gfx audio stems dir (or of the given wav files).
# usage: tools/lufs.sh out/<name>/audio/stems   |   tools/lufs.sh a.wav b.wav
files=("$@")
if [ "$#" -eq 1 ] && [ -d "$1" ]; then files=("$1"/*.wav); fi
for f in "${files[@]}"; do
  v=$(ffmpeg -nostats -hide_banner -i "$f" -af ebur128 -f null - 2>&1 | grep -A1 "Integrated loudness" | grep "I:" | awk '{print $2}')
  echo "$(basename "$f" .wav) $v"
done
