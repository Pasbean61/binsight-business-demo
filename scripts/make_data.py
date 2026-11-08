"""Derive data/demo.json for the business site from the BinSight research repository.

    python3 scripts/make_data.py ../binsight-edinburgh

Everything comes from that repository's model output (data/*.json), which is built from real
Edinburgh inputs (council bin register, ONS wards, OpenStreetMap, Open-Meteo weather) and a
simulation of fill levels. Nothing here is typed in by hand.
"""
import json, os, sys

SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "binsight-edinburgh"))
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "demo.json")
load = lambda f: json.load(open(os.path.join(SRC, "data", f)))
site, stops, routes, base = load("site.json"), load("stops.json"), load("routes.json"), load("basemap.json")

n = len(stops["id"])
names = sorted(set(stops["site"]))
ix = {s: k for k, s in enumerate(names)}
# stop i → which truck (index into trucks), its order on that truck, arrival minute after 06:00
S = {
    "lat": [round(v, 5) for v in stops["lat"]], "lon": [round(v, 5) for v in stops["lon"]],
    "site": [ix[s] for s in stops["site"]], "nb": stops["nb"], "ward": stops["ward"],
    "fill": [round(v) for v in stops["fill"]], "pred": [round(min(v, 150)) for v in stops["pred"]],
    "truck": stops["truck"], "eta": stops["eta"],
}
trucks = []
for t in routes["routes"]:
    trucks.append({"id": t["truck"], "km": t["km"], "hours": t["hours"],
                   "trips": [{"stops": tr["stops"], "eta": tr["eta"], "line": tr["line"], "start": tr["start"], "end": tr["end"],
                              "km": tr["road_km"]} for tr in t["trips"]]})

ag = {a["policy"]: a for a in site["experiments"]["aggregate"]}
keep = ("overflow_events_day", "overflow_bin_hours_day", "collections_day", "km_day", "truck_hours_day", "trucks_mean",
        "fill_at_collection", "share_under_40", "route_cost_day", "cost_day")
P = site["plan"]
facts = {
    "plan_day": site["plan_day"], "snapshot": site["snapshot"],
    "stops": n, "bins": site["totals"]["bins"], "records": site["totals"]["general_waste_records"],
    "road_km": site["totals"]["road_km"], "wards": len(site["wards"]),
    "plan": {"served": P["served"], "trucks": P["trucks_used"], "trips": P["trips"], "road_km": P["road_km"],
             "hours": P["hours"], "co2_kg": P["co2_kg"], "last_back_min": max(tr["end"] for t in routes["routes"] for tr in t["trips"])},
    "fleet": {k: site["fleet"][k] for k in ("trucks", "capacity_l", "shift_min", "start_h", "cost_km", "cost_hour", "cost_overflow", "fuel_l_per_km", "co2_kg_per_l")},
    "sim": {p: {k: round(ag[p][k], 4) for k in keep} for p in ("timetable", "reactive", "binsight")},
    "sim_days": site["experiments"]["eval_days"], "sim_seeds": len(site["experiments"]["seeds"]),
    "sim_start": site["experiments"]["eval_start"],
    "wards_plan": [{"name": w["name"], "stops": w["stops"], "flagged": w["flagged"], "served": w["served"], "trucks": len(w["trucks"])} for w in site["wards"]],
}
basemap = {"wards": [{"name": w["name"], "rings": w["rings"]} for w in base["wards"]],
           "roads": base["roads"].get("major", []), "water": [w["line"] for w in base["water"]],
           "parks": [p["ring"] for p in base["parks"] if p.get("k") == "park"][:160]}
out = {"facts": facts, "names": names, "stops": S, "trucks": trucks, "depot": routes["depot"], "base": basemap}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, "w"), separators=(",", ":"), allow_nan=False)
print(f"{n} stops, {len(trucks)} trucks, {len(names)} street names → {OUT} ({os.path.getsize(OUT) / 1e3:.0f} kB)")
