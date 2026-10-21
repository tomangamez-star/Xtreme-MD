"""Render Telegram's vector animation to bounded PNG frames for FFmpeg."""
import gzip
import io
import math
import resource
import sys
from pathlib import Path
from lottie.parsers.tgs import parse_tgs
from lottie.exporters.cairo import export_png

# Bound decompression and process memory for remotely supplied vector data.
resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
with gzip.open(sys.argv[1], 'rb') as source:
    data = source.read(2 * 1024 * 1024 + 1)
if len(data) > 2 * 1024 * 1024:
    raise ValueError('Expanded animation is too large')
animation = parse_tgs(io.BytesIO(data))
rate = float(animation.frame_rate)
start, end = float(animation.in_point), float(animation.out_point)
if not all(math.isfinite(v) for v in (rate, start, end)) or rate <= 0 or end <= start:
    raise ValueError('Invalid animation timing')
fps = 20
count = max(2, math.ceil(min((end - start) / rate, 10) * fps))
if not (0 < animation.width <= 512 and 0 < animation.height <= 512):
    raise ValueError('Invalid Telegram animation dimensions')
destination = Path(sys.argv[2])
for index in range(count):
    with (destination / ('frame-%04d.png' % index)).open('wb') as output:
        export_png(animation, output, start + index * rate / fps)
