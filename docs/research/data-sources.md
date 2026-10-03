# CLIMATIQ — Data Sources Research

> Verified on **2026-10-03** against official docs and live endpoints (curl/WebFetch).
> CLIMATIQ is a **decision-support MVP, not an official warning system**. Anything not verified is marked **UNVERIFIED**.

---

## 0. Decisions / Recommendations (read this first)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Forecast data | **Open-Meteo Forecast API** (`https://api.open-meteo.com/v1/forecast`). No key. Request a **7-day** horizon (the max is 16) and highlight days 1–5, which is the window IMD uses for its heat warnings. Pass all locations in **one batched request** (comma-separated lat/lon). 150 points in one call worked in testing. Response = JSON **array**. |
| D2 | Historical / baseline data | **Open-Meteo Historical Weather API** (`https://archive-api.open-meteo.com/v1/archive`). Use `models=era5` (or `era5_land`) for baselines and normals so the series stays consistent. The default `best_match` blends ERA5 and IFS and fills the last ~5 days. Do a **one-time backfill into Postgres** and never call it per page view. |
| D3 | Rate budget | Free tier: **600/min, 5,000/h, 10,000/day, 300,000/month**. Cost is weighted by `variables/10 × max(1, days/14) × locations`, with a minimum of 1 per location. So a 7-day forecast costs about 1 call per location, while a 30-year normal for 2 variables costs about 156 calls per location. Refresh forecasts every 3–6 h, not per request. |
| D4 | Licence / attribution | Open-Meteo data is **CC BY 4.0**. Show a visible link reading "Weather data by Open-Meteo.com". A hackathon app with no ads and no subscriptions matches Open-Meteo's own **non-commercial** examples (this is our reading of the terms). |
| D5 | Heatwave logic | Implement the **IMD FAQ criteria** exactly (§2.1), but label the output **"IMD-criteria-based indicator"**, never "IMD declared heatwave". IMD declares from **station** data against **1991–2020 station normals**, and needs ≥2 stations in a met subdivision on 2 consecutive days. |
| D6 | IMD integration | **Do not depend on the IMD API for the MVP.** `api.imd.gov.in` needs registration plus an API key (verified: `{"error":"API key missing"}`). The legacy endpoints need **IP whitelisting** (verified: `IP … needs to be whitelisted`). Optionally ingest the **IMD Pune gridded Tmax** data (no key, binary `.grd`) as an "observed" layer. Redistribution terms for that data are not published. |
| D7 | States boundary | **geoBoundaries IND ADM1** (36 states/UTs, sourced from DataMeet, **CC BY 2.5 IN**). It follows India's official claim (point-tested, §3.2) and carries ISO 3166-2 codes in `shapeISO`. Raw URL in §3.3. |
| D8 | Districts boundary | **geoBoundaries IND ADM2** (735 polygons, 2021, sourced from LGD/Pathways, **ODbL 1.0**). It follows India's official claim (point-tested). Caveat: it has **no state key**, so run a one-time spatial join to ADM1. Raw URL in §3.3. |
| D9 | Cities / localities | **GeoNames `cities15000`** (CC BY 4.0). It contains **3,779 Indian places**. URL: `https://download.geonames.org/export/dump/cities15000.zip`. |
| D10 | Pilot states (6) | **Rajasthan, Uttar Pradesh, Odisha, Andhra Pradesh, Maharashtra (Vidarbha), Himachal Pradesh.** This covers plains, coastal and hilly criteria. Alternate: swap AP for **Telangana**, because the AP districts in the recommended file predate AP's 2022 reorganisation (§4). |
| D11 | Disclaimer | The map footer must say: not an official IMD warning; boundaries are approximate and not authenticated by Survey of India; see §6 for the attribution block. |

---

## 1. Open-Meteo

### 1.1 Forecast API — verified

- **Endpoint:** `https://api.open-meteo.com/v1/forecast` ([docs](https://open-meteo.com/en/docs))
- **Daily variables listed in the docs:** `weather_code, temperature_2m_max, temperature_2m_mean, temperature_2m_min, apparent_temperature_max, apparent_temperature_mean, apparent_temperature_min, precipitation_sum, rain_sum, showers_sum, snowfall_sum, precipitation_hours, precipitation_probability_max/mean/min, sunrise, sunset, sunshine_duration, daylight_duration, wind_speed_10m_max, wind_gusts_10m_max, wind_direction_10m_dominant, shortwave_radiation_sum, et0_fao_evapotranspiration, uv_index_max, uv_index_clear_sky_max` ([docs](https://open-meteo.com/en/docs)).
  - These also worked in a live call: `relative_humidity_2m_max/min/mean` and `wet_bulb_temperature_2m_max`. Use them for a humid-heat signal.
- **Horizon:** the default is 7 days and the max is **16**, set with `forecast_days=` ([docs](https://open-meteo.com/en/docs)). A live call with `forecast_days=16` returned HTTP 200.
- **`past_days`:** max **92** ([docs](https://open-meteo.com/en/docs)).
- **`timezone`:** "If timezone is set, all timestamps are returned as local-time and data is returned starting at 00:00 local-time … If `auto` is set … resolved to the local time zone." For multiple coordinates you can pass a comma-separated list of timezones ([docs](https://open-meteo.com/en/docs)). For India, use `timezone=Asia%2FKolkata`, which returned `utc_offset_seconds: 19800`.
- **Multiple coordinates:** "Multiple coordinates can be comma separated. E.g. `&latitude=52.52,48.85&longitude=13.41,2.35`. To return data for multiple locations the JSON output changes to a list of structures. CSV and XLSX formats add a location_id column." ([docs](https://open-meteo.com/en/docs))
  - **Verified response shape:** a top-level JSON **array** in the same order as the input. Each element has `latitude, longitude, elevation, utc_offset_seconds, timezone, daily_units, daily{time[], <var>[]}`.
  - Gotcha: the first element has **no `location_id` key**, and later ones carry `location_id: 1, 2, …`. Use the array index, or treat a missing `location_id` as 0.
  - Gotcha: the returned lat/lon are **snapped to the model grid** (Delhi 28.6139,77.2090 came back as 28.576,77.187). Store your own location ID and ignore the echoed coordinates.
  - A single request with **150 coordinates** worked (URL ≈ 1.9 KB). The maximum number of coordinates per request is **not documented**, so keep batches at 100 or fewer to be safe.
- **Default model:** "best match" ([docs](https://open-meteo.com/en/docs)).

### 1.2 Historical Weather (archive) API — verified

- **Endpoint:** `https://archive-api.open-meteo.com/v1/archive` ([docs](https://open-meteo.com/en/docs/historical-weather-api))
- **Range:** "data dating back to **1940**". Live check: 1940-01-01 worked, and asking for a future date returned `"end_date' is out of allowed range from 1940-01-01 to 2026-10-03"`.
- **Delay:** ERA5 and ERA5-Land are updated "Daily with **5 days delay**". ECMWF IFS updates "Every 6 hours with no delay" ([docs](https://open-meteo.com/en/docs/historical-weather-api)).
  - Live check on 2026-10-03: `models=era5` returned **`null` from 2026-09-28 onward**. The default (best_match) returned values up to today because it fills recent days from IFS.
- **Models:** ERA5 (0.25°), ERA5-Land (0.1°), CERRA (Europe only), ECMWF IFS (9 km). "The default Best Match combines IFS HRES, ERA5 and ERA5-Land seamlessly." `era5_seamless` is also offered. The docs also advise: "When studying climate change over decades, it is advisable to exclusively utilise ERA5 or ERA5-Land" ([docs](https://open-meteo.com/en/docs/historical-weather-api)). `models=era5`, `era5_land`, `era5_seamless` and `best_match` all returned data in live calls.
- **Daily variables (archive):** `temperature_2m_max/min/mean, apparent_temperature_max/min/mean, relative_humidity_2m_mean/max/min, dew_point_2m_*, wet_bulb_temperature_2m_*, wind_speed_10m_max/mean, wind_gusts_10m_*, shortwave_radiation_sum, precipitation_sum, et0_fao_evapotranspiration, sunshine_duration, …` ([docs](https://open-meteo.com/en/docs/historical-weather-api)).
- **Multi-location:** supported with comma-separated coordinates ([docs](https://open-meteo.com/en/docs/historical-weather-api)). Verified with two cities: it returns an array, same as the forecast API.
- **Params:** `start_date`, `end_date` (yyyy-mm-dd), both required.

### 1.3 Historical Forecast API — FYI

- Endpoint `https://historical-forecast-api.open-meteo.com/v1/forecast`. It holds archived model forecasts, with coverage "starts around 2022" (GFS from Mar 2021, IFS HRES from Jan 2017). The docs say it is "Not suitable for long time series" ([docs](https://open-meteo.com/en/docs/historical-forecast-api)).
- Useful later for **forecast verification**. Not needed for the MVP.

### 1.4 Free-tier terms, limits, attribution — verified

- **Limits:** "Less than 10'000 API calls per day, 5'000 per hour and 600 per minute" ([terms](https://open-meteo.com/en/terms)). The pricing page also lists **300,000 calls/month** ([pricing](https://open-meteo.com/en/pricing)).
- **API key:** none for the free tier. Keys are only issued on paid plans for the customer endpoint ([pricing](https://open-meteo.com/en/pricing)).
- **Non-commercial examples** ([terms](https://open-meteo.com/en/terms)):
  - "private or non-profit websites or apps that do not have subscriptions or advertising"
  - "personal home automation"
  - "public research conducted at public institutions"
  - "Incorporating our service into educational content"
- **Commercial examples** ([terms](https://open-meteo.com/en/terms)): sites or apps with subscriptions or ads, "commercial products or promotional activities".
- → **Our reading:** a hackathon / open-source MVP with no ads and no subscriptions qualifies. If CLIMATIQ is ever monetised, it needs a paid plan.
- **Blocking:** "We reserve the right to block applications and IP addresses that misuse our service without prior notice." ([terms](https://open-meteo.com/en/terms))
- **No warranty:** "Open-Meteo assumes no responsibility for any inaccuracies or omissions in the data" ([terms](https://open-meteo.com/en/terms)). This supports our "not an official warning" stance.
- **How calls are counted** ([pricing](https://open-meteo.com/en/pricing)):
  - "Requests for data covering more than 10 weather variables or extending over a period of more than 2 weeks for a single location are considered multiple API calls … 2 weeks of data with 15 weather variables will be calculated as 1.5 API calls, while 4 weeks of data equals 3.0 API calls."
  - The page's calculator also has a **Locations** multiplier. Its JS computes `max(1, (vars×models/10) × max(1, days/14)) × locations`. We extracted this from the page bundle; treat it as a close estimate.
  - Budget examples:
    - 7-day forecast, ≤10 variables: **1 call/location**. 200 district points every 3 h = 1,600 calls/day.
    - 5-year daily Tmax (1 variable, 1,826 days): **≈13 calls/location**.
    - 1991–2020 normals for Tmax + Tmin (10,958 days, 2 variables): **≈156.5 calls/location**. 200 points ≈ 31,300 calls, so spread the backfill over **≥4 days**, or use fewer points or a shorter baseline.
- **Attribution (CC BY 4.0)** ([licence](https://open-meteo.com/en/licence)):
  - Place the snippet `<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>` "or equivalent next to any location where Open-Meteo data appears".
  - CC BY 4.0 also requires a link to the licence and to "indicate if changes were made". We do derive indices, so state "derived/processed by CLIMATIQ".

### 1.5 Example URLs (both tested live, HTTP 200)

**7-day forecast for Delhi + Jaipur (one request):**
```
https://api.open-meteo.com/v1/forecast?latitude=28.6139,26.9124&longitude=77.2090,75.7873&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,relative_humidity_2m_mean,relative_humidity_2m_min,wind_speed_10m_max,shortwave_radiation_sum,wet_bulb_temperature_2m_max&timezone=Asia%2FKolkata&forecast_days=7
```

**5-year daily max temperature archive (Delhi, 2021-01-01 → 2025-12-31, ERA5):**
```
https://archive-api.open-meteo.com/v1/archive?latitude=28.6139&longitude=77.2090&start_date=2021-01-01&end_date=2025-12-31&daily=temperature_2m_max&timezone=Asia%2FKolkata&models=era5
```
(This was tested with the default model too. With `models=era5` the series stays consistent across years.)

---

## 2. IMD (India Meteorological Department)

### 2.1 Official heatwave criteria — verified from IMD's own FAQ

Source: **IMD "FAQ on Heat Wave"**: https://internal.imd.gov.in/section/nhac/dynamic/FAQ_heat_wave.pdf (16 pp., fetched 2026-10-03)

| Rule | Exact IMD criterion |
|------|---------------------|
| Eligibility threshold | "Heat wave is considered if maximum temperature of a station reaches at least **40 °C** or more for **Plains** and at least **30 °C** or more for **Hilly** regions." |
| (a) Departure from normal | **Heat Wave:** departure **4.5 °C to 6.4 °C** · **Severe Heat Wave:** departure **> 6.4 °C** |
| (b) Actual max temperature | **Heat Wave:** actual Tmax **≥ 45 °C** · **Severe Heat Wave:** actual Tmax **≥ 47 °C** |
| Declaration rule | "If above criteria met at least in **2 stations in a Meteorological sub-division** for at least **two consecutive days** and it declared on the **second day**." |
| Coastal stations | "When maximum temperature departure is **4.5 °C or more** from normal, Heat Wave may be described provided actual maximum temperature is **37 °C or more**." |
| Warm night | "declared only when the maximum temperature remains **40 °C or more**." **Warm night:** Tmin departure 4.5–6.4 °C · **Very warm night:** Tmin departure > 6.4 °C |
| Hot & humid | "When observed maximum temperatures over any station remains **3 °C above normal** along with the above normal relative humidity" |
| Normals | "climatology of maximum temperature is prepared for the period **1991-2020** to find out normal maximum temperature of the day for a particular station." |
| Season | "mainly from **March to June** and in some rare cases even in July. The peak month … is **May**." |
| Forecast cadence | 5-day heat wave warnings are updated 4×/day in the All-India bulletin. Medium-range forecasts are "valid up to 7 days at district level". District-wise warnings are issued by state Met Centres/RMCs. |

Note: rule (b), absolute Tmax ≥ 45/47 °C, is listed under the plains criteria. The FAQ does not spell out whether it applies to hilly or coastal stations.

**Implementation notes for CLIMATIQ (our design guidance, not IMD text):**
- The FAQ does **not** define how a station is classed as "hilly" or "coastal". The MVP needs an explicit, documented heuristic, for example an elevation threshold using Open-Meteo's `elevation` field and a coastal-district list. Label it **non-IMD**.
- IMD compares station observations with station normals. We compare model grid values with model (ERA5) normals, so values will differ from IMD's. Show the result as a "criteria-based indicator" with that caveat.
- The two-station / two-day declaration can be approximated at district or subdivision level: flag a district when ≥2 grid points or locations meet the criteria on 2 consecutive days.

### 2.2 IMD colour-coded (impact-based) heat warnings — verified

Same FAQ, p. 8. These are issued "jointly with National Disaster Management Authority":

| Colour | Alert | Warning condition | Impact |
|--------|-------|-------------------|--------|
| **Green** (No action) | Normal Day | Max temperatures near normal | Comfortable; no cautionary action |
| **Yellow** (Be updated) | Heat Alert | Heat wave conditions at isolated pockets persist on 2 days | Tolerable for public; moderate concern for vulnerable people |
| **Orange** (Be prepared) | Severe Heat Alert for the day | (i) Severe heat wave persists for 2 days, or (ii) heat wave (not severe) persists for 4 days or more | Increased likelihood of heat illness for exposed or heavy-work people; high concern for vulnerable people |
| **Red** (Take action) | Extreme Heat Alert for the day | (i) Severe heat wave persists for more than 2 days, or (ii) total heat/severe heat wave days exceed 6 | Very high likelihood of heat illness and heat stroke in all ages |

The IMD API reference uses this colour mapping for warning fields: `1 = Green (Cat1)`, `2 = Yellow (Cat2–6)`, `3 = Orange (Cat7–11)`, `4 = Red (Cat12–19)`. District warning codes include **9 Heat Wave, 10 Hot Day, 11 Warm Night** ([IMD API reference](https://api.imd.gov.in/public/api_reference.html)).

### 2.3 Access to IMD data — what is actually possible

| Channel | Status (verified 2026-10-03) | Feasible for the hackathon without approval? |
|---------|------------------------------|-----------------------------------------------|
| **IMD API platform** `api.imd.gov.in` (city forecast `/api/v1/cityforecast`, `/cityforecastloc`, `/districtwarning`, `/subdivisionwarning`, `/current_wx`, `/districtnowcast`, `/aws_data`, …) ([reference](https://api.imd.gov.in/public/api_reference.html)) | Landing page: "Authenticated user onboarding with profile validation and controlled **key-based** API consumption", "Access: **Secure JWT**" ([portal](https://api.imd.gov.in/public/index.php)). Live call without a key → `401 {"error":"API key missing"}`. Registration requires official gov emails for government organisations ([register](https://api.imd.gov.in/public/register.php)). IMD's API note says interested **organisations** should contact the nodal officer and follow "IMD's terms and condition" ([API_doc.pdf](https://mausam.imd.gov.in/Forecast/marquee_data/API_doc.pdf)). The terms themselves are **not published** (UNVERIFIED). | **No.** Needs registration, key and approval; timeline unknown. |
| **Legacy mausam/city APIs** (`city.imd.gov.in/api/cityweather_loc.php`, `mausam.imd.gov.in/api/warnings_district_api.php`) | Live call → `401 "IP <our-ip> needs to be whitelisted"` | **No.** Needs IP whitelisting by IMD. |
| **IMD Pune gridded archive** ([index](https://imdpune.gov.in/lrfindex.php)): Tmax/Tmin **1.0°** binary (31×31 grid, year dropdown **1951–2025**), Rainfall **0.25°** binary/NetCDF (1901–2024) ([Tmax page](https://imdpune.gov.in/cmpg/Griddata/Max_1_Bin.html), [Rain page](https://imdpune.gov.in/cmpg/Griddata/Rainfall_25_Bin.html)) | Free form-POST download, **no login**. The page asks you to cite Srivastava et al. 2009 (doi:10.1002/asl.232) and carries a disclaimer: IMD "cannot guarantee that the data are correct". Note: "Gridded data for the year 2008 and onwards are based on relatively less number of stations (around 180)". **No explicit licence or redistribution terms.** | **Yes, technically.** Treat as research data, cite it, and avoid redistributing raw files. |
| **IMD Pune real-time daily grids**: Tmax/Tmin **0.5°** (61×61) and 1.0°, Rainfall 0.25° ([Tmax 0.5° page](https://imdpune.gov.in/cmpg/Realtimedata/max/Max_Download.html)) | Verified: `POST max=02102026` to `https://imdpune.gov.in/cmpg/Realtimedata/max/max.php` returned 14,884 bytes (61×61 float32, missing value = 99.9, 1,393 valid land cells). Today's date returned 0 bytes, and the page datepicker has `maxDate: -1`, so latency is **~1 day**. | **Yes, technically** (same caveats as above). Good for an "observed yesterday" validation layer. |
| **IMDLIB** (Python) | MIT licence, v0.1.22 (PyPI upload 2026-09-21). Downloads and reads the IMD Pune `.grd` files (`get_data`, `get_real_data`). Uses the URLs above (`imdpune.gov.in/cmpg/Griddata/maxtemp.php`, `…/Realtimedata/max/max.php`) ([GitHub](https://github.com/iamsaswata/imdlib), [docs](https://imdlib.readthedocs.io/en/latest/Usage.html), [PyPI](https://pypi.org/project/imdlib/)) | Python only. Our stack is Node, so a tiny TS reader (float32 little-endian, 61×61 or 31×31) is trivial if needed. |
| IMD website bulletins / GIS heatwave page | `mausam.imd.gov.in/responsive/heatwave_guidance.php` returned HTTP 500 at check time. A copyright or reuse policy page **could not be found** (UNVERIFIED). | **Link out only.** Do not scrape. |

**Verdict:** Use Open-Meteo for both forecast and history. Deep-link to IMD for official warnings ("Check official IMD warnings: https://mausam.imd.gov.in"). The optional stretch goal is an IMD 0.5° gridded Tmax "observed" overlay.

---

## 3. India boundary data (states/UTs and districts)

### 3.1 Candidate comparison

"Official claim?" was **point-tested** with Gilgit 35.92N 74.31E, Muzaffarabad 34.37N 73.47E, Aksai Chin 35.2N 79.3E and Tawang 27.59N 91.86E (method in §3.2).

| Source | Format & size | Units / year | Name keys | Licence & attribution | Official GoI depiction? |
|--------|---------------|--------------|-----------|------------------------|-------------------------|
| **geoBoundaries IND ADM1** ([API meta](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM1/)) | GeoJSON simplified **5.10 MB**, full 46.2 MB, TopoJSON 6.06 MB | **36** (28 states + 8 UTs). Metadata year 2011, but the UT set is post-2020 (Ladakh, merged DNH&DD) | `shapeName` (with diacritics, e.g. "Rājasthān"), `shapeISO` (e.g. `IN-RJ`), `shapeID` | Source: DataMeet / ECI, **CC BY 2.5 IN**. geoBoundaries asks for an acknowledgement and the citation Runfola et al. 2020 ([site](https://www.geoboundaries.org/)) | **Yes.** PoK in J&K, Gilgit and Aksai Chin in Ladakh, Arunachal in India |
| **geoBoundaries IND ADM2** ([API meta](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/)) | GeoJSON simplified **7.98 MB**, full 48.3 MB, TopoJSON 9.86 MB | **735** polygons (meta says 736), year **2021** | `shapeName` only. **No state key.** One placeholder polygon is named "DATA NOT AVAILABLE" (PoK area) | Source: Pathways Data Pvt Ltd / lgdirectory.gov.in, **ODbL 1.0** | **Yes** (PoK as a placeholder polygon, Aksai Chin in Leh) |
| **DataMeet maps** ([repo](https://github.com/datameet/maps)) | **Shapefile only**: `States/Admin2.shp` 17.1 MB, `Districts/Census_2011/2011_Dist.shp` 10.2 MB. `Country/india-composite.geojson` 10.8 MB | States: 36 (`ST_NM`). Districts: **641 (Census 2011)**; Telangana districts still under "Andhra Pradesh" | `ST_NM`; `DISTRICT, ST_NM, ST_CEN_CD, DT_CEN_CD, censuscode` | Repo default **CC BY 4.0** ("India boundaries by DataMeet India community (CC BY 4.0)"). The Districts README says **CC BY 2.5 IN** | Country outline is built "in accordance with the Official boundary of India as per the Survey of India" ([Country README](https://github.com/datameet/maps/tree/master/Country)) |
| **udit-001/india-maps-data** ([repo](https://github.com/udit-001/india-maps-data)) | **TopoJSON 887 KB** containing both `states` (36) and `districts` (726). India GeoJSON 4.09 MB. Per-state files too. jsDelivr CDN | ~2011 Census polygons, updated through 2019 plus 1 "update2025" district | `st_nm, st_code, district, dt_code, year` | **No licence.** README: "not created by the repository owner … curated from publicly available sources". The schema is identical to the covid19india map (repo MIT, data provenance undocumented) | **Yes** (point-tested) |
| **Survey of India (official)** ([digital products](https://onlinemaps.surveyofindia.gov.in/Digital_Product_Show.aspx)) | Shapefile, 1:1M: "Entire country Upto Distt. level with HQ" (OVSF/1M/7), state-level (OVSF/1M/9), **₹0** | Current SOI | — | Portal has a sign-in. **No licence or terms shown** on the product page (UNVERIFIED) | **Authoritative** |
| SOI / LGD mirrors by ramSeraph ([repo](https://github.com/ramSeraph/indian_admin_boundaries), releases 2023-12-11) | `SOI_States.geojsonl.7z` 9.1 MB, `SOI_Districts.geojsonl.7z` 27.7 MB, `LGD_Districts…` 22.2 MB, plus parquet and pmtiles | SOI / LGD snapshot (Dec 2023) | LGD codes | The repo states "CC0 1.0 but attribute datameet and the original government source". A sister repo ([drguptavivek/soi-geojson](https://github.com/drguptavivek/soi-geojson)) warns that SOI "redistribution terms … have **not been confirmed**" | Yes (SOI-derived) |
| **GADM** ([licence](https://gadm.org/license.html)) | — | — | — | "freely available for academic use and other non-commercial use. **Redistribution or commercial use is not allowed without prior permission.**" | Not tested. **Excluded on licence grounds** |
| **Natural Earth** ([terms](https://www.naturalearthdata.com/about/terms-of-use/)) | Admin-0 India point-of-view: `ne_10m_admin_0_countries_ind.zip` (4.9 MB, HTTP 200). There is **no India POV for admin-1** (`…admin_1_states_provinces_ind.zip` → 403) | v5.1.1 | — | **Public domain**, no attribution needed | Default is "de facto"; the IND POV variant exists for the **country outline only** |

**Policy context (verified):** India's Geospatial Guidelines (DST F.No.SM/25/02/2020, dated 15 Feb 2021), clause xiii: "For political Maps of India of any scale including national, state and other boundaries, SoI published maps or SoI digital boundary data are the standard to be used, which shall be made easily downloadable for free and their digital display and printing shall be permissible. Others may publish such maps that adhere to these standards." ([DST PDF](https://dst.gov.in/sites/default/files/Final%20Approved%20Guidelines%20on%20Geospatial%20Data_0.pdf)). For an India-facing product, use a dataset that shows India's claimed boundaries, and add a disclaimer that the boundaries are not SOI-authenticated.

### 3.2 Depiction test method

A scratch script ran point-in-polygon tests against each file. Results:

| Point | geoBoundaries ADM1 | geoBoundaries ADM2 | udit-001 / covid19india |
|-------|--------------------|--------------------|--------------------------|
| Gilgit (PoK/G-B) | Ladākh | "DATA NOT AVAILABLE" | Ladakh / Leh |
| Muzaffarabad (PoK) | Jammu and Kashmīr | "DATA NOT AVAILABLE" | J&K / Muzaffarabad |
| Aksai Chin | Ladākh | Leh(Ladakh) | Ladakh / Leh |
| Tawang | Arunāchal Pradesh | Tawang | Arunachal / Tawang |

All three include India's claimed territories, which is consistent with the GoI depiction at web-map scale. **None is SOI-certified.**

### 3.3 Recommendation (raw URLs verified: HTTP 302 → 200 via media.githubusercontent.com, Git LFS)

**States: geoBoundaries IND ADM1 (simplified)**
```
https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM1/geoBoundaries-IND-ADM1_simplified.geojson
```
- 5,103,747 bytes, 36 features.
- Keys: `shapeName` (state/UT name with diacritics), `shapeISO` (`IN-XX`; use as the **primary key**), `shapeID`.
- Normalise names by stripping combining marks (NFD), e.g. "Rājasthān" → "Rajasthan".

**Districts: geoBoundaries IND ADM2 (simplified)**
```
https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM2/geoBoundaries-IND-ADM2_simplified.geojson
```
- 7,979,916 bytes, 735 features.
- Key: `shapeName` (district). Some names have stray whitespace (e.g. "North "), so trim them.
- **No state field.** Derive the state once at seed time with point-on-surface within ADM1. Our scratch join assigned 734/735; Lakshadweep was missed by the naive test.
- Keep the "DATA NOT AVAILABLE" polygon for rendering (style it as no-data) and exclude it from analytics.
- District counts after the join: Rajasthan 33, Uttar Pradesh 74, Odisha 31, Andhra Pradesh 13, Telangana 33, Maharashtra 35, Himachal Pradesh 12, Delhi 11.

**Pre-processing (build step, not app code):**
- Simplify further and convert to TopoJSON, e.g. `mapshaper in.geojson -simplify 5% keep-shapes -o format=topojson`. Target < 1 MB total.
- Store the polygons in Postgres. PostGIS is optional; for the MVP a precomputed centroid per district is enough to drive Open-Meteo calls.

**Why not the others:**
- **udit-001:** the best developer ergonomics (one 887 KB TopoJSON with `st_nm`/`district`), but it has **no licence**. Keep it only as an emergency fallback, with the team accepting the licence risk.
- **DataMeet 2011 districts:** outdated (641 districts; Telangana inside AP) and shapefile-only.
- **SOI mirrors:** the most authoritative, but heavy (7z GeoJSONL, 9–28 MB) and the SOI redistribution terms are unconfirmed. This is the post-hackathon upgrade path.
- **GADM:** no redistribution allowed. **Natural Earth:** no India POV for states.

**Vintage caveat:** both geoBoundaries ADM2 and udit-001 are ~2019–2021 vintage. For example, both show **13 Andhra Pradesh districts**, but AP went to **26 districts on 4 April 2022** ([The Federal](https://thefederal.com/news/andhra-pradesh-now-has-26-districts-up-from-13-earlier)).

### 3.4 Cities / localities with coordinates

**GeoNames `cities15000`**: "all cities with a population > 15000 or capitals (ca 25.000)". Licence: "Creative Commons Attribution 4.0 License" ([readme](https://download.geonames.org/export/dump/readme.txt)).

- Download: `https://download.geonames.org/export/dump/cities15000.zip`. HTTP 200, 3.36 MB, regenerated daily (Last-Modified 2026-10-03).
- Content: 34,152 rows worldwide, **3,779 with country code `IN`**.
- Pilot-state counts: Rajasthan 209, UP 333, Odisha 97, AP 179, Telangana 111, Maharashtra 324, Himachal 13, Delhi 77.
- Format: tab-separated UTF-8. Columns: `geonameid, name, asciiname, alternatenames, latitude, longitude, feature class, feature code, country code, cc2, admin1 code, admin2 code, …, population, elevation, dem, timezone, modification date`.
- **Gotcha:** India's `admin1 code` values are GeoNames/FIPS-style numbers (e.g. `IN.24` = Rajasthan, `IN.40` = Telangana, `IN.41` = Ladakh), not ISO codes. Map them via `admin1CodesASCII.txt` ([URL](https://download.geonames.org/export/dump/admin1CodesASCII.txt)), or assign the state spatially with ADM1.
- Alternatives: `cities5000.zip` (5.7 MB) or `IN.zip` (15.8 MB, all Indian features) for denser coverage.
- Attribution: "Place data © GeoNames (geonames.org), CC BY 4.0".

---

## 4. Pilot states (recommendation)

Evidence base:
- The IMD FAQ lists the heat-wave-prone states: "Punjab, Haryana, Delhi, Uttar Pradesh, Bihar, Jharkhand, West Bengal, Odisha, Madhya Pradesh, Chhattisgarh, Rajasthan, Gujarat, parts of Maharashtra & Karnataka, Andhra Pradesh and Telangana. Sometimes it occurs over Tamilnadu & Kerala also" ([FAQ](https://internal.imd.gov.in/section/nhac/dynamic/FAQ_heat_wave.pdf)).
- IMD's **Core Heat Wave Zone** definition (Press Release, 28 Feb 2018): "Core Heat Wave zone covers states of Punjab, **Himachal Pradesh**, Uttarakhand, Delhi, Haryana, **Rajasthan**, **Uttar Pradesh**, Gujarat, Madhya Pradesh, Chhattisgarh, Bihar, Jharkhand, West Bengal, **Orissa** and Telangana and meteorological subdivisions of Marathwada, **Vidarbha**, Madhya **Maharashtra** and **coastal Andhra Pradesh**" ([IMD PR 20180228_pr_205](https://internal.imd.gov.in/press_release/20180228_pr_205.pdf)).
- IMD's 2026 outlook (31 Mar 2026): above-normal heatwave days expected over "some parts of east, central & northwest India and southeast Peninsula" for Apr–Jun 2026, and for April 2026 over "coastal areas of Odisha, West Bengal, Tamil Nadu, Puducherry and Andhra Pradesh" ([IMD PR 20260331_pr_4853](https://internal.imd.gov.in/press_release/20260331_pr_4853.pdf)).

| Pilot state | IMD criterion exercised | Why |
|-------------|-------------------------|-----|
| **Rajasthan** | Plains (≥40 °C, ≥45/47 °C absolute) | Core Heat Wave Zone; north-west desert plains, where heatwaves typically start. The FAQ notes they "generally develop over Northwest India and spread gradually eastwards & southwards". 33 districts, 209 GeoNames places. |
| **Uttar Pradesh** | Plains | Core Heat Wave Zone; Indo-Gangetic plain with the largest population exposure; 74–75 districts. |
| **Odisha** | **Coastal** (≥37 °C + ≥4.5 °C departure) **and** inland plains | Core Heat Wave Zone; flagged in the 2026 outlook for coastal heatwave days; one state exercises both rule sets. |
| **Andhra Pradesh** | **Coastal** (humid heat) | "Coastal Andhra Pradesh" is in the Core Heat Wave Zone and flagged in the 2026 outlook. Caveat: the boundary file has the pre-2022 13 districts. **Alternate: Telangana** (Core Heat Wave Zone, 33 districts current in the file, inland plateau). |
| **Maharashtra (Vidarbha focus)** | Plains / central India, plus a coastal strip | Vidarbha, Marathwada and Madhya Maharashtra are in the Core Heat Wave Zone; adds central-India diversity; 35 districts, 324 places. |
| **Himachal Pradesh** | **Hilly** (≥30 °C threshold) | Listed in the Core Heat Wave Zone; the only pilot that exercises the hilly criterion; small (12 districts), so cheap on API budget. |

Optional add-on: **Delhi NCT** (Core Heat Wave Zone, high demo visibility, 11 districts in geoBoundaries ADM2).

Data availability: Open-Meteo is global, so all pilots are covered. GeoNames has ≥13 places per pilot state, and geoBoundaries ADM2 covers all of them. Six pilots come to ≈198 district centroids, which is ≈198 forecast calls per refresh (§1.4).

---

## 5. Other free sources worth noting

**NASA POWER** ([API docs](https://power.larc.nasa.gov/docs/services/api/), [daily](https://power.larc.nasa.gov/docs/services/api/temporal/daily/))
- Endpoint: `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MAX,T2M_MIN,RH2M&community=AG&latitude=..&longitude=..&start=YYYYMMDD&end=YYYYMMDD&format=JSON`. **No key** (a live call worked, API v2.10.0, source "GEOSIT").
- Daily coverage runs from 1981 to near-real-time. Live check: the last valid day was 2026-09-30 when queried on 2026-10-03, so **~3 days latency**. Missing values are `-999`.
- Limits: "maximum of 20 parameters … for a single point. Regional requests are limited to one parameter". Repeated identical requests "will potentially be blocked". HTTP 429 means rate-limited. No numeric quota is published.
- Citation required ([referencing](https://power.larc.nasa.gov/docs/referencing/)). Useful as a **cross-check** source.

**ERA5 via Copernicus CDS** ([how-to API](https://cds.climate.copernicus.eu/how-to-api), [dataset](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels))
- Needs a **free account plus a personal access token** in `~/.cdsapirc` (`url: https://cds.climate.copernicus.eu/api`). You must **manually accept the dataset Terms of Use** before downloading. Client: `pip install "cdsapi>=0.7.7"`.
- Coverage is 1940→present at 0.25°. "updated daily with a latency of about 5 days", and early ERA5T data may change in the final release 2–3 months later. Licence: **CC-BY**.
- Queue and request-size limits were not documented on the pages fetched (UNVERIFIED).
- **Not needed:** Open-Meteo already serves ERA5 as a fast JSON API.

**IMD Pune gridded data** — see §2.3. Free, binary, no key. Use for an "observed" validation overlay; cite the source and do not redistribute.

**Open-Meteo Historical Forecast API** — see §1.3. Use later for forecast-skill or verification views.

---

## 6. Attribution block (paste into the app footer / About page)

> Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0), incl. ECMWF/Copernicus ERA5 & IFS; indices derived by CLIMATIQ.
> Boundaries: [geoBoundaries](https://www.geoboundaries.org/) (Runfola et al. 2020). States © DataMeet India community (CC BY 2.5 IN). Districts: contains information from geoBoundaries IND ADM2 (Pathways Data / LGD), made available under the ODbL 1.0.
> Places © [GeoNames](https://www.geonames.org/) (CC BY 4.0).
> Heatwave criteria per IMD "FAQ on Heat Wave". **CLIMATIQ is a decision-support prototype, not an official IMD warning. Refer to [mausam.imd.gov.in](https://mausam.imd.gov.in) for official warnings.** Boundaries are approximate and not authenticated by Survey of India.

ODbL note: if we publicly offer the **derived district database** (polygons + state join), it must be shared under ODbL. Showing maps (a "produced work") only needs the notice above.

---

## 7. Unverified / open items

- The **maximum number of coordinates** per Open-Meteo request is undocumented (150 worked).
- The **exact per-location call weighting** comes from the pricing-page calculator code, not the written terms.
- **IMD API terms and conditions** and approval timelines are not published. IMD website copyright and reuse policy page not found.
- **Survey of India** download terms (licence, redistribution) are not shown on the product page, and login requirements were not tested.
- IMD's definition of **"hilly" and "coastal" stations** is not in the FAQ; CLIMATIQ needs its own heuristic.
- **CDS** request queue and size limits were not found on the fetched pages.

---

## Sources

- Open-Meteo: [Forecast docs](https://open-meteo.com/en/docs) · [Historical Weather docs](https://open-meteo.com/en/docs/historical-weather-api) · [Historical Forecast docs](https://open-meteo.com/en/docs/historical-forecast-api) · [Terms](https://open-meteo.com/en/terms) · [Pricing](https://open-meteo.com/en/pricing) · [Licence](https://open-meteo.com/en/licence)
- IMD: [FAQ on Heat Wave (PDF)](https://internal.imd.gov.in/section/nhac/dynamic/FAQ_heat_wave.pdf) · [Press release 28 Feb 2018 (Core HW zone)](https://internal.imd.gov.in/press_release/20180228_pr_205.pdf) · [Press release 31 Mar 2026 (AMJ outlook)](https://internal.imd.gov.in/press_release/20260331_pr_4853.pdf) · [IMD API reference](https://api.imd.gov.in/public/api_reference.html) · [IMD API portal](https://api.imd.gov.in/public/index.php) · [IMD API registration](https://api.imd.gov.in/public/register.php) · [IMD API note (PDF)](https://mausam.imd.gov.in/Forecast/marquee_data/API_doc.pdf) · [IMD Pune data index](https://imdpune.gov.in/lrfindex.php) · [Tmax 1° page](https://imdpune.gov.in/cmpg/Griddata/Max_1_Bin.html) · [Rain 0.25° page](https://imdpune.gov.in/cmpg/Griddata/Rainfall_25_Bin.html) · [Real-time Tmax 0.5°](https://imdpune.gov.in/cmpg/Realtimedata/max/Max_Download.html) · [IMDLIB GitHub](https://github.com/iamsaswata/imdlib) · [IMDLIB docs](https://imdlib.readthedocs.io/en/latest/Usage.html)
- Boundaries: [geoBoundaries](https://www.geoboundaries.org/) · [gB IND ADM1 meta](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM1/) · [gB IND ADM2 meta](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/) · [DataMeet maps](https://github.com/datameet/maps) · [udit-001/india-maps-data](https://github.com/udit-001/india-maps-data) · [covid19india maps](https://github.com/covid19india/covid19india-react/tree/master/public/maps) · [ramSeraph/indian_admin_boundaries](https://github.com/ramSeraph/indian_admin_boundaries) · [drguptavivek/soi-geojson](https://github.com/drguptavivek/soi-geojson) · [Survey of India digital products](https://onlinemaps.surveyofindia.gov.in/Digital_Product_Show.aspx) · [DST Geospatial Guidelines 2021](https://dst.gov.in/sites/default/files/Final%20Approved%20Guidelines%20on%20Geospatial%20Data_0.pdf) · [GADM licence](https://gadm.org/license.html) · [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) · [Natural Earth admin-0](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/) · [AP 26 districts (The Federal)](https://thefederal.com/news/andhra-pradesh-now-has-26-districts-up-from-13-earlier)
- Places: [GeoNames dump readme](https://download.geonames.org/export/dump/readme.txt)
- Other: [NASA POWER API](https://power.larc.nasa.gov/docs/services/api/) · [NASA POWER daily](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) · [NASA POWER referencing](https://power.larc.nasa.gov/docs/referencing/) · [CDS how-to API](https://cds.climate.copernicus.eu/how-to-api) · [ERA5 single levels](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels)
