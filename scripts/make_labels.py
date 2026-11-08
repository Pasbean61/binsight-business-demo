"""Street and place names for the fallback map (the one drawn when street tiles can't load, e.g. in an artifact).

    curl ... overpass ... > cache/osm_labels.json     (see README; OpenStreetMap, ODbL)
    python3 scripts/make_labels.py

Writes data/labels.json: one label point per stretch of named street (mid-way along it, with the street's
angle there) and every named suburb, neighbourhood, town and village around Edinburgh.
"""
import json, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
osm = json.load(open(os.path.join(ROOT, "cache", "osm_labels.json")))["elements"]
KX = 111320 * math.cos(math.radians(55.95)); KY = 110540
RANK = {"trunk": 0, "primary": 0, "secondary": 1, "tertiary": 2}
PLACE = {"town": 0, "suburb": 1, "village": 1, "quarter": 2, "neighbourhood": 2, "hamlet": 3}

places, cand = [], []
for e in osm:
    t = e.get("tags", {})
    if e["type"] == "node":
        places.append([t["name"], round(e["lat"], 5), round(e["lon"], 5), PLACE.get(t.get("place"), 3)])
        continue
    g = e.get("geometry") or []
    if len(g) < 2:
        continue
    xy = [(p["lon"] * KX, p["lat"] * KY) for p in g]
    seg = [math.dist(xy[i], xy[i + 1]) for i in range(len(xy) - 1)]
    L = sum(seg)
    if L < (50 if t["highway"] in RANK else 110):      # a short side street's name can't be read on the map anyway
        continue
    half, acc = L / 2, 0
    for i, s in enumerate(seg):
        if acc + s >= half:
            f = (half - acc) / s if s else 0
            lat = g[i]["lat"] + f * (g[i + 1]["lat"] - g[i]["lat"]); lon = g[i]["lon"] + f * (g[i + 1]["lon"] - g[i]["lon"])
            # the street's direction around the label: 60 m either side of the mid point, smoothed
            a = math.degrees(math.atan2(-(xy[min(i + 1, len(xy) - 1)][1] - xy[i][1]), xy[min(i + 1, len(xy) - 1)][0] - xy[i][0]))
            break
        acc += s
    if a > 90: a -= 180
    if a < -90: a += 180
    cand.append((t["name"], lat, lon, round(a), RANK.get(t["highway"], 3), round(L)))

# per street name, keep the longest stretches, at least 400 m apart
cand.sort(key=lambda c: -c[5])
kept, by = [], {}
for c in cand:
    pts = by.setdefault(c[0], [])
    if any(math.hypot((c[2] - q[2]) * KX, (c[1] - q[1]) * KY) < 400 for q in pts):
        continue
    pts.append(c); kept.append(c)
names = sorted({c[0] for c in kept})
ix = {n: i for i, n in enumerate(names)}
kept.sort(key=lambda c: (c[4], -c[5]))       # draw order = priority: big roads and long streets first
out = {"street_names": names,
       # lat/lon as integers in 1e-5 degrees from 55°N, 3°W, to keep the file small
       "streets": [[ix[c[0]], round((c[1] - 55) * 1e5), round((c[2] + 3) * 1e5), c[3], c[4], c[5]] for c in kept],
       "places": sorted(places, key=lambda p: p[3])}
json.dump(out, open(os.path.join(ROOT, "data", "labels.json"), "w"), separators=(",", ":"), ensure_ascii=False)
print(f"{len(kept)} street labels ({len(names)} names), {len(places)} places → data/labels.json ({os.path.getsize(os.path.join(ROOT, 'data', 'labels.json')) / 1e3:.0f} kB)")
