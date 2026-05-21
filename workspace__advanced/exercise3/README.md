# Exercise 3 — Full Demo

**3D Globe with Flights, Weather, Satellites, and Webcams**

---

## Objective

Combine everything from the previous exercises into a single 3D globe application with multiple toggleable data layers. This is the most complete exercise — it brings together CesiumJS, Google 3D Tiles, and several live data APIs into one interface.

## What You'll Use

| Tool | Purpose |
|---|---|
| **CesiumJS** | 3D globe engine |
| **Google Maps API** | Photorealistic 3D Tiles + weather base map |
| **OpenSky Network API** | Live flight positions |
| **OpenWeatherMap API** | Weather tile overlays + wind particles |
| **N2YO API** | Real-time satellite positions (optional) |
| **Windy Webcams API** | Nearby webcam feeds (optional) |
| **Express.js** | API proxy server |

## What You'll Build

- A CesiumJS globe with Google's photorealistic 3D Tiles
- A sidebar with toggleable data layers (one active at a time)
- **Flights**: live aircraft positions rendered as billboards, with route arcs showing departure/arrival airports, and an info panel with altitude, speed, heading, and progress
- **Weather**: switches to a 2D Google Map with the same weather overlays from Exercise 2 (clouds, rain, temperature, wind particles, pressure)
- **Satellites**: real-time positions of satellites in orbit, rendered as billboards above the globe
- **Webcams**: location-based webcam markers that appear when you zoom in close enough
- Click anywhere on the globe to zoom in and fetch local weather
- A navigation bar to fly to preset cities

## Key Concepts

- Billboard collections for rendering thousands of moving points efficiently
- Great-circle math for flight route arcs
- Switching between CesiumJS and Google Maps views depending on the active layer
- Real-time data polling with `setInterval`
- Camera-based visibility (webcams only load when zoomed in enough)
- Layered architecture: one active data layer at a time to keep things manageable
