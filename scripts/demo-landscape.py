# Procedural landscape for the Code Face landing demo. No photo, no person: maths only.
# Usage: python scripts/demo-landscape.py out.png   (needs numpy and Pillow; 1200 x 800)
# The landing's stage files in public/demo/ were fitted from this picture; see docs/landing-demo.md.
import numpy as np
from PIL import Image, ImageFilter
import sys
W, H = 1200, 800
rng = np.random.default_rng(7)
y = np.linspace(0, 1, H)[:, None]
x = np.linspace(0, 1, W)[None, :]

def lerp(a, b, t):
    return a + (np.array(b, float) - a) * t[..., None]

def noise1d(n, octaves, seed):
    r = np.random.default_rng(seed)
    out = np.zeros(n)
    for o in range(octaves):
        k = 2 ** o * 3
        pts = r.uniform(-1, 1, k + 2)
        xs = np.linspace(0, k, n)
        out += np.interp(xs, np.arange(k + 2), pts) / (1.6 ** o)
    return out

horizon = 0.58
# Sky: deep blue top -> violet -> warm orange at the horizon.
t = np.clip(y / horizon, 0, 1) * np.ones((1, W))
sky = np.where(t[..., None] < 0.55,
               lerp(np.array([22, 36, 82.]), [120, 86, 140], t / 0.55),
               lerp(np.array([120, 86, 140.]), [250, 160, 92], (t - 0.55) / 0.45))
img = sky.copy()
# Sun and glow.
sx, sy = 0.64, 0.36
d = np.sqrt(((x - sx) * 1.5) ** 2 + (y - sy) ** 2)
glow = np.exp(-(d / 0.16) ** 2)[..., None]
img = img + glow * (np.array([255, 200, 120.]) - img) * 0.75
sun = (d < 0.05)[..., None]
img = np.where(sun, np.array([255, 238, 190.]), img)
# Clouds: stretched soft streaks.
for cx, cy, cw, ch, a in [(0.22, 0.18, 0.22, 0.018, .5), (0.5, 0.26, 0.3, 0.014, .45), (0.82, 0.13, 0.18, 0.016, .4), (0.35, 0.34, 0.2, 0.01, .35)]:
    c = np.exp(-(((x - cx) / cw) ** 2 + ((y - cy) / ch) ** 2))[..., None]
    img = img + c * a * (np.array([255, 190, 170.]) - img)
# Mountain ridges, back to front, with atmospheric perspective.
ridges = [
    (0.43, 0.08, 6, 11, [170, 112, 140]),
    (0.47, 0.09, 7, 23, [96, 70, 118]),
    (0.53, 0.07, 7, 31, [58, 50, 84]),
]
land = np.zeros((H, W), bool)
for base, amp, octv, seed, col in ridges:
    h = base + amp * noise1d(W, octv, seed)
    h = np.minimum(h, horizon)
    m = (y >= h[None, :]) & (y < horizon)
    shade = np.clip((y - h[None, :]) / 0.15, 0, 1)[..., None]
    c = np.array(col, float) * (1 - 0.25 * shade)
    img = np.where(m[..., None], c, img)
# Lake: reflection of everything above the horizon, darkened, with ripples.
ry = (2 * horizon - y[:, 0])
for j in range(int(horizon * H), H):
    if j == int(horizon * H): img[j] = img[j-1] * 0.7; continue
    src = int(np.clip(ry[j] * H, 0, H - 1))
    depth = (j / H - horizon) / (1 - horizon)
    ripple = int(4 * np.sin(j * 0.9) * (0.3 + depth))
    row = np.roll(img[src], ripple, axis=0)
    img[j] = row * (0.62 - 0.25 * depth) + np.array([20, 30, 60.]) * (0.38 + 0.25 * depth)
# Shimmer of the sun on the water.
sh = np.exp(-((x - sx) / 0.03) ** 2) * (y > horizon) * (np.sin(y * 900) > 0.4) * np.exp(-((y - horizon) / 0.12) ** 2)
img = img + sh[..., None] * (np.array([255, 210, 150.]) - img) * 0.7
# Foreground shore on the left with pine silhouettes.
shore = 0.80 + 0.04 * noise1d(W, 5, 41) + 0.25 * np.clip(x[0] - 0.55, 0, 1) ** 2 * 0
fg = (y >= (shore[None, :] + 0.18 * np.clip(x - 0.42, 0, 1)))
img = np.where(fg[..., None], np.array([16, 22, 30.]), img)
r = np.random.default_rng(5)
for i in range(14):
    tx = r.uniform(0.0, 0.40) if i < 11 else r.uniform(0.9, 1.0)
    base = shore[int(tx * (W - 1))] + 0.18 * max(tx - 0.42, 0) + 0.01
    th = r.uniform(0.16, 0.34)
    tw = th * r.uniform(0.22, 0.3)
    top = base - th
    rel = np.clip((y - top) / th, 0, 1)
    saw = 0.55 + 0.45 * ((rel * 6) % 1)
    tri = (y >= top) & (y <= base) & (np.abs(x - tx) * 1.5 <= tw * rel * saw * 0.6 + 0.002)
    img = np.where(tri[..., None], np.array([12, 17, 24.]), img)
img = np.clip(img, 0, 255).astype(np.uint8)
im = Image.fromarray(img).filter(ImageFilter.GaussianBlur(0.8))
im.save(sys.argv[1])
print(im.size)
