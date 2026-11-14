/* TerraWise API layer
   Public endpoints only. No API keys or private credentials are embedded here.
   NASA POWER: daily climate estimates.
   ISRIC SoilGrids: gridded soil-property estimates.
   ESA Sentinel-2: scene metadata through the public Earth Search STAC catalogue.
*/
(function () {
  "use strict";

  const POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point";
  const SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query";
  const STAC_URL = "https://earth-search.aws.element84.com/v1/search";

  async function fetchJSON(url, options) {
    const response = await fetch(url, options || {});
    if (!response.ok) {
      throw new Error("Request failed (" + response.status + "): " + response.statusText);
    }
    return response.json();
  }

  function validateCoordinates(lat, lon) {
    const latitude = Number(lat), longitude = Number(lon);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error("Enter valid latitude (-90 to 90) and longitude (-180 to 180).");
    }
    return { latitude, longitude };
  }

  async function getPowerClimate(lat, lon, start, end) {
    const point = validateCoordinates(lat, lon);
    if (!start || !end || start > end) throw new Error("Choose a valid date range.");
    const params = new URLSearchParams({
      parameters: "T2M,PRECTOTCORR",
      community: "AG",
      longitude: String(point.longitude),
      latitude: String(point.latitude),
      start: start.replaceAll("-", ""),
      end: end.replaceAll("-", ""),
      format: "JSON"
    });
    const data = await fetchJSON(POWER_URL + "?" + params.toString());
    const properties = data && data.properties && data.properties.parameter;
    if (!properties || !properties.T2M || !properties.PRECTOTCORR) {
      throw new Error("NASA POWER did not return the requested climate parameters for this date range.");
    }

    const temperatures = properties.T2M;
    const precipitation = properties.PRECTOTCORR;
    const rows = Object.keys(temperatures).map(function (date) {
      const t = Number(temperatures[date]);
      const p = Number(precipitation[date]);
      return {
        date: date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6, 8),
        temperature: Number.isFinite(t) && t > -900 ? t : null,
        precipitation: Number.isFinite(p) && p > -900 ? p : null
      };
    }).filter(function (row) {
      return row.temperature !== null || row.precipitation !== null;
    }).sort(function (a, b) { return a.date.localeCompare(b.date); });

    const validTemps = rows.map(r => r.temperature).filter(v => v !== null);
    const validRain = rows.map(r => r.precipitation).filter(v => v !== null);
    const mean = validTemps.length ? validTemps.reduce((a, b) => a + b, 0) / validTemps.length : null;
    return {
      rows,
      averageTemperature: mean,
      maximumTemperature: validTemps.length ? Math.max.apply(null, validTemps) : null,
      minimumTemperature: validTemps.length ? Math.min.apply(null, validTemps) : null,
      totalPrecipitation: validRain.length ? validRain.reduce((a, b) => a + b, 0) : null,
      validDays: rows.length,
      source: "NASA POWER Daily Point API"
    };
  }

  async function getSoilGrids(lat, lon) {
    const point = validateCoordinates(lat, lon);
    const params = new URLSearchParams();
    params.set("lon", String(point.longitude));
    params.set("lat", String(point.latitude));
    ["clay", "sand", "soc", "phh2o", "nitrogen"].forEach(p => params.append("property", p));
    params.set("depth", "0-5cm");
    params.set("value", "mean");
    const data = await fetchJSON(SOILGRIDS_URL + "?" + params.toString());
    return { raw: data, source: "ISRIC SoilGrids", depth: "0-5 cm" };
  }

  async function getSentinelScenes(lat, lon, radiusDegrees, daysBack) {
    const point = validateCoordinates(lat, lon);
    const radius = Number(radiusDegrees);
    const end = new Date();
    const start = new Date(end.getTime() - Number(daysBack) * 86400000);
    const dateOnly = d => d.toISOString().slice(0, 10);
    const bbox = [
      Math.max(-180, point.longitude - radius),
      Math.max(-90, point.latitude - radius),
      Math.min(180, point.longitude + radius),
      Math.min(90, point.latitude + radius)
    ];
    const body = {
      collections: ["sentinel-2-l2a"],
      bbox,
      datetime: dateOnly(start) + "T00:00:00Z/" + dateOnly(end) + "T23:59:59Z",
      limit: 10,
      sortby: [{ field: "properties.datetime", direction: "desc" }]
    };
    const data = await fetchJSON(STAC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/geo+json, application/json" },
      body: JSON.stringify(body)
    });
    const features = Array.isArray(data.features) ? data.features : [];
    return {
      source: "ESA Sentinel-2 L2A via Earth Search STAC",
      scenes: features.map(function (feature) {
        const p = feature.properties || {};
        return {
          id: feature.id || "Sentinel-2 scene",
          date: p.datetime || p["start_datetime"] || "Date unavailable",
          cloudCover: p["eo:cloud_cover"] == null ? null : Number(p["eo:cloud_cover"]),
          platform: p.platform || "Sentinel-2",
          thumbnail: feature.assets && feature.assets.thumbnail ? feature.assets.thumbnail.href : null
        };
      })
    };
  }

  window.TerraWiseAPI = {
    getPowerClimate,
    getSoilGrids,
    getSentinelScenes
  };
})();
