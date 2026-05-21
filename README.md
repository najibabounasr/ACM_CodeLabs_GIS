# Workshop Workspace

**ACM SigSOFT CodeLabs — Al Faisal University**

Follow along with your instructor. Complete each exercise in order.

---

## Setup (one time)

From the **project root** (the `ACM_CodeLabs_GIS/` folder), run:

```bash
npm install
node server.js
```

The server runs at **http://localhost:3000**. Keep it running for all exercises.

---

## API Keys

Your instructor will write API keys on the board. Paste them into the top of each exercise's `src/main.js`:

```js
const GOOGLE_API_KEY = '';  // <-- paste here
const OWM_API_KEY    = '';  // <-- paste here (exercises 2 & 3)
```

**Do not commit API keys to git.**

---

## Exercises

| Folder | Exercise | What You Build |
|---|---|---|
| `exercise1/` | Base Maps | 2D map, 3D city, globe, Google 3D Tiles |
| `exercise2/` | Weather Maps | Google Maps + live weather overlays |
| `exercise3/` | Full Demo | 3D globe with flights, weather, satellites, cameras |
| `bonus/proptech/` | SF Housing Analysis | Jupyter notebook — pandas + hvplot + GeoViews |

Each `src/main.js` has **TODO** blocks marking exactly where to write code. Everything else is done for you.

After each exercise, the instructor will push the solution so you can compare.

---

## Bonus (if time allows)

The `bonus/proptech/` folder has a Jupyter notebook and all CSV data files ready. Open it with:

```bash
jupyter lab bonus/proptech/workshop_housing_analysis.ipynb
```

Requires: `pip install pandas hvplot geoviews`
