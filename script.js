(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  let fieldProfile = null;
  let climateData = null;
  let soilData = null;
  let satelliteData = null;

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
  }
  function numberText(value, digits) {
    return value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(digits == null ? 2 : digits);
  }
  function setStatus(id, message, error) {
    const el = $(id);
    el.textContent = message;
    el.classList.toggle("error", !!error);
  }
  function setSourceStatus(id, message, ok) {
    const el = $(id);
    el.textContent = message;
    el.classList.toggle("planned", !ok);
  }
  function coordinates() {
    if (!$("latitude").value || !$("longitude").value) throw new Error("Enter the field latitude and longitude first.");
    return { lat: Number($("latitude").value), lon: Number($("longitude").value) };
  }
  function readProfile() {
    const c = coordinates();
    const country = $("country").value.trim();
    if (!country) throw new Error("Enter the country.");
    return {
      country, fieldName: $("fieldName").value.trim() || "Unnamed field",
      latitude: c.lat, longitude: c.lon, area: $("area").value,
      soilType: $("soilType").value, waterAvailability: $("waterAvailability").value,
      currentCrop: $("currentCrop").value.trim(), priority: $("priority").value,
      currentRotation: $("currentRotation").value.trim(), notes: $("fieldNotes").value.trim()
    };
  }

  $("fieldForm").addEventListener("submit", function (event) {
    event.preventDefault();
    try {
      fieldProfile = readProfile();
      $("profileStatus").textContent = "Field profile saved in this browser session.";
      setStatus("climateStatus", "Profile ready. Choose dates and retrieve NASA POWER data.");
      setStatus("soilStatus", "Profile ready. You can retrieve SoilGrids properties.");
      setStatus("satelliteStatus", "Profile ready. You can search for Sentinel-2 scenes.");
    } catch (error) {
      $("profileStatus").textContent = error.message;
    }
  });

  $("loadClimate").addEventListener("click", async function () {
    const button = this;
    try {
      const p = fieldProfile || readProfile();
      button.disabled = true;
      setStatus("climateStatus", "Retrieving NASA POWER daily data...");
      const result = await TerraWiseAPI.getPowerClimate(p.latitude, p.longitude, $("startDate").value, $("endDate").value);
      climateData = result;
      $("avgTemp").textContent = numberText(result.averageTemperature) + "°";
      $("totalRain").textContent = numberText(result.totalPrecipitation) + " mm";
      $("maxTemp").textContent = numberText(result.maximumTemperature) + "°";
      $("validDays").textContent = String(result.validDays);
      $("climateTable").innerHTML = result.rows.map(row =>
        `<tr><td>${escapeHTML(row.date)}</td><td>${numberText(row.temperature)}</td><td>${numberText(row.precipitation)}</td></tr>`
      ).join("") || '<tr><td colspan="3">No valid daily records returned.</td></tr>';
      setStatus("climateStatus", "NASA POWER data retrieved successfully. These are gridded estimates.");
      setSourceStatus("powerSourceStatus", "Retrieved this session", true);
    } catch (error) {
      setStatus("climateStatus", error.message, true);
      setSourceStatus("powerSourceStatus", "Retrieval failed", false);
    } finally { button.disabled = false; }
  });

  $("loadSoil").addEventListener("click", async function () {
    const button = this;
    try {
      const p = fieldProfile || readProfile();
      button.disabled = true;
      setStatus("soilStatus", "Querying ISRIC SoilGrids...");
      const result = await TerraWiseAPI.getSoilGrids(p.latitude, p.longitude);
      soilData = result;
      const layers = result.raw && result.raw.properties && result.raw.properties.layers;
      if (!Array.isArray(layers) || !layers.length) throw new Error("SoilGrids returned no soil-property layers for this point.");
      const html = layers.map(layer => {
        const depth = (layer.depths || []).find(d => d.label === "0-5cm") || (layer.depths || [])[0];
        const values = depth && depth.values;
        const mean = values && values.mean;
        const unit = layer.unit_measure && (layer.unit_measure.mapped_units || layer.unit_measure.target_units) || "";
        return `<div class="soil-item"><span>${escapeHTML(layer.name || layer.code || "Soil property")}</span><strong>${mean == null ? "—" : escapeHTML(mean)}</strong><small>${escapeHTML(unit)} · ${escapeHTML(depth ? depth.label : "depth unavailable")}</small></div>`;
      }).join("");
      $("soilResults").innerHTML = html || '<p class="muted">No readable soil values returned.</p>';
      setStatus("soilStatus", "SoilGrids response received. Values are gridded estimates, not a field soil test.");
      setSourceStatus("soilSourceStatus", "Retrieved this session", true);
    } catch (error) {
      setStatus("soilStatus", error.message, true);
      setSourceStatus("soilSourceStatus", "Retrieval failed", false);
    } finally { button.disabled = false; }
  });

  $("loadSatellite").addEventListener("click", async function () {
    const button = this;
    try {
      const p = fieldProfile || readProfile();
      button.disabled = true;
      setStatus("satelliteStatus", "Searching the Sentinel-2 STAC catalogue...");
      const result = await TerraWiseAPI.getSentinelScenes(p.latitude, p.longitude, $("satRadius").value, $("satDays").value);
      satelliteData = result;
      if (!result.scenes.length) {
        $("satelliteResults").innerHTML = '<p class="muted">No Sentinel-2 scenes were returned for this area and time window. Try a larger radius or longer period.</p>';
      } else {
        $("satelliteResults").innerHTML = result.scenes.map(scene => {
          const date = scene.date === "Date unavailable" ? scene.date : new Date(scene.date).toLocaleString();
          return `<article class="scene-item"><div><strong>${escapeHTML(scene.id)}</strong><p>${escapeHTML(scene.platform)} · ${escapeHTML(date)}</p></div><span class="source-status">${scene.cloudCover == null ? "Cloud cover unavailable" : "Cloud cover " + numberText(scene.cloudCover, 1) + "%"}</span></article>`;
        }).join("");
      }
      setStatus("satelliteStatus", result.scenes.length + " Sentinel-2 scene record(s) returned. Metadata only; no vegetation index was calculated.");
      setSourceStatus("sentinelSourceStatus", "Retrieved this session", true);
    } catch (error) {
      setStatus("satelliteStatus", error.message + " The public catalogue may be temporarily unavailable or blocked by the browser.", true);
      setSourceStatus("sentinelSourceStatus", "Retrieval failed", false);
    } finally { button.disabled = false; }
  });

  function cropName(value, fallback) { return value && value.trim() ? value.trim() : fallback; }
  function makeRotations(profile, years) {
    const base = profile.currentRotation || (profile.currentCrop ? profile.currentCrop : "Current sequence not provided");
    const crop = cropName(profile.currentCrop, "Main crop");
    const soil = profile.soilType || "soil type not specified";
    const water = profile.waterAvailability || "water availability not specified";
    const period = Number(years);
    const baseline = profile.currentRotation ? profile.currentRotation : crop + " (repeat / sequence unknown)";
    const soilSequence = ["Locally suitable legume or cover crop", crop, "Locally suitable cereal or rotation crop", "Cover crop / locally suitable crop"];
    const waterSequence = water === "rainfed"
      ? ["Locally suitable drought-tolerant crop", "Locally suitable legume", "Short-season crop", "Residue / cover management"]
      : ["Locally suitable crop", "Legume or cover crop", crop, "Locally suitable rotation crop"];
    return [
      { title: "1. Existing rotation (baseline)", sequence: baseline, rationale: "Represents the farmer's current practice. It is the comparison baseline, not a claim that the current system is optimal.", tradeoff: "Needs actual crop history, planting dates, yield and input records." },
      { title: "2. Soil-improvement concept", sequence: soilSequence.slice(0, period).join(" → "), rationale: "Introduces a locally suitable legume or cover-crop phase to investigate soil cover and nutrient-cycling opportunities.", tradeoff: "Legume suitability, water demand, seed access, termination and market use must be checked locally. Soil type entered: " + soil + "." },
      { title: "3. Climate / water-resilience concept", sequence: waterSequence.slice(0, period).join(" → "), rationale: "Screens a sequence that gives greater attention to water constraints and crop-season flexibility.", tradeoff: "Crop drought tolerance and season length vary by cultivar and location. Water input recorded: " + water + "." }
    ];
  }
  $("compareRotations").addEventListener("click", function () {
    try {
      const p = fieldProfile || readProfile();
      fieldProfile = p;
      const rotations = makeRotations(p, $("rotationYears").value);
      $("rotationResults").innerHTML = rotations.map(r =>
        `<article class="rotation-card"><h3>${escapeHTML(r.title)}</h3><p class="sequence">${escapeHTML(r.sequence)}</p><p>${escapeHTML(r.rationale)}</p><p class="caution">${escapeHTML(r.tradeoff)}</p></article>`
      ).join("");
    } catch (error) {
      $("rotationResults").innerHTML = `<p class="muted">${escapeHTML(error.message)}</p>`;
    }
  });

  $("generateReport").addEventListener("click", function () {
    try {
      const p = fieldProfile || readProfile();
      fieldProfile = p;
      const evidence = [];
      evidence.push(climateData ? `NASA POWER: mean temperature ${numberText(climateData.averageTemperature)} °C; total precipitation ${numberText(climateData.totalPrecipitation)} mm across ${climateData.validDays} valid daily records.` : "NASA POWER climate data has not been retrieved in this session.");
      evidence.push(soilData ? "ISRIC SoilGrids returned a soil-property response for the field coordinates." : "SoilGrids properties have not been retrieved in this session.");
      evidence.push(satelliteData ? `Sentinel-2 catalogue search returned ${satelliteData.scenes.length} scene record(s).` : "Sentinel-2 scene search has not been performed in this session.");
      $("reportOutput").innerHTML = `
        <h3>${escapeHTML(p.fieldName)} — ${escapeHTML(p.country)}</h3>
        <p><strong>Coordinates:</strong> ${escapeHTML(p.latitude)}, ${escapeHTML(p.longitude)} · <strong>Area:</strong> ${escapeHTML(p.area || "Not provided")} ha</p>
        <p><strong>Farmer inputs:</strong> crop ${escapeHTML(p.currentCrop || "not specified")}; soil ${escapeHTML(p.soilType || "not specified")}; water ${escapeHTML(p.waterAvailability || "not specified")}; priority ${escapeHTML(p.priority)}.</p>
        <h3>Retrieved evidence</h3><ul>${evidence.map(x => `<li>${escapeHTML(x)}</li>`).join("")}</ul>
        <h3>Interpretation limits</h3>
        <ul><li>Climate and soil products are gridded estimates and may not represent conditions inside the exact field.</li><li>Sentinel-2 search confirms scene metadata only; no NDVI, crop classification or field boundary analysis is performed.</li><li>Rotation sequences are screening concepts, not validated agronomic recommendations.</li><li>Confirm crop calendar, cultivar, soil test, pest pressure, market access and water constraints with local farmers or an agronomist.</li></ul>
        <p><strong>Next decision:</strong> use the retrieved evidence and local knowledge to review at least two alternative rotations against the farmer's current practice.</p>`;
    } catch (error) {
      $("reportOutput").innerHTML = `<p class="muted">${escapeHTML(error.message)}</p>`;
    }
  });
})();