"""Development-only TIFF oracle; requires Pillow. No user image inputs."""
import json
import pathlib
import sys
from PIL import Image

out = pathlib.Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
expected = []
for mode, bits, width, height in [('I;16', 16, 61, 37), ('I;16B', 16, 61, 37), ('L', 8, 67, 41), ('RGB', 8, 67, 41)]:
    values = [(i * 11927 + 1) % (65536 if bits == 16 else 256) for i in range(width * height * (3 if mode == 'RGB' else 1))]
    raw = b''.join(v.to_bytes(2, 'big' if mode.endswith('B') else 'little') for v in values) if bits == 16 else bytes(values)
    image = Image.frombytes(mode, (width, height), raw)
    pixels = []
    for i in range(width * height):
        color = values[i*3:i*3+3] if mode == 'RGB' else [values[i]] * 3
        pixels.extend([v * (257 if bits == 8 else 1) for v in color] + [65535])
    for compression in ['raw', 'tiff_lzw', 'tiff_adobe_deflate', 'packbits']:
        name = mode.replace(';', '-') + '-' + compression + '.tiff'
        image.save(out / name, compression=compression)
        expected.append(dict(file=name, width=width, height=height, bits=bits, pixels=pixels))
(out / 'expected.json').write_text(json.dumps(expected), encoding='utf8')
print('Generated', len(expected), 'independent TIFF fixtures')
