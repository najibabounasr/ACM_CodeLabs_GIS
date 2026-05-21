let googleApiKey = '';
let weatherAvailable = false;
let activeWeatherType = null;
let activeLayer = null;

let gmap = null;
let gmapOverlay = null;

// ── Wind particle overlay ─────────────────────────────────────────────────────
function setStatus(text) {
  const el = document.getElementById('layer-status');
  if (el) el.textContent = text;
}

// ═════════════════════════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════════════════════════

(async function boot() {
  const [gCfg, wCfg] = await Promise.all([

  ]);


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
// CLICK-FOR-WEATHER
// ═════════════════════════════════════════════════════════════════════════════

const WIND_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

function windCompass(deg) {

}

async function fetchWeatherAt(lat, lon) {


  // TODO: fetch from /api/weather/current and populate card fields
}

function closeWeatherCard() {

}

// ═════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═════════════════════════════════════════════════════════════════════════════

function goTo(lat, lng) {

}

window.goTo = goTo;
window.closeWeatherCard = closeWeatherCard;
