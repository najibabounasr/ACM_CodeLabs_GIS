let googleApiKey = '';
let weatherAvailable = false;
let activeWeatherType = null;
let activeLayer = null;

let gmap = null;
let gmapOverlay = null;

// ── Wind particle overlay ─────────────────────────────────────────────────────
let windCanvas    = null;
let windHmCanvas      = null;
let windDrawHeatmap   = null;
let windAnimId    = null;
let windGrid      = [];
let windListeners = [];
let windFetchTimer = null;

function setStatus(text) {
  const el = document.getElementById('layer-status');
  if (el) el.textContent = text;
}

// ═════════════════════════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════════════════════════

(async function boot() {
  const [gCfg, wCfg] = await Promise.all([
    fetch('/api/google-config').then(r => r.json()).catch(() => ({})),
    fetch('/api/weather/config').then(r => r.json()).catch(() => ({})),
  ]);

  googleApiKey = gCfg.apiKey || '';
  weatherAvailable = wCfg.available || false;

  await loadGoogleMapsAPI();
  setupSidebar();

  // Start with temp layer by default so the map isn't empty
  const center = { lat: 24.7, lng: 46.7, zoom: 4 };
  const style = weatherMapStyle('#d5cfc0', '#a8bcc8');
  initGoogleMap(center, style, '#d5cfc0');

  document.getElementById('loading').classList.add('done');
})();

// ═════════════════════════════════════════════════════════════════════════════
// SIDEBAR
// ═════════════════════════════════════════════════════════════════════════════

function setupSidebar() {
  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer;
      if (activeLayer === layer) {
        activeLayer = null;
        btn.classList.remove('active');
        document.getElementById('weather-sub').classList.add('hidden');
        clearWeatherLayer();
        setStatus('Pick a weather layer');
      } else {
        if (activeLayer) {
          document.querySelector(`.layer-btn[data-layer="${activeLayer}"]`)?.classList.remove('active');
          if (activeLayer === 'weather') {
            document.getElementById('weather-sub').classList.add('hidden');
          }
        }
        activeLayer = layer;
        btn.classList.add('active');
        if (layer === 'weather') {
          document.getElementById('weather-sub').classList.remove('hidden');
          setStatus('Pick a weather type');
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

// ═════════════════════════════════════════════════════════════════════════════
// GOOGLE MAPS + WEATHER LAYERS
// ═════════════════════════════════════════════════════════════════════════════

let gmapLoaded = false;

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

function rainMapStyle() {
  return [
    { featureType: 'all',                    elementType: 'labels',          stylers: [{ visibility: 'off' }] },
    { featureType: 'road',                                                    stylers: [{ visibility: 'off' }] },
    { featureType: 'transit',                                                 stylers: [{ visibility: 'off' }] },
    { featureType: 'poi',                                                     stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.province',    elementType: 'geometry',    stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.locality',    elementType: 'geometry',    stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.neighborhood',elementType: 'geometry',    stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.country',     elementType: 'geometry.stroke', stylers: [{ visibility: 'on' }, { color: '#888888' }, { weight: 1.5 }] },
    { featureType: 'administrative.country',     elementType: 'geometry.fill',   stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.country',     elementType: 'labels.text.fill',   stylers: [{ visibility: 'on' }, { color: '#ffffff' }] },
    { featureType: 'administrative.country',     elementType: 'labels.text.stroke', stylers: [{ visibility: 'on' }, { color: '#888888' }, { weight: 2 }] },
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

function initGoogleMap(center, style, bgColor) {
  // TODO: create google.maps.Map in 'google-map' div, add click listener
}

function addWeatherOverlay(type, doubleUp) {
  gmap.overlayMapTypes.clear();
  // TODO: create ImageMapType for weather tiles, add to gmap.overlayMapTypes
}

function addRainOverlay() {
  gmap.overlayMapTypes.clear();
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

async function setWeatherLayer(type) {
  clearWeatherLayer();
  if (!type || !gmap) return;

  const cfg = WEATHER_MAP_CONFIGS[type] || WEATHER_MAP_CONFIGS.temp_new;
  const isRain = type === 'precipitation_new';
  const style  = isRain ? rainMapStyle() : weatherMapStyle(cfg.land, cfg.water);

  gmap.setMapTypeId('roadmap');
  gmap.setOptions({ styles: style, backgroundColor: isRain ? '#c8a84b' : cfg.land });

  // TODO: call addWeatherOverlay(type, cfg.doubleOverlay)

  const names = { clouds_new: 'Clouds', precipitation_new: 'Rain', temp_new: 'Temperature', wind_new: 'Wind', pressure_new: 'Pressure' };
  setStatus(names[type] || 'Weather');
}

function clearWeatherLayer() {
  stopWindParticles();
  if (gmap) {
    if (gmapOverlay) { gmap.overlayMapTypes.clear(); gmapOverlay = null; }
    gmap.setMapTypeId('roadmap');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// WIND PARTICLES (from public-google)
// ═════════════════════════════════════════════════════════════════════════════

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

  const hmW = Math.ceil(W / 4), hmH = Math.ceil(H / 4);
  windHmCanvas = document.createElement('canvas');
  windHmCanvas.width  = hmW;
  windHmCanvas.height = hmH;
  windHmCanvas.style.cssText = `position:fixed;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;z-index:1;opacity:0.85;filter:blur(18px);`;
  document.body.appendChild(windHmCanvas);
  const hmCtx = windHmCanvas.getContext('2d');

  windCanvas = document.createElement('canvas');
  windCanvas.width  = W;
  windCanvas.height = H;
  windCanvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:2;';
  document.body.appendChild(windCanvas);
  const ctx = windCanvas.getContext('2d');

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
        d[idx+3] = Math.min(255, 60 + w.speed * 10);
      }
    }
    hmCtx.putImageData(img, 0, 0);
  }
  windDrawHeatmap = drawWindHeatmap;

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
    if (ts - lastFrameTs < 50) return;
    lastFrameTs = ts;

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

    const SCALE  = pxPerDeg * 0.015;
    const MAX_PX = Math.max(1, 9 / zoom);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.age++;

      const w = windAt(p.lat, p.lng);
      if (!w) { particles[i] = spawn(); continue; }

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
  const FETCH_COOLDOWN = 2 * 60 * 1000;

  function maybeFetchWindGrid() {
    const b = gmap.getBounds();
    if (!b) return;
    const ne = b.getNorthEast(), sw = b.getSouthWest();
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
  if (window.google?.maps) {
    windListeners.forEach(l => google.maps.event.removeListener(l));
  }
  windListeners = [];
  windGrid = [];
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

function goTo(lat, lng) {
  if (gmap) {
    gmap.panTo({ lat, lng });
    gmap.setZoom(6);
  }
}

window.goTo = goTo;
window.closeWeatherCard = closeWeatherCard;
