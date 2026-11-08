# BinSight: business demo

**Live site:** https://pasbean61.github.io/binsight-business-demo/

A customer-facing website for BinSight, a service that forecasts how full every communal bin will be tomorrow and plans the collection rounds overnight. It turns the [BinSight Edinburgh research project](https://github.com/Pasbean61/binsight-edinburgh) ([live study](https://pasbean61.github.io/binsight-edinburgh/)) into a product a council, a housing association or a resident could actually use and pay for.

The research site explains *how the model works*. This site explains *what a customer gets, what it costs and why it is safe to say yes*.

## The business model

| Plan | Who | Price | Why it wins |
|---|---|---|---|
| **Free pilot** | Councils | £0 for 90 days, up to 300 bin stops | 4 weeks in shadow mode, 9 live against matched control areas. The council keeps the report either way. |
| **Savings Share** | Councils | 25 % of *verified* savings, £0 upfront | No saving, no fee. Uses existing sensors (Edinburgh already has about 11,000) or we fit ours free. **Overflow guarantee:** £60 credit per overflow above the pilot baseline. |
| **Spare Shift** | Councils | 15 % of bookings | Truck time freed by better routes (65 truck-hours a day in the Edinburgh simulation) becomes bookable bulky uplifts, trade waste and event clean-ups. The council keeps 85 %. Hours sold are never also billed as savings. |
| **BinSight Estates** | Housing associations, universities, hotels | £4 per bin a month, sensor included | The contractor is called only when a bin is nearly full. |
| **Resident app** | Residents | Free | "Is my bin being emptied tomorrow?" plus two-tap problem reports that feed the next night's plan. |

What sets it apart from the usual offers (fixed timetables, sensors sold with a licence, route-planning software):

- the risk sits with the vendor, not the council;
- the fee comes only from savings measured against control areas;
- overflows are guaranteed;
- freed hours become new income.

All prices are our proposal for the demo.

## What is real and what is simulated

- **Real:** the 4,532 communal bin stops and 10,657 bins (City of Edinburgh Council register), streets and road network (OpenStreetMap), the 17 wards (ONS), weather (Open-Meteo), and the facts quoted on the page. Every quoted fact is linked to its source.
- **Simulated:** the bin fill levels and every result that depends on them: tomorrow's plan, the 34 truck routes, and the comparison against the timetable over 7 days × 2 runs. Live sensor readings are not public. The page labels every such figure *Simulated*.

The savings calculator scales the simulation per bin stop (£494 a year per stop at £1.45/km, £75/truck-hour, £60/overflow). It defaults to counting half of that, as a cautious planning case.

## Page sections

- **Hero:** the map replays tomorrow's real routes from 06:00 to 14:00.
- **Proof strip and the problem:** sourced facts.
- **How it works.**
- **Product:** three screens built from the real plan: the control room, the driver run sheet and the resident app.
- **Street lookup:** for residents.
- **Pricing.**
- **Savings calculator.**
- **Comparison table.**
- **How savings are verified:** with the pilot timeline.
- **FAQ, and a pilot request form.** The form is a demo and sends nothing.

## Build

The page is one self-contained HTML file with no frameworks. Fonts come from Google Fonts.

```bash
python3 scripts/make_data.py ../binsight-edinburgh   # optional: refresh data/demo.json from the research repo
python3 scripts/build.py                             # writes index.html and site/binsight-business.html
```

```
src/page.html     page content
src/style.css     design tokens (light and dark) and components
src/app.js        map animation, product screens, street search, calculator, form
data/demo.json    data derived from the research model (stops, routes, results)
scripts/          data extraction and build
```

`index.html` is what GitHub Pages serves. `site/binsight-business.html` is the same page without the document skeleton, for publishing as an artifact.

---

A business demo by EMS Group 6, University of Edinburgh.
