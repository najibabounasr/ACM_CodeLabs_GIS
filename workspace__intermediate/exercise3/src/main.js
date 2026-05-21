const CESIUM_BASE = '/node_modules/cesium/Build/Cesium/';
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const CAM_MAX_HEIGHT_M = 300_000;

let cesiumViewer;
let googleApiKey = '';
let googleTileset = null;
let activeLayer = null;

// ── Flight state ─────────────────────────────────────────────────────────────
let billboards = null;
let arcCollection = null;
let flightMap = new Map();
let routeMap = new Map();
let selectedIcao = null;
let pathEntities = [];
let planeCanvas = null;
let flightInterval = null;
let flightsEnabled = false;

// ── Weather state ────────────────────────────────────────────────────────────
let weatherAvailable = false;
let activeWeatherType = null;

// ── Camera state ─────────────────────────────────────────────────────────────
let camAvailable = false;
let camEnabled = false;
let camBillboards = null;
let camMap = new Map();
let camDataCache = new Map();
let camFetchPending = false;
let camDebounceTimer = null;
let lastCamKey = '';

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = Object.assign(document.createElement('script'), { src });
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

function loadLink(href) {
  document.head.appendChild(
    Object.assign(document.createElement('link'), { rel: 'stylesheet', href })
  );
}

function setStatus(text) {
  const el = document.getElementById('layer-status');
  if (el) el.textContent = text;
}

// ═════════════════════════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════════════════════════

(async function boot() {
  const [gCfg, wCfg, cCfg] = await Promise.all([
    fetch('/api/google-config').then(r => r.json()).catch(() => ({})),
    fetch('/api/weather/config').then(r => r.json()).catch(() => ({})),
    fetch('/api/webcams/config').then(r => r.json()).catch(() => ({})),
  ]);

  googleApiKey = gCfg.apiKey || '';
  weatherAvailable = wCfg.available || false;
  camAvailable = cCfg.available || false;

  await initCesium();
  setupSidebar();
  setupClickHandler();

  document.getElementById('loading').classList.add('done');
})();

async function initCesium() {
  window.CESIUM_BASE_URL = CESIUM_BASE;
  await loadScript(CESIUM_BASE + 'Cesium.js');
  loadLink(CESIUM_BASE + 'Widgets/widgets.css');

  // TODO: create cesiumViewer, load Google 3D Tiles, configure scene, fly to position
}

// ═════════════════════════════════════════════════════════════════════════════
// SIDEBAR — ONE LAYER AT A TIME
// ═════════════════════════════════════════════════════════════════════════════

function setupSidebar() {
  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer;
      if (activeLayer === layer) {
        deactivateLayer(layer);
        activeLayer = null;
        btn.classList.remove('active');
        setStatus('No layer active');
        if (layer === 'weather') {
          document.getElementById('weather-sub').classList.add('hidden');
        }
      } else {
        if (activeLayer) {
          deactivateLayer(activeLayer);
          document.querySelector(`.layer-btn[data-layer="${activeLayer}"]`)?.classList.remove('active');
          if (activeLayer === 'weather') {
            document.getElementById('weather-sub').classList.add('hidden');
          }
        }
        activeLayer = layer;
        btn.classList.add('active');
        activateLayer(layer);
        if (layer === 'weather') {
          document.getElementById('weather-sub').classList.remove('hidden');
        }
      }
    });
  });

  document.querySelectorAll('.sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.weather;
      document.querySelectorAll('.sub-btn').forEach(b => b.classList.remove('active'));
      if (activeWeatherType === type) {
        clearWeatherLayer();
        activeWeatherType = null;
        setStatus('Weather off');
      } else {
        btn.classList.add('active');
        setWeatherLayer(type);
        activeWeatherType = type;
      }
    });
  });
}

function activateLayer(layer) {
  switch (layer) {
    case 'flights':   startFlightTracking(); break;
    case 'weather':   setStatus('Pick a weather layer'); break;
    case 'cameras':   startCameras(); break;
    case 'satellite': startSatelliteView(); break;
  }
}

function deactivateLayer(layer) {
  switch (layer) {
    case 'flights':   stopFlightTracking(); break;
    case 'weather':   clearWeatherLayer(); activeWeatherType = null;
      document.querySelectorAll('.sub-btn').forEach(b => b.classList.remove('active'));
      break;
    case 'cameras':   stopCameras(); break;
    case 'satellite': stopSatelliteView(); break;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CLICK HANDLER
// ═════════════════════════════════════════════════════════════════════════════

let clickHandlerReady = false;

function setupClickHandler() {
  if (clickHandlerReady) return;
  clickHandlerReady = true;

  const handler = new Cesium.ScreenSpaceEventHandler(cesiumViewer.scene.canvas);
  handler.setInputAction((movement) => {
    const picked = cesiumViewer.scene.drillPick(movement.position);
    if (Cesium.defined(picked) && picked.length > 0) {
      for (const p of picked) {
        const id = p.id;
        if (typeof id !== 'string') continue;
        if (id.startsWith('cam_'))    { openCam(id); return; }
        if (id.startsWith('flight_')) { selectFlight(id.replace('flight_', '')); return; }
if (id.startsWith('sat_'))    { openSatInfoWindow(id); return; }
      }
    }

    // No billboard hit — zoom into clicked point and fetch weather
    const ray = cesiumViewer.camera.getPickRay(movement.position);
    if (ray) {
      const cartesian = cesiumViewer.scene.globe.pick(ray, cesiumViewer.scene)
        || cesiumViewer.scene.pickPosition(movement.position);
      if (cartesian) {
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        const lat = Cesium.Math.toDegrees(carto.latitude);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        cesiumViewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, 1500),
          orientation: {
            heading: cesiumViewer.camera.heading,
            pitch: Cesium.Math.toRadians(-45),
            roll: 0,
          },
          duration: 2.0,
        });
        if (weatherAvailable) fetchWeatherAt(lat, lon);
        return;
      }
    }

    deselectFlight();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

// ═════════════════════════════════════════════════════════════════════════════
// GREAT-CIRCLE MATH
// ═════════════════════════════════════════════════════════════════════════════

function haversineKm(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R;
  const dp = (lat2 - lat1) * D2R, dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function interpGC(lon1, lat1, lon2, lat2, t) {
  const p1 = lat1 * D2R, l1 = lon1 * D2R;
  const p2 = lat2 * D2R, l2 = lon2 * D2R;
  const dp = p2 - p1, dl = l2 - l1;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const d = 2 * Math.asin(Math.sqrt(a));
  if (d < 1e-9) return [lon1, lat1];
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return [Math.atan2(y, x) * R2D, Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D];
}

function routeProgress(dep, arr, planeLon, planeLat) {
  const total = haversineKm(dep.lat, dep.lon, arr.lat, arr.lon);
  if (total < 1) return 0;
  return Math.max(0, Math.min(1, haversineKm(dep.lat, dep.lon, planeLat, planeLon) / total));
}

function buildArcPositions(dep, arr) {
  const N = 80;
  const distKm = haversineKm(dep.lat, dep.lon, arr.lat, arr.lon);
  const peakM = Math.min(11_500, distKm * 50);
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const [lon, lat] = interpGC(dep.lon, dep.lat, arr.lon, arr.lat, t);
    pts.push(lon, lat, peakM * Math.sin(Math.PI * t));
  }
  return pts;
}

// ═════════════════════════════════════════════════════════════════════════════
// FLIGHT TRACKING
// ═════════════════════════════════════════════════════════════════════════════

const PLANE_DEFAULT_SCALE = 0.55;

function getPlaneCanvas() {
  if (planeCanvas) return planeCanvas;
  const N = 32, m = N / 2;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 3;
  ctx.beginPath();
  ctx.moveTo(m, 1); ctx.lineTo(m + 3.5, m + 2); ctx.lineTo(N - 2, m + 6);
  ctx.lineTo(N - 2, m + 8.5); ctx.lineTo(m + 3, m + 5); ctx.lineTo(m + 4, N - 3);
  ctx.lineTo(m, N - 5); ctx.lineTo(m - 4, N - 3); ctx.lineTo(m - 3, m + 5);
  ctx.lineTo(2, m + 8.5); ctx.lineTo(2, m + 6); ctx.lineTo(m - 3.5, m + 2);
  ctx.closePath(); ctx.fill();
  planeCanvas = c;
  return c;
}

function altColor(alt) {
  if (!alt || alt < 2000) return Cesium.Color.fromCssColorString('#34d399');
  if (alt < 6000) return Cesium.Color.fromCssColorString('#fbbf24');
  if (alt < 9500) return Cesium.Color.fromCssColorString('#22d3ee');
  return Cesium.Color.fromCssColorString('#a78bfa');
}

function startFlightTracking() {
  if (!cesiumViewer) return;
  flightsEnabled = true;
  // TODO: create billboard/polyline collections, call refreshFlights, set interval
  setStatus('Loading flights...');
}

function stopFlightTracking() {
  flightsEnabled = false;
  if (flightInterval) { clearInterval(flightInterval); flightInterval = null; }
  deselectFlight();
  if (billboards) {
    for (const [, { bb }] of flightMap) billboards.remove(bb);
    flightMap.clear();
  }
  if (arcCollection) {
    for (const [icao] of routeMap) removeRouteViz(icao);
  }
}

async function refreshFlights() {
  try {
    const r = await fetch('/api/flights');
    if (!r.ok) return;
    const { states } = await r.json();
    if (Array.isArray(states)) applyStates(states);
  } catch (e) { console.warn('Flight fetch:', e.message); }
}

function applyStates(states) {
  const seen = new Set();

  for (const s of states) {
    const [icao24, cs, country, , , lon, lat, baro, , onGround, spd, hdg, vr, , geo] = s;
    if (onGround || lon == null || lat == null) continue;

    const alt = geo || baro || 10_000;
    const heading = hdg ?? 0;
    const speed = spd ?? 0;
    const cs_trim = (cs || '').trim() || icao24;
    seen.add(icao24);

    let bbLon = lon, bbLat = lat;
    const re = routeMap.get(icao24);
    if (re) {
      const progress = routeProgress(re.dep, re.arr, lon, lat);
      [bbLon, bbLat] = interpGC(re.dep.lon, re.dep.lat, re.arr.lon, re.arr.lat, progress);
      re.progress = progress;
    }

    if (flightMap.has(icao24)) {
      const { bb, d } = flightMap.get(icao24);
      bb.position = Cesium.Cartesian3.fromDegrees(bbLon, bbLat, alt);
      bb.rotation = -Cesium.Math.toRadians(heading);
      if (icao24 !== selectedIcao) bb.color = altColor(alt);
      Object.assign(d, { lon, lat, alt, heading, speed, cs: cs_trim, country, vr });
    } else {
      const bb = billboards.add({
        id: 'flight_' + icao24,
        position: Cesium.Cartesian3.fromDegrees(bbLon, bbLat, alt),
        image: getPlaneCanvas(),
        scale: PLANE_DEFAULT_SCALE,
        rotation: -Cesium.Math.toRadians(heading),
        color: altColor(alt),
        heightReference: Cesium.HeightReference.NONE,
      });
      flightMap.set(icao24, {
        bb,
        d: { icao24, cs: cs_trim, country, lon, lat, alt, heading, speed, vr },
      });
    }
  }

  for (const [icao, { bb }] of flightMap) {
    if (!seen.has(icao)) {
      billboards.remove(bb);
      removeRouteViz(icao);
      flightMap.delete(icao);
    }
  }

  setStatus(flightMap.size.toLocaleString() + ' flights live');
}

// ── Route visualisation ──────────────────────────────────────────────────────

function buildRouteViz(icao24, route) {
  if (routeMap.has(icao24)) return;
  const { dep, arr } = route;

  const arcPts = buildArcPositions(dep, arr);
  const arc = arcCollection.add({
    positions: Cesium.Cartesian3.fromDegreesArrayHeights(arcPts),
    width: 1.8,
    material: Cesium.Material.fromType('PolylineGlow', {
      glowPower: 0.15,
      color: new Cesium.Color(0.25, 0.55, 1.0, 0.6),
    }),
  });

  const depEnt = cesiumViewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(dep.lon, dep.lat, 150),
    point: { pixelSize: 8, color: Cesium.Color.fromCssColorString('#34d399'), outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5 },
    label: {
      text: dep.icao, font: '12px monospace',
      fillColor: Cesium.Color.fromCssColorString('#34d399'),
      outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -18), show: false,
    },
  });

  const arrEnt = cesiumViewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(arr.lon, arr.lat, 150),
    point: { pixelSize: 8, color: Cesium.Color.fromCssColorString('#f87171'), outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5 },
    label: {
      text: arr.icao, font: '12px monospace',
      fillColor: Cesium.Color.fromCssColorString('#f87171'),
      outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -18), show: false,
    },
  });

  routeMap.set(icao24, { arc, depEnt, arrEnt, dep, arr, progress: 0 });
}

function removeRouteViz(icao24) {
  const re = routeMap.get(icao24);
  if (!re) return;
  arcCollection.remove(re.arc);
  cesiumViewer.entities.remove(re.depEnt);
  cesiumViewer.entities.remove(re.arrEnt);
  routeMap.delete(icao24);
}

// ── Selection ────────────────────────────────────────────────────────────────

function selectFlight(icao24) {
  deselectFlight();
  const entry = flightMap.get(icao24);
  if (!entry) return;

  selectedIcao = icao24;
  entry.bb.color = Cesium.Color.ORANGE;
  entry.bb.scale = 1.1;

  const cs = (entry.d.cs || '').trim();
  if (cs) {
    fetch(`/api/route/${encodeURIComponent(cs)}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(route => {
        if (selectedIcao !== icao24) return;
        if (!route?.dep?.lat || !route?.arr?.lat) { renderInfoPanel(entry.d, null); return; }
        buildRouteViz(icao24, route);
        renderInfoPanel(entry.d, routeMap.get(icao24) || null);
      })
      .catch(() => { if (selectedIcao === icao24) renderInfoPanel(entry.d, null); });
  } else {
    renderInfoPanel(entry.d, null);
  }
}

function deselectFlight() {
  if (!cesiumViewer) return;
  if (selectedIcao) {
    const entry = flightMap.get(selectedIcao);
    if (entry) { entry.bb.scale = PLANE_DEFAULT_SCALE; entry.bb.color = altColor(entry.d.alt); }
    removeRouteViz(selectedIcao);
  }
  pathEntities.forEach(e => cesiumViewer.entities.remove(e));
  pathEntities = [];
  selectedIcao = null;
  document.getElementById('flight-info')?.classList.add('hidden');
}

// ── Info panel ───────────────────────────────────────────────────────────────

function renderInfoPanel(data, routeEntry) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '--'; };
  const box = document.getElementById('flight-info');
  if (!box) return;

  set('fi-cs', data.cs || data.icao24);
  set('fi-country', data.country);
  set('fi-alt', data.alt ? Math.round(data.alt).toLocaleString() + ' m' : '--');
  set('fi-spd', data.speed ? Math.round(data.speed * 3.6) + ' km/h' : '--');
  set('fi-hdg', data.heading != null ? data.heading.toFixed(0) + '°' : '--');
  set('fi-vr', data.vr ? (data.vr > 0 ? '+' : '') + data.vr.toFixed(1) + ' m/s' : '--');
  set('fi-icao', data.icao24 || data.hex);

  const routeSection = document.getElementById('fi-route');
  const noRoute = document.getElementById('fi-no-route');

  if (routeEntry?.dep && routeEntry?.arr) {
    const { dep, arr, progress } = routeEntry;
    const pct = Math.round((progress || 0) * 100);
    set('fi-dep-icao', dep.icao);
    set('fi-dep-name', dep.name);
    set('fi-arr-icao', arr.icao);
    set('fi-arr-name', arr.name);
    set('fi-prog-pct', pct + '%');
    const fill = document.getElementById('fi-prog-fill');
    if (fill) fill.style.width = pct + '%';
    routeSection?.classList.remove('hidden');
    noRoute?.classList.add('hidden');
  } else {
    routeSection?.classList.add('hidden');
    noRoute?.classList.remove('hidden');
  }

  box.classList.remove('hidden');
}

// ═════════════════════════════════════════════════════════════════════════════
// WEATHER LAYERS
// ═════════════════════════════════════════════════════════════════════════════

// ── Google Maps 2D for weather mode ──────────────────────────────────────────
let gmap = null;
let gmapOverlay = null;
let gmapLoaded = false;

// ── Wind particle overlay ─────────────────────────────────────────────────────
let windCanvas    = null;
let windHmCanvas      = null;
let windDrawHeatmap   = null;
let windAnimId    = null;
let windGrid      = [];
let windListeners = [];
let windFetchTimer = null;

async function fetchWindGrid() {
  if (!gmap) return;
  const bounds = gmap.getBounds();
  if (!bounds) return;
  const ne = bounds.getNorthEast(), sw = bounds.getSouthWest();
  const params = new URLSearchParams({
    south: sw.lat().toFixed(3), west: sw.lng().toFixed(3),
    north: ne.lat().toFixed(3), east: ne.lng().toFixed(3),
  });
  try {
    const r = await fetch(`/api/weather/wind-grid?${params}`);
    if (r.ok) { windGrid = await r.json(); if (windDrawHeatmap) windDrawHeatmap(); }
  } catch (e) { console.warn('[wind] fetch error', e); }
}

function startWindParticles() {
  stopWindParticles();

  const W = window.innerWidth, H = window.innerHeight;

  // ── Heatmap canvas (below particles) ────────────────────────────────────────
  const hmW = Math.ceil(W / 4), hmH = Math.ceil(H / 4);
  windHmCanvas = document.createElement('canvas');
  windHmCanvas.width  = hmW;
  windHmCanvas.height = hmH;
  windHmCanvas.style.cssText = `position:fixed;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;z-index:1;opacity:0.85;filter:blur(18px);`;
  document.body.appendChild(windHmCanvas);
  const hmCtx = windHmCanvas.getContext('2d');

  // ── Particle canvas (above heatmap) ─────────────────────────────────────────
  windCanvas = document.createElement('canvas');
  windCanvas.width  = W;
  windCanvas.height = H;
  windCanvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:2;';
  document.body.appendChild(windCanvas);
  const ctx = windCanvas.getContext('2d');

  // ── Coordinate helpers ───────────────────────────────────────────────────────
  function toPixel(lat, lng) {
    const b = gmap.getBounds();
    if (!b) return null;
    const ne = b.getNorthEast(), sw = b.getSouthWest();
    let span = ne.lng() - sw.lng();
    if (span <= 0) span += 360;
    let lngOff = lng - sw.lng();
    if (lngOff < 0) lngOff += 360;
    if (lngOff > span) lngOff -= 360;
    return { x: (lngOff / span) * W, y: (1 - (lat - sw.lat()) / (ne.lat() - sw.lat())) * H };
  }

  function toLatLng(px, py) {
    const b = gmap.getBounds();
    if (!b) return null;
    const ne = b.getNorthEast(), sw = b.getSouthWest();
    let span = ne.lng() - sw.lng();
    if (span <= 0) span += 360;
    let lng = sw.lng() + (px / W) * span;
    if (lng > 180) lng -= 360;
    return { lat: sw.lat() + (1 - py / H) * (ne.lat() - sw.lat()), lng };
  }

  // ── IDW wind interpolation ───────────────────────────────────────────────────
  function windAt(lat, lng) {
    if (!windGrid.length) return null;
    let wu = 0, wv = 0, wt = 0;
    for (const pt of windGrid) {
      const d2 = (lat - pt.lat) ** 2 + (lng - pt.lng) ** 2;
      const w  = d2 < 1e-8 ? 1e8 : 1 / d2;
      const r  = pt.deg * Math.PI / 180;
      wu += w * pt.speed * Math.sin(r);
      wv += w * pt.speed * Math.cos(r);
      wt += w;
    }
    if (!wt) return null;
    const u = wu / wt, v = wv / wt;
    return { u, v, speed: Math.sqrt(u * u + v * v) };
  }

  // ── Windy.com exact heatmap color scale ─────────────────────────────────────
  const HM_RAMP = [
    [ 0,  [  8,  10,  25]],
    [ 2,  [ 15,  40, 120]],
    [ 4,  [ 20,  90, 180]],
    [ 7,  [ 35, 150, 190]],
    [10,  [ 55, 195, 165]],
    [13,  [ 90, 205, 120]],
    [17,  [140, 215,  80]],
    [21,  [205, 225,  45]],
    [25,  [245, 175,  30]],
    [30,  [225,  85,  25]],
    [38,  [185,  20,  25]],
    [50,  [100,   0,  30]],
  ];

  function hmColor(speed) {
    let i = HM_RAMP.length - 2;
    for (let j = 0; j < HM_RAMP.length - 1; j++) {
      if (speed <= HM_RAMP[j + 1][0]) { i = j; break; }
    }
    const t = Math.min(1, (speed - HM_RAMP[i][0]) / (HM_RAMP[i + 1][0] - HM_RAMP[i][0]));
    const [r0, g0, b0] = HM_RAMP[i][1], [r1, g1, b1] = HM_RAMP[i + 1][1];
    return [~~(r0 + t * (r1 - r0)), ~~(g0 + t * (g1 - g0)), ~~(b0 + t * (b1 - b0))];
  }

  function drawWindHeatmap() {
    if (!windGrid.length || !windHmCanvas) return;
    const img = hmCtx.createImageData(hmW, hmH);
    const d   = img.data;
    for (let row = 0; row < hmH; row++) {
      for (let col = 0; col < hmW; col++) {
        const ll = toLatLng(col * 4, row * 4);
        if (!ll) continue;
        const w = windAt(ll.lat, ll.lng);
        if (!w) continue;
        const [r, g, b] = hmColor(w.speed);
        const idx = (row * hmW + col) * 4;
        d[idx]   = r;
        d[idx+1] = g;
        d[idx+2] = b;
        d[idx+3] = Math.min(255, 60 + w.speed * 10); // calm=faint, strong=solid
      }
    }
    hmCtx.putImageData(img, 0, 0);
  }
  windDrawHeatmap = drawWindHeatmap;

  // ── Particles ────────────────────────────────────────────────────────────────
  function spawn() {
    const px = Math.random() * W;
    const py = Math.random() * H;
    const ll = toLatLng(px, py);
    return { x: px, y: py, px: null, py: null,
             lat: ll?.lat ?? 0, lng: ll?.lng ?? 0,
             age: 0, life: 80 + ~~(Math.random() * 80) };
  }

  const particles = Array.from({ length: 2000 }, spawn);

  let lastFrameTs = 0;
  let mapMoving = false;

  function frame(ts) {
    if (!windCanvas) return;
    windAnimId = requestAnimationFrame(frame);
    if (mapMoving) return;
    if (ts - lastFrameTs < 50) return; // ~20 fps
    lastFrameTs = ts;

    // Slow fade → long visible trails showing wind direction (Windy.com style)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';

    const zoom = gmap.getZoom() || 3;
    ctx.lineWidth = 1.2;
    ctx.lineCap   = 'round';

    const b       = gmap.getBounds();
    const lngSpan = b ? Math.abs(b.getNorthEast().lng() - b.getSouthWest().lng()) || 90 : 90;
    const pxPerDeg = W / lngSpan;

    // Speed proportional to actual wind (u/v already contain m/s), zoom-adaptive
    const SCALE  = pxPerDeg * 0.015;
    const MAX_PX = Math.max(1, 9 / zoom);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.age++;

      const w = windAt(p.lat, p.lng);
      if (!w) { particles[i] = spawn(); continue; }

      // Proportional speed — calm areas slow, windy areas fast (like Windy.com)
      let dx = -w.u * SCALE;
      let dy =  w.v * SCALE;
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag > MAX_PX) { const s = MAX_PX / mag; dx *= s; dy *= s; }

      p.px = p.x; p.py = p.y;
      p.x += dx;
      p.y += dy;

      const ll = toLatLng(p.x, p.y);
      if (!ll) { particles[i] = spawn(); continue; }
      p.lat = ll.lat; p.lng = ll.lng;

      // Windy.com-style sin fade: smooth in from 0, peak at mid-life, fade out to 0
      const alpha = Math.sin(Math.PI * p.age / p.life) * 0.9;
      if (alpha > 0.02) {
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
        ctx.stroke();
      }

      if (p.age >= p.life || p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) {
        particles[i] = spawn();
      }
    }
  }
  frame();

  let lastFetchKey = null;
  let lastFetchTime = 0;
  const FETCH_COOLDOWN = 2 * 60 * 1000; // 2 minutes between fetches for same viewport

  function maybeFetchWindGrid() {
    const b = gmap.getBounds();
    if (!b) return;
    const ne = b.getNorthEast(), sw = b.getSouthWest();
    // Round to 2 decimal places — only refetch if view moved meaningfully
    const key = [sw.lat(), sw.lng(), ne.lat(), ne.lng()].map(v => v.toFixed(2)).join(',');
    const now = Date.now();
    if (key === lastFetchKey && now - lastFetchTime < FETCH_COOLDOWN) return;
    lastFetchKey = key;
    lastFetchTime = now;
    fetchWindGrid();
  }

  const hideCanvas = () => {
    mapMoving = true;
    if (windCanvas) windCanvas.style.opacity = '0';
  };
  const dragListener = gmap.addListener('drag',         hideCanvas);
  const dragStartListener = gmap.addListener('dragstart', hideCanvas);
  const zoomListener = gmap.addListener('zoom_changed', hideCanvas);
  windListeners.push(dragListener, dragStartListener, zoomListener);

  const idleListener = gmap.addListener('idle', () => {
    mapMoving = false;
    // Reproject all particles to new screen positions then clear stale trails
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const pp = toPixel(p.lat, p.lng);
      if (pp && pp.x > -50 && pp.x < W + 50 && pp.y > -50 && pp.y < H + 50) {
        p.x = pp.x; p.y = pp.y; p.px = null; p.py = null;
      } else {
        particles[i] = spawn();
      }
    }
    ctx.clearRect(0, 0, W, H);
    if (windCanvas) windCanvas.style.opacity = '1';
    drawWindHeatmap();
    maybeFetchWindGrid();
  });
  windListeners.push(idleListener);

  if (gmap.getBounds()) maybeFetchWindGrid();
  else {
    const once = google.maps.event.addListenerOnce(gmap, 'idle', maybeFetchWindGrid);
    windListeners.push(once);
  }
}

function stopWindParticles() {
  if (windAnimId)    { cancelAnimationFrame(windAnimId); windAnimId = null; }
  if (windCanvas)    { windCanvas.remove(); windCanvas = null; }
  if (windHmCanvas)  { windHmCanvas.remove(); windHmCanvas = null; }
  windDrawHeatmap = null;
  if (windFetchTimer){ clearTimeout(windFetchTimer); windFetchTimer = null; }
  windListeners.forEach(l => google.maps.event.removeListener(l));
  windListeners = [];
  windGrid = [];
}

// (pressure uses the OWM tile overlay added by addWeatherOverlay — no custom canvas needed)

function rainMapStyle() {
  return [
    // Hide everything by default
    { featureType: 'all',                    elementType: 'labels',          stylers: [{ visibility: 'off' }] },
    { featureType: 'road',                                                    stylers: [{ visibility: 'off' }] },
    { featureType: 'transit',                                                 stylers: [{ visibility: 'off' }] },
    { featureType: 'poi',                                                     stylers: [{ visibility: 'off' }] },
    // Hide sub-national borders
    { featureType: 'administrative.province',    elementType: 'geometry',    stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.locality',    elementType: 'geometry',    stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.neighborhood',elementType: 'geometry',    stylers: [{ visibility: 'off' }] },
    // Show country borders — thin white line
    { featureType: 'administrative.country',     elementType: 'geometry.stroke', stylers: [{ visibility: 'on' }, { color: '#888888' }, { weight: 1.5 }] },
    { featureType: 'administrative.country',     elementType: 'geometry.fill',   stylers: [{ visibility: 'off' }] },
    // Show country name labels
    { featureType: 'administrative.country',     elementType: 'labels.text.fill',   stylers: [{ visibility: 'on' }, { color: '#ffffff' }] },
    { featureType: 'administrative.country',     elementType: 'labels.text.stroke', stylers: [{ visibility: 'on' }, { color: '#888888' }, { weight: 2 }] },
    // Base map colors — desaturated
    { featureType: 'landscape',  elementType: 'geometry', stylers: [{ color: '#a89878' }, { saturation: -60 }, { lightness: 10 }] },
    { featureType: 'water',      elementType: 'geometry', stylers: [{ color: '#d6c8a9' }, { saturation: -50 }] },
  ];
}

function weatherMapStyle(land, water) {
  return [
    { elementType: 'geometry', stylers: [{ color: land }] },
    { elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#888888' }] },
    { featureType: 'administrative.country', elementType: 'labels', stylers: [{ visibility: 'on' }] },
    { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#333' }] },
    { featureType: 'administrative.country', elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 2 }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: water }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', stylers: [{ visibility: 'off' }] },
  ];
}

const WEATHER_MAP_CONFIGS = {
  clouds_new:        { land: '#c8c0a8', water: '#a8a088', opacity: 1.0, doubleOverlay: true },
  precipitation_new: { land: '#c8c0a8', water: '#a8a088', opacity: 1.0 },
  temp_new:          { land: '#d5cfc0', water: '#a8bcc8', opacity: 1.0 },
  wind_new:          { land: '#c8b888', water: '#7a8a6a', opacity: 1.0 },
  pressure_new:      { land: '#e8dcc8', water: '#a8a088', opacity: 1.0 },
};

function getCesiumCenter() {
  if (!cesiumViewer) return { lat: 24.7, lng: 46.7, zoom: 4 };
  const cam = cesiumViewer.camera;
  const carto = cam.positionCartographic;
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const lng = Cesium.Math.toDegrees(carto.longitude);
  const altKm = carto.height / 1000;
  const zoom = Math.max(2, Math.min(12, Math.round(16 - Math.log2(altKm))));
  return { lat, lng, zoom };
}

function loadGoogleMapsAPI() {
  if (gmapLoaded) return Promise.resolve();
  return new Promise((res, rej) => {
    if (window.google?.maps) { gmapLoaded = true; res(); return; }
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${googleApiKey}`;
    s.onload = () => { gmapLoaded = true; res(); };
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

function initGoogleMap(center, style, bgColor) {
  const el = document.getElementById('google-map');
  gmap = new google.maps.Map(el, {
    center: { lat: center.lat, lng: center.lng },
    zoom: center.zoom,
    styles: style,
    backgroundColor: bgColor || '#d5cfc0',
    disableDefaultUI: true,
    zoomControl: false,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    minZoom: 3,
    maxZoom: 12,
    restriction: {
      latLngBounds: { north: 85, south: -85, west: -180, east: 180 },
      strictBounds: true,
    },
  });
  gmap.addListener('click', (e) => {
    if (e.latLng && weatherAvailable) {
      fetchWeatherAt(e.latLng.lat(), e.latLng.lng());
    }
  });
}

function addWeatherOverlay(type, doubleUp) {
  gmap.overlayMapTypes.clear();
  gmapOverlay = new google.maps.ImageMapType({
    getTileUrl: (coord, zoom) => `/api/weather/tile/${type}/${zoom}/${coord.x}/${coord.y}`,
    tileSize: new google.maps.Size(256, 256),
    maxZoom: 6,
    name: type,
  });
  gmap.overlayMapTypes.insertAt(0, gmapOverlay);
  const copies = doubleUp ? 3 : 0;
  for (let n = 1; n <= copies; n++) {
    gmap.overlayMapTypes.insertAt(n, new google.maps.ImageMapType({
      getTileUrl: (coord, zoom) => `/api/weather/tile/${type}/${zoom}/${coord.x}/${coord.y}`,
      tileSize: new google.maps.Size(256, 256),
      maxZoom: 6,
      name: `${type}_${n + 1}`,
    }));
  }
}

function addRainOverlay() {
  gmap.overlayMapTypes.clear();
  // Use a custom MapType so we can recolor pixels on a canvas — avoids all caching
  // and server-side PNG parsing issues that cause magenta broken tiles.
  const rainType = {
    tileSize: new google.maps.Size(256, 256),
    maxZoom: 6,
    name: 'rain_cyan',
    getTile(coord, zoom, ownerDocument) {
      const canvas = ownerDocument.createElement('canvas');
      canvas.width = canvas.height = 256;
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, 256, 256);
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] > 10) { d[i] = 10; d[i+1] = 40; d[i+2] = 120; d[i+3] = Math.min(255, d[i+3] * 3); }
        }
        ctx.putImageData(id, 0, 0);
      };
      img.onerror = () => {};
      img.src = `/api/weather/tile/precipitation_new/${zoom}/${coord.x}/${coord.y}`;
      return canvas;
    },
    releaseTile() {},
  };
  gmap.overlayMapTypes.insertAt(0, rainType);
}

function showWeatherMap() {
  document.getElementById('globe').classList.add('hidden');
  document.getElementById('google-map').classList.remove('hidden');
}

function hideWeatherMap() {
  document.getElementById('google-map').classList.add('hidden');
  document.getElementById('globe').classList.remove('hidden');
}

async function setWeatherLayer(type) {
  clearWeatherLayer();
  if (!type) return;

  // TODO: load Google Maps API, create/update gmap, add weather overlay, show weather map
}

function clearWeatherLayer() {
  stopWindParticles();
  if (gmap) {
    if (gmapOverlay) { gmap.overlayMapTypes.clear(); gmapOverlay = null; }
    gmap.setMapTypeId('roadmap');
  }
  hideWeatherMap();
  // Resume Cesium rendering
  if (cesiumViewer) cesiumViewer.useDefaultRenderLoop = true;
}

// ── Satellite tracking ────────────────────────────────────────────────────────
let satBillboards  = null;
let satMap         = new Map();
let satInterval    = null;
let satCategory    = 52;
let selectedSatId  = null;

function getSatCanvas() {
  if (getSatCanvas._c) return getSatCanvas._c;
  const N = 24, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const cx = cv.getContext('2d');
  cx.shadowBlur = 6; cx.shadowColor = 'rgba(32,214,192,0.8)';
  cx.fillStyle = '#20d6c0';
  cx.beginPath();
  cx.moveTo(N/2, 2); cx.lineTo(N-2, N/2); cx.lineTo(N/2, N-2); cx.lineTo(2, N/2);
  cx.closePath(); cx.fill();
  cx.shadowBlur = 0; cx.fillStyle = '#fff';
  cx.beginPath(); cx.arc(N/2, N/2, 2.5, 0, Math.PI*2); cx.fill();
  getSatCanvas._c = cv;
  return cv;
}

function changeSatCategory(val) {
  satCategory = parseInt(val, 10);
  if (satInterval) refreshSatellites();
}

function startSatTracking() {
  if (!cesiumViewer) return;
  if (!satBillboards) {
    satBillboards = cesiumViewer.scene.primitives.add(new Cesium.BillboardCollection());
  }
  refreshSatellites();
  satInterval = setInterval(refreshSatellites, 30000);
  document.getElementById('sat-sub').classList.remove('hidden');
}

function stopSatTracking() {
  clearInterval(satInterval); satInterval = null;
  if (satBillboards) { cesiumViewer.scene.primitives.remove(satBillboards); satBillboards = null; }
  satMap.clear();
  document.getElementById('sat-sub').classList.add('hidden');
  closeSat();
}

async function refreshSatellites() {
  if (!cesiumViewer) return;
  let lat = 0, lon = 0;
  try {
    const ray = cesiumViewer.camera.getPickRay(
      new Cesium.Cartesian2(cesiumViewer.canvas.clientWidth/2, cesiumViewer.canvas.clientHeight/2));
    const cart = cesiumViewer.scene.globe.pick(ray, cesiumViewer.scene);
    if (cart) {
      const carto = Cesium.Cartographic.fromCartesian(cart);
      lat = Cesium.Math.toDegrees(carto.latitude);
      lon = Cesium.Math.toDegrees(carto.longitude);
    }
  } catch (e) { /* use 0,0 */ }
  try {
    const r = await fetch(`/api/satellites/above?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&alt=0&radius=90&category=${satCategory}`);
    if (!r.ok) return;
    const data = await r.json();
    applySatStates(data.above || data);
  } catch (e) { console.warn('[sat]', e); }
}

function applySatStates(sats) {
  if (!satBillboards || !Array.isArray(sats)) return;
  const seen = new Set();
  for (const s of sats) {
    const id   = s.satid;
    const lat  = s.satlat ?? s.lat;
    const lon  = s.satlng ?? s.lon;
    const altM = (s.satalt ?? s.altKm ?? 400) * 1000;
    seen.add(id);
    if (satMap.has(id)) {
      const entry = satMap.get(id);
      entry.bb.position = Cesium.Cartesian3.fromDegrees(lon, lat, altM);
      entry.d = s;
    } else {
      const bb = satBillboards.add({
        id:       'sat_' + id,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, altM),
        image:    getSatCanvas(),
        scale:    1.2,
        color:    Cesium.Color.fromCssColorString('#20d6c0'),
        heightReference: Cesium.HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1e5, 1.5, 5e7, 0.4),
      });
      satMap.set(id, { bb, d: s });
    }
  }
  for (const [id, entry] of satMap) {
    if (!seen.has(id)) { satBillboards.remove(entry.bb); satMap.delete(id); }
  }
  setStatus(`Satellites: ${satMap.size}`);
}

function openSatInfoWindow(bbId) {
  const id = parseInt(bbId.replace('sat_', ''), 10);
  if (selectedSatId !== null && selectedSatId !== id) deselectSat();
  const entry = satMap.get(id);
  if (!entry) return;
  selectedSatId = id;
  entry.bb.scale = 1.8;
  entry.bb.color = Cesium.Color.WHITE;
  const d = entry.d;
  document.getElementById('si-name').textContent   = d.satname ?? d.name ?? '—';
  document.getElementById('si-id').textContent     = 'NORAD ' + id;
  document.getElementById('si-alt').textContent    = (d.satalt ?? d.altKm ?? 0).toFixed(0) + ' km';
  document.getElementById('si-lat').textContent    = (d.satlat ?? d.lat ?? 0).toFixed(4) + '°';
  document.getElementById('si-lon').textContent    = (d.satlng ?? d.lon ?? 0).toFixed(4) + '°';
  document.getElementById('si-int').textContent    = d.intDesignator ?? '—';
  document.getElementById('si-launch').textContent = d.launchDate ?? '—';
  document.getElementById('si-link').innerHTML     = `<a href="https://www.n2yo.com/satellite/?s=${id}" target="_blank" style="color:var(--cyan)">n2yo.com ↗</a>`;
  document.getElementById('sat-info').classList.remove('hidden');
}

function deselectSat() {
  if (selectedSatId === null) return;
  const entry = satMap.get(selectedSatId);
  if (entry) { entry.bb.scale = 1.2; entry.bb.color = Cesium.Color.fromCssColorString('#20d6c0'); }
  selectedSatId = null;
}

function closeSat() {
  deselectSat();
  document.getElementById('sat-info').classList.add('hidden');
}

// ── Satellite view (activates tracking on 3D globe) ──────────────────────────
function startSatelliteView() {
  // TODO: show globe, hide google-map, resume Cesium rendering, start tracking
}

function stopSatelliteView() {
  stopSatTracking();
  setStatus('');
}

// ═════════════════════════════════════════════════════════════════════════════
// CAMERA FEEDS
// ═════════════════════════════════════════════════════════════════════════════

let camCanvas = null;

function getCamIcon() {
  if (camCanvas) return camCanvas;
  const N = 32;
  camCanvas = document.createElement('canvas');
  camCanvas.width = camCanvas.height = N;
  const ctx = camCanvas.getContext('2d');
  ctx.fillStyle = '#22d3ee';
  ctx.shadowColor = 'rgba(34,211,238,0.7)';
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.arc(N / 2, N / 2, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(N / 2, N / 2, 4, 0, Math.PI * 2);
  ctx.fill();
  return camCanvas;
}

function isCameraZoomAllowed() {
  if (!cesiumViewer) return false;
  return cesiumViewer.camera.positionCartographic.height <= CAM_MAX_HEIGHT_M;
}

function startCameras() {
  if (!cesiumViewer) return;
  camEnabled = true;
  // TODO: create billboard collection, load webcams if zoomed in, add moveEnd listener
  setStatus('Zoom in for cameras');
}

function stopCameras() {
  camEnabled = false;
  if (cesiumViewer) cesiumViewer.camera.moveEnd.removeEventListener(debouncedCamLoad);
  if (camDebounceTimer) { clearTimeout(camDebounceTimer); camDebounceTimer = null; }
  clearCams();
  lastCamKey = '';
}

function debouncedCamLoad() {
  if (!isCameraZoomAllowed()) {
    clearCams();
    lastCamKey = '';
    setStatus('Zoom in for cameras');
    return;
  }
  if (camDebounceTimer) clearTimeout(camDebounceTimer);
  camDebounceTimer = setTimeout(loadNearbyWebcams, 800);
}

function clearCams() {
  if (camBillboards) camBillboards.removeAll();
  camMap.clear();
}

function getCameraTarget() {
  const ray = cesiumViewer.camera.getPickRay(new Cesium.Cartesian2(
    cesiumViewer.canvas.clientWidth / 2,
    cesiumViewer.canvas.clientHeight / 2,
  ));
  if (!ray) return null;
  const hit = cesiumViewer.scene.globe.pick(ray, cesiumViewer.scene);
  if (!hit) return null;
  const carto = Cesium.Cartographic.fromCartesian(hit);
  return { lat: Cesium.Math.toDegrees(carto.latitude), lon: Cesium.Math.toDegrees(carto.longitude) };
}

async function loadNearbyWebcams() {
  if (!cesiumViewer || !camEnabled || camFetchPending) return;

  if (!isCameraZoomAllowed()) { clearCams(); lastCamKey = ''; setStatus('Zoom in for cameras'); return; }

  const target = getCameraTarget();
  if (!target) return;
  const { lat, lon } = target;
  const altKm = cesiumViewer.camera.positionCartographic.height / 1000;
  const radius = Math.min(250, Math.max(10, Math.round(altKm / 15)));

  const key = `${lat.toFixed(1)},${lon.toFixed(1)},${radius}`;
  if (key === lastCamKey) return;
  lastCamKey = key;

  if (camDataCache.has(key)) { renderCams(camDataCache.get(key)); return; }

  camFetchPending = true;
  try {
    const r = await fetch(`/api/webcams?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&radius=${radius}`);
    if (!r.ok) { if (r.status === 503) setStatus('No API key'); return; }
    const data = await r.json();
    const webcams = data.webcams || [];
    camDataCache.set(key, webcams);
    renderCams(webcams);
  } catch (e) { console.warn('Webcam fetch:', e.message); }
  finally { camFetchPending = false; }
}

function renderCams(webcams) {
  clearCams();
  let count = 0;
  for (const wc of webcams) {
    if (count >= 30) break;
    const loc = wc.location;
    if (!loc) continue;
    const camId = String(wc.webcamId || wc.id);

    camBillboards.add({
      id: 'cam_' + camId,
      position: Cesium.Cartesian3.fromDegrees(loc.longitude, loc.latitude, 200),
      image: getCamIcon(),
      scale: 1.4,
      heightReference: Cesium.HeightReference.NONE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });

    camMap.set(camId, {
      data: {
        camId,
        title: wc.title || 'Webcam',
        city: loc.city || '',
        thumbnail: wc.images?.current?.preview || wc.images?.current?.thumbnail || '',
        player: wc.player?.day || wc.player?.lifetime || '',
      },
    });
    count++;
  }
  setStatus(camMap.size + ' cameras');
}

function openCam(bbId) {
  const camId = bbId.replace('cam_', '');
  const entry = camMap.get(camId);
  if (!entry) return;
  const url = entry.data.player || entry.data.thumbnail || '';
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

// ═════════════════════════════════════════════════════════════════════════════
// CLICK-FOR-WEATHER
// ═════════════════════════════════════════════════════════════════════════════

const WIND_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

function windCompass(deg) {
  if (deg == null) return '--';
  return WIND_DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

async function fetchWeatherAt(lat, lon) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '--'; };
  const card = document.getElementById('weather-card');
  if (!card) return;

  set('wc-location', 'Loading...');
  set('wc-coords', `${lat.toFixed(3)}, ${lon.toFixed(3)}`);
  card.classList.remove('hidden');

  // TODO: fetch from /api/weather/current and populate card fields
}

function closeWeatherCard() {
  document.getElementById('weather-card')?.classList.add('hidden');
}

// ═════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═════════════════════════════════════════════════════════════════════════════

function goTo(lat, lng, zoom) {
  if (!cesiumViewer) return;
  cesiumViewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat - 8, 3_000_000),
    orientation: { heading: 0, pitch: -Cesium.Math.toRadians(35), roll: 0 },
    duration: 2,
  });
}

function zoomIn() { if (cesiumViewer) cesiumViewer.camera.zoomIn(100000); }
function zoomOut() { if (cesiumViewer) cesiumViewer.camera.zoomOut(100000); }

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowUp')   { e.preventDefault(); zoomIn(); }
  if (e.key === 'ArrowDown') { e.preventDefault(); zoomOut(); }
});
function closeFlight() { deselectFlight(); }

// ── Expose to HTML ───────────────────────────────────────────────────────────
window.goTo = goTo;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.closeFlight = closeFlight;
window.closeWeatherCard = closeWeatherCard;
