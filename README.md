# Movies & TV Explorer

Movies & TV Explorer is a responsive web app for finding movies and TV shows. It was built for **CSE-2340 Software Development I (MP3-MP4)** and grew out of the earlier TV Show Explorer project. Search both catalogs, read details, browse episodes of TV shows, and save everything to one watchlist that is still there after you refresh the page.

## Developer Information

| | |
|---|---|
| **Developer** | Mohammad Muhaiminur Rahman |
| **GitHub** | [MRT-Tahmid]([https://github.com/MRT-Tahmid]) |
| **Institution** | International Islamic University Chittagong (IIUC) |
| **Department** | Computer Science and Engineering |
| **Course** | CSE-2340 — Software Development I |
| **Assessment** | Mini Project 3–4 (MP3–MP4), individual academic project |
| **Project** | Movies & TV Shows Explorer |
| **Repository** | [https://github.com/MRT-Tahmid/movies-tv_series-explorer] |
| **Live website** | [https://movies-tvseries-explorer.vercel.app/]) |
| **Email** | [muhaiminur.rahman2005@gmail.com] |





## Features
- **Home:** cinematic hero with search, a featured movie, Trending Movies and Popular TV Shows rows
- **Movies:** search by title, trending list, genre filter, sort by rating, details (overview, release date, genres, runtime, rating, poster)
- **TV Shows:** search by title, top-rated list, genre filter, sort by rating, details with schedule (when available) and episodes by season
- **My Watchlist:** one list for movies and TV shows, each marked with a Movie / TV show badge, filter by type, remove items, helpful empty state
- Loading, error (with "Try again") and empty states for every request
- Fallback poster when an image is missing or broken
- Accessible details window: close button, Escape key, click outside, focus trap, focus returns to the button you used, background scrolling locked
- **About page:** project information, developer card and academic project details
- Responsive layout for phones, tablets, laptops and large screens, with a mobile menu

## Technologies
- HTML5, CSS3, vanilla JavaScript (ES6+)
- `fetch()` with `async/await`
- Browser Local Storage
- TVmaze API and TMDB API
- No frameworks, no jQuery, no backend

## APIs

### TV shows: TVmaze (no key needed)
Base URL: `https://api.tvmaze.com`

| Purpose | Endpoint |
|---|---|
| Search | `/search/shows?q=QUERY` |
| Details | `/shows/ID` |
| Episodes | `/shows/ID/episodes` |
| Top-rated list | `/shows?page=0` |

### Movies: TMDB (free API key needed)
Base URL: `https://api.themoviedb.org/3`

| Purpose | Endpoint |
|---|---|
| Search | `/search/movie?query=QUERY` |
| Trending | `/trending/movie/week` |
| Details | `/movie/ID` |
| Genre names | `/genre/movie/list` |

TMDB requires a key, so movies will not load until you add one. TV shows work without it.


   ```

## Run the project
1. Open the `tv-show-explorer` folder in VS Code.
2. Add your TMDB key (above).
3. Install the **Live Server** extension, right-click `index.html`, and choose **Open with Live Server**.

You need an internet connection because all data comes from the APIs.

## Project structure
```
tv-show-explorer/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── config.js        (your TMDB key)
│   └── script.js        (all application logic)
├── assets/
│   └── images/
├── screenshots/         (add your own images here)
└── README.md
```

## Local Storage and the watchlist
The watchlist is stored in your own browser under the key `moviesTvWatchlist`. Movies and TV shows share **one array** because every item has the same shape:

```js
{ key: "movie-27205", type: "movie", id: 27205, title: "Inception",
  image: "https://...", rating: 8.4, genres: ["Action"], year: "2010" }
```

`type` says whether it is a movie or a TV show, and `key` (`type` + `id`) is unique, so a movie and a TV show with the same id never clash and the same title cannot be saved twice. The array is saved with `JSON.stringify()` and read back with `JSON.parse()` when the page opens. When loading, damaged or duplicate entries are dropped, and if storage is blocked or corrupted the app starts with an empty list instead of breaking. Favorites saved by the earlier TV-only version (key `tvShowExplorerFavorites`) are picked up automatically as TV shows.

There is no server or database, so the watchlist stays on one browser on one device, and clearing site data removes it.

## Testing checklist
- Without a key: TV pages work and Movies pages show the setup message.
- With a key: search `inception` in Movies and `batman` in TV Shows.
- Filter by genre, sort by rating, clear the search.
- Add a movie and a TV show to the watchlist, refresh, and check both are still there with the right badges.
- Open the **About** page from the navigation: check the project info, developer card and academic section on desktop, tablet and phone widths. Placeholder links show a short message until real URLs are added.
- Open View Details, press Tab (focus stays inside), then close with Escape, the close button, or by clicking outside.
- Turn off your internet and search to see the error message and "Try again" button.

## Screenshots
Take screenshots, save them in `screenshots/`, and update these lines:

```
![Home](screenshots/home.png)
![Movies](screenshots/movies.png)
![TV shows](screenshots/tv.png)
![Watchlist](screenshots/watchlist.png)
```

## Deploy on GitHub Pages
1. Push the project to a GitHub repository with `index.html` at the top level.
2. Open **Settings > Pages**, set **Source** to **Deploy from a branch**, choose **main** and **/ (root)**, and save.
3. Open `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`.

## Credits
TV data provided by [TVmaze](https://www.tvmaze.com). This product uses the TMDB API but is not endorsed or certified by TMDB.

Developer: Mohammad Muhaiminur Rahman (GitHub: MRT-Tahmid), Computer Science and Engineering, International Islamic University Chittagong.

## GitHub repository "About" box
Use these values in the repository sidebar (the gear icon next to **About**):

- **Description:** An interactive Movies & TV Shows Explorer built with HTML, CSS, and Vanilla JavaScript using TMDB and TVmaze APIs.
- **Website:** your deployed Vercel URL (add it when available).

GitHub's About panel only holds a description, website and topics, so the detailed developer information lives in this README and on the website's About page.
