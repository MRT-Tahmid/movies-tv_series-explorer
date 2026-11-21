// Movies & TV Explorer - CSE-2340 MP3/MP4
// Vanilla JavaScript only. TV data: TVmaze API. Movie data: TMDB API (needs a free key in js/config.js).
// The whole file is wrapped in a function so no variables leak into the global scope.
(() => {
  "use strict";

  /* ==========================================================
     1. CONSTANTS, STATE AND DOM REFERENCES
     ========================================================== */
  const TVMAZE_BASE = "https://api.tvmaze.com";
  const TMDB_BASE = "https://api.themoviedb.org/3";
  const TMDB_IMAGE = "https://image.tmdb.org/t/p/";
  // The key lives in js/config.js (loaded before this file). An empty key is allowed.
  const TMDB_API_KEY = ((window.APP_CONFIG && window.APP_CONFIG.TMDB_API_KEY) || "").trim();

  const WATCHLIST_KEY = "moviesTvWatchlist";
  const OLD_FAVORITES_KEY = "tvShowExplorerFavorites";   // saved by the earlier TV-only version

  // "movie" and "tv" are the two content types. These objects avoid repeated if/else code.
  const VIEW_FOR_TYPE = { movie: "movies", tv: "tv" };
  const TYPE_LABEL = { movie: "Movie", tv: "TV show" };
  const DEFAULT_HEADING = { movie: "Trending movies this week", tv: "Top-rated TV shows" };

  const EPISODES_HTML = `
    <div class="episodes">
      <div class="episodes-head">
        <h3>Episodes</h3>
        <label>Season <select id="season-select"></select></label>
      </div>
      <div id="episode-status" class="status" role="status"></div>
      <ul id="episode-list" class="episode-list"></ul>
    </div>`;

  // One object holds everything the app needs to remember.
  const state = {
    watchlist: [],                     // saved movies AND TV shows, mirrored in Local Storage
    genreNames: new Map(),             // TMDB genre id -> name
    browse: {                          // what each Movies / TV Shows page is showing
      movie: { items: [], requestId: 0, loaded: false },
      tv: { items: [], requestId: 0, loaded: false },
    },
  };

  // Cache of API requests so the same URL is never fetched twice.
  const cache = new Map();

  let detailsRequestId = 0;            // ignore details that finish after the modal closed
  let lastFocusedElement = null;       // where focus returns after the modal closes
  let toastTimer = null;

  // Grab elements once and reuse them.
  const heroSearchInput = document.querySelector("#search-input");
  const heroSearchBtn = document.querySelector("#search-btn");
  const heroType = document.querySelector("#hero-type");
  const heroStatus = document.querySelector("#hero-status");
  const hero = document.querySelector("#hero");
  const featured = document.querySelector("#featured");
  const watchlistGrid = document.querySelector("#watchlist-grid");
  const watchlistStatus = document.querySelector("#watchlist-status");
  const watchlistFilter = document.querySelector("#watchlist-filter");
  const watchCount = document.querySelector("#watch-count");
  const menuToggle = document.querySelector("#menu-toggle");
  const navLinks = document.querySelector("#nav-links");
  const modal = document.querySelector("#modal");
  const modalBody = document.querySelector("#modal-body");
  const modalClose = document.querySelector("#modal-close");
  const toast = document.querySelector("#toast");
  const pageRegions = document.querySelectorAll("header, main, footer");   // hidden from keyboard while modal is open

  // The Movies and TV Shows pages have the same layout, so we find their parts the same way.
  function getBrowseElements(type) {
    const section = document.querySelector(`#view-${VIEW_FOR_TYPE[type]}`);
    return {
      heading: section.querySelector(".browse-heading"),
      input: section.querySelector(".search-input"),
      searchBtn: section.querySelector(".search-btn"),
      clearBtn: section.querySelector(".clear-btn"),
      genre: section.querySelector(".genre-filter"),
      sort: section.querySelector(".sort-select"),
      count: section.querySelector(".result-count"),
      status: section.querySelector(".browse-status"),
      grid: section.querySelector(".browse-grid"),
    };
  }
  const browseUI = { movie: getBrowseElements("movie"), tv: getBrowseElements("tv") };

  const homeRows = {
    movie: { grid: document.querySelector("#home-movies-row"), status: document.querySelector("#home-movies-status") },
    tv: { grid: document.querySelector("#home-tv-row"), status: document.querySelector("#home-tv-status") },
  };

  /* ==========================================================
     2. HELPERS
     ========================================================== */

  // Some TVmaze image links use http://, which browsers block on https pages.
  function toHttps(url) {
    return url ? url.replace(/^http:\/\//i, "https://") : null;
  }

  // Only allow normal web links in href attributes.
  function isSafeUrl(url) {
    try {
      const protocol = new URL(url).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  // ONE shape for every movie and TV show. This is what the cards, the
  // watchlist and Local Storage all use, so they can live in the same array.
  function makeItem(type, id, title, image, rating, genres, year) {
    return {
      key: `${type}-${id}`,                                   // unique across movies and TV shows
      type,                                                   // "movie" or "tv"
      id,
      title,
      image: typeof image === "string" && image ? image : null,
      rating: typeof rating === "number" && rating > 0 ? rating : null,
      genres: Array.isArray(genres) ? genres : [],
      year: year ? String(year) : "N/A",
    };
  }

  // Turn a raw TVmaze show into our shape.
  function tvToItem(show) {
    return makeItem(
      "tv", show.id, show.name || "Untitled show",
      show.image ? toHttps(show.image.medium) : null,
      show.rating ? show.rating.average : null,
      show.genres,
      show.premiered ? show.premiered.slice(0, 4) : null
    );
  }

  // Turn a raw TMDB movie (from a list) into our shape.
  function movieToItem(movie) {
    const item = makeItem(
      "movie", movie.id, movie.title || "Untitled movie",
      movie.poster_path ? `${TMDB_IMAGE}w342${movie.poster_path}` : null,
      movie.vote_average,
      (movie.genre_ids || []).map((id) => state.genreNames.get(id)).filter(Boolean),
      movie.release_date ? movie.release_date.slice(0, 4) : null
    );
    item.backdrop = movie.backdrop_path ? `${TMDB_IMAGE}w1280${movie.backdrop_path}` : null;   // used by the home banner only
    return item;
  }

  // The TVmaze summary contains HTML tags (<p>, <b>). Strip them to plain text.
  function stripHtml(html) {
    if (!html) return "No description available.";
    return new DOMParser().parseFromString(html, "text/html").body.textContent;
  }

  // Escape text before putting it into innerHTML templates.
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  const formatRating = (rating) => (rating ? rating.toFixed(1) : "Not rated");
  const formatGenres = (genres) => (genres.length ? genres.join(", ") : "None listed");

  // Turn a technical error into a message a user can act on.
  function describeError(error, subject) {
    if (error.code === "NO_KEY") return "Movies need a free TMDB API key. Add it to js/config.js (see the README), then reload the page.";
    if (error.status === 401) return "TMDB rejected the API key. Check the key in js/config.js.";
    if (error.status === 404) return `We could not find ${subject}.`;
    if (error.status === 429) return "The server is busy right now. Wait a moment and try again.";
    if (error.status >= 500) return "The server is having problems. Try again later.";
    if (error instanceof SyntaxError) return "The server sent data we could not read. Try again.";
    return `Could not load ${subject}. Check your internet connection and try again.`;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 4500);
  }

  /* ==========================================================
     3. API LAYER (fetch + async/await) - no DOM code in here
     ========================================================== */
  // Fetches a URL once. The request itself is cached, so two clicks that ask for
  // the same URL share one network request. Failed requests are removed so a
  // retry really tries again.
  function fetchJSON(url) {
    if (cache.has(url)) return cache.get(url);

    const request = (async () => {
      const response = await fetch(url);
      if (!response.ok) {                                 // 401, 404, 429, 500 ...
        const error = new Error(`Request failed with status ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.json();                             // throws SyntaxError on invalid JSON
    })();

    cache.set(url, request);
    request.catch(() => cache.delete(url));
    return request;
  }

  /* ----- TV shows: TVmaze (no key needed) ----- */
  async function searchTvShows(query) {
    const data = await fetchJSON(`${TVMAZE_BASE}/search/shows?q=${encodeURIComponent(query)}`);
    if (!Array.isArray(data)) throw new SyntaxError("Search response was not a list");
    return data
      .filter((entry) => entry && entry.show && entry.show.id)   // skip broken entries
      .map((entry) => tvToItem(entry.show));
  }

  async function getTopTvShows() {
    const shows = await fetchJSON(`${TVMAZE_BASE}/shows?page=0`);
    if (!Array.isArray(shows)) throw new SyntaxError("Show list was invalid");
    return shows
      .filter((show) => show.rating && show.rating.average)
      .sort((a, b) => b.rating.average - a.rating.average)
      .slice(0, 24)
      .map(tvToItem);
  }

  // Returns the same "details" shape for movies and TV shows (see renderDetails).
  async function getTvDetails(id) {
    const show = await fetchJSON(`${TVMAZE_BASE}/shows/${id}`);
    if (!show || !show.id) throw new SyntaxError("Show response was invalid");

    const item = tvToItem(show);
    const days = show.schedule && show.schedule.days ? show.schedule.days : [];
    const schedule = days.length ? `${days.join(", ")}${show.schedule.time ? ` at ${show.schedule.time}` : ""}` : null;

    return {
      item,
      poster: show.image ? toHttps(show.image.original || show.image.medium) : null,
      summary: stripHtml(show.summary),
      website: show.officialSite,
      facts: [
        ["Rating", formatRating(item.rating)],
        ["Genres", formatGenres(item.genres)],
        ["Language", show.language || "Unknown"],
        ["Premiered", show.premiered || "Unknown"],
        ["Status", show.status || "Unknown"],
        ...(schedule ? [["Schedule", schedule]] : []),
      ],
    };
  }

  async function getEpisodes(id) {
    const episodes = await fetchJSON(`${TVMAZE_BASE}/shows/${id}/episodes`);
    if (!Array.isArray(episodes)) throw new SyntaxError("Episode response was not a list");
    return episodes;
  }

  /* ----- Movies: TMDB (free API key required) ----- */
  // Builds a TMDB URL. Without a key we stop early with a clear, friendly error.
  function tmdbUrl(path, params = {}) {
    if (!TMDB_API_KEY) {
      const error = new Error("Missing TMDB API key");
      error.code = "NO_KEY";
      throw error;
    }
    const query = new URLSearchParams({ api_key: TMDB_API_KEY, ...params });
    return `${TMDB_BASE}${path}?${query}`;
  }

  // TMDB lists give genre ids (like 28), so load the id -> name table once.
  async function loadMovieGenres() {
    if (state.genreNames.size > 0) return;
    const data = await fetchJSON(tmdbUrl("/genre/movie/list"));
    if (!data || !Array.isArray(data.genres)) throw new SyntaxError("Genre list was invalid");
    data.genres.forEach((genre) => state.genreNames.set(genre.id, genre.name));
  }

  async function fetchMovieList(path, params) {
    await loadMovieGenres();
    const data = await fetchJSON(tmdbUrl(path, params));
    if (!data || !Array.isArray(data.results)) throw new SyntaxError("Movie list was invalid");
    return data.results.filter((movie) => movie && movie.id).map(movieToItem);
  }

  const searchMovies = (query) => fetchMovieList("/search/movie", { query, include_adult: "false" });
  const getTrendingMovies = () => fetchMovieList("/trending/movie/week");

  async function getMovieDetails(id) {
    const movie = await fetchJSON(tmdbUrl(`/movie/${id}`));
    if (!movie || !movie.id) throw new SyntaxError("Movie response was invalid");

    const genres = Array.isArray(movie.genres) ? movie.genres.map((genre) => genre.name) : [];
    const item = makeItem(
      "movie", movie.id, movie.title || "Untitled movie",
      movie.poster_path ? `${TMDB_IMAGE}w342${movie.poster_path}` : null,
      movie.vote_average, genres,
      movie.release_date ? movie.release_date.slice(0, 4) : null
    );

    return {
      item,
      poster: movie.poster_path ? `${TMDB_IMAGE}w500${movie.poster_path}` : null,
      summary: movie.overview || "No description available.",
      website: movie.homepage,
      facts: [
        ["Rating", formatRating(item.rating)],
        ["Genres", formatGenres(genres)],
        ["Release date", movie.release_date || "Unknown"],
        ["Runtime", movie.runtime ? `${movie.runtime} min` : "Unknown"],
        ["Status", movie.status || "Unknown"],
      ],
    };
  }

  // Pick the right function for the content type.
  const searchByType = { movie: searchMovies, tv: searchTvShows };
  const defaultListByType = { movie: getTrendingMovies, tv: getTopTvShows };
  const detailsByType = { movie: getMovieDetails, tv: getTvDetails };

  /* ==========================================================
     4. STATUS MESSAGES (loading / error / empty)
     ========================================================== */
  // onRetry is optional: when given, an error shows a "Try again" button.
  function showStatus(box, type, message, onRetry) {
    box.classList.add("status");                        // keep other classes such as browse-status
    box.classList.toggle("error", type === "error");
    box.innerHTML = "";
    if (type === "loading") {
      const spinner = document.createElement("div");
      spinner.classList.add("spinner");
      box.appendChild(spinner);
    }
    const text = document.createElement("p");
    text.textContent = message;
    box.appendChild(text);

    if (type === "error" && onRetry) {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.classList.add("btn", "btn-ghost", "btn-small");
      retryBtn.textContent = "Try again";
      retryBtn.addEventListener("click", onRetry);
      box.appendChild(retryBtn);
    }
  }

  // Same as showStatus("error"), but a missing API key gets no "Try again" button.
  function showError(box, error, subject, onRetry) {
    showStatus(box, "error", describeError(error, subject), error.code === "NO_KEY" ? undefined : onRetry);
    console.error(error);
  }

  function clearStatus(box) {
    box.innerHTML = "";
  }

  /* ==========================================================
     5. WATCHLIST (Local Storage) - movies and TV shows together
     ========================================================== */
  // Rebuild one saved entry safely. Entries from the old TV-only version
  // (no "type", "name" instead of "title") become TV items.
  function cleanSavedItem(raw) {
    if (!raw || !Number.isInteger(raw.id)) return null;
    const type = raw.type === "movie" ? "movie" : "tv";
    const title = raw.title || raw.name;
    if (typeof title !== "string" || !title) return null;
    return makeItem(type, raw.id, title, raw.image, raw.rating, raw.genres, raw.year);
  }

  function loadWatchlist() {
    try {
      // Use the new key; if it does not exist yet, read the old favorites once.
      const saved = JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? localStorage.getItem(OLD_FAVORITES_KEY));
      state.watchlist = Array.isArray(saved)
        ? saved
            .map(cleanSavedItem)
            .filter(Boolean)                                                              // drop damaged entries
            .filter((item, index, list) => list.findIndex((other) => other.key === item.key) === index)   // drop duplicates
        : [];
    } catch (error) {
      state.watchlist = [];             // storage blocked or data corrupted: start fresh
    }
  }

  // Returns true when the data was saved, false when the browser refused.
  function saveWatchlist() {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(state.watchlist));
      return true;
    } catch (error) {
      console.error("Could not save the watchlist:", error);
      return false;
    }
  }

  const isSaved = (key) => state.watchlist.some((item) => item.key === key);

  function toggleWatchlist(item) {
    const existing = state.watchlist.find((saved) => saved.key === item.key);   // find() prevents duplicates
    if (existing) {
      state.watchlist = state.watchlist.filter((saved) => saved.key !== item.key);
    } else {
      // Save only the fields we need (not extras like the banner image).
      state.watchlist.push(makeItem(item.type, item.id, item.title, item.image, item.rating, item.genres, item.year));
    }
    if (!saveWatchlist()) {
      showToast("Your browser blocked saving. This change will be lost when you close the page.");
    }
    updateWatchlistUI();
  }

  // One place that updates every watchlist button on the page.
  function syncWatchlistButtons() {
    document.querySelectorAll("[data-key]").forEach((button) => {
      const active = isSaved(button.dataset.key);
      const title = button.dataset.title;
      button.classList.toggle("is-favorite", active);
      button.textContent = active ? "Remove from watchlist" : "Add to watchlist";
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute("aria-label", `${active ? "Remove" : "Add"} ${title} ${active ? "from" : "to"} watchlist`);
    });
  }

  // Keep the badge, all buttons and the watchlist page in sync with the data.
  function updateWatchlistUI() {
    watchCount.textContent = state.watchlist.length;
    syncWatchlistButtons();
    renderWatchlist();
  }

  function renderWatchlist() {
    const type = watchlistFilter.value;
    const items = state.watchlist.filter((item) => type === "all" || item.type === type);

    if (items.length === 0) {
      watchlistGrid.innerHTML = "";
      showStatus(
        watchlistStatus, "empty",
        state.watchlist.length === 0
          ? "Your watchlist is empty. Add movies and TV shows and they will appear here."
          : "Nothing saved in this category yet."
      );
      return;
    }
    clearStatus(watchlistStatus);
    renderCards(watchlistGrid, items);
  }

  /* ==========================================================
     6. RENDERING CARDS
     ========================================================== */
  function createPlaceholder(title) {
    const placeholder = document.createElement("div");
    placeholder.classList.add("poster", "poster-missing");
    placeholder.setAttribute("role", "img");
    placeholder.setAttribute("aria-label", `No poster available for ${title}`);
    placeholder.textContent = "No poster";
    return placeholder;
  }

  // A poster image, or the placeholder when the URL is missing or broken.
  function createPoster(url, title) {
    if (!url) return createPlaceholder(title);
    const image = document.createElement("img");
    image.src = url;
    image.alt = `Poster for ${title}`;
    image.loading = "lazy";
    image.classList.add("poster");
    image.addEventListener("error", () => image.replaceWith(createPlaceholder(title)), { once: true });
    return image;
  }

  function createWatchlistButton(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("btn", "btn-fav", "btn-small");
    button.dataset.key = item.key;
    button.dataset.title = item.title;
    button.addEventListener("click", () => toggleWatchlist(item));
    return button;
  }

  function createCard(item) {
    const card = document.createElement("article");
    card.classList.add("card");

    // Poster with a badge that says whether this is a movie or a TV show.
    const posterWrap = document.createElement("div");
    posterWrap.classList.add("poster-wrap");
    const badge = document.createElement("span");
    badge.classList.add("type-badge", item.type);
    badge.textContent = TYPE_LABEL[item.type];
    posterWrap.append(createPoster(item.image, item.title), badge);

    const body = document.createElement("div");
    body.classList.add("card-body");

    const title = document.createElement("h3");
    title.classList.add("card-title");
    title.textContent = item.title;

    const meta = document.createElement("p");
    meta.classList.add("card-meta");
    meta.textContent = `Rating: ${formatRating(item.rating)} | ${item.year}`;

    const genres = document.createElement("p");
    genres.classList.add("card-genres");
    genres.textContent = item.genres.length ? item.genres.join(", ") : "No genre listed";

    const actions = document.createElement("div");
    actions.classList.add("card-actions");

    const detailsBtn = document.createElement("button");
    detailsBtn.type = "button";
    detailsBtn.classList.add("btn", "btn-primary", "btn-small");
    detailsBtn.textContent = "View Details";
    detailsBtn.setAttribute("aria-label", `View details for ${item.title}`);
    detailsBtn.addEventListener("click", () => openDetails(item));

    actions.append(createWatchlistButton(item), detailsBtn);
    body.append(title, meta, genres, actions);
    card.append(posterWrap, body);
    return card;
  }

  // Build one card per item and add them all to the container.
  function renderCards(container, items) {
    container.innerHTML = "";
    items.forEach((item) => container.appendChild(createCard(item)));
    syncWatchlistButtons();
  }

  /* ==========================================================
     7. MOVIES AND TV SHOWS PAGES: load, search, filter, sort
     ========================================================== */
  // Loads the default list (no query) or search results (with a query) for one type.
  async function loadBrowse(type, query = "") {
    const browse = state.browse[type];
    const ui = browseUI[type];
    const requestId = ++browse.requestId;                // identifies THIS request

    ui.grid.innerHTML = "";
    ui.count.textContent = "";
    ui.searchBtn.disabled = true;
    showStatus(ui.status, "loading", query ? `Searching for "${query}"...` : "Loading...");

    try {
      const items = query ? await searchByType[type](query) : await defaultListByType[type]();
      if (requestId !== browse.requestId) return;        // a newer request replaced this one

      browse.items = items;
      browse.loaded = true;
      ui.heading.textContent = query ? `Results for "${query}"` : DEFAULT_HEADING[type];
      ui.genre.value = "all";
      ui.sort.value = "default";
      fillGenreFilter(type);

      if (items.length === 0) {
        showStatus(ui.status, "empty", query ? `No titles found for "${query}". Try a different search.` : "Nothing to show right now.");
        return;
      }
      clearStatus(ui.status);
      renderBrowse(type);
    } catch (error) {
      if (requestId !== browse.requestId) return;
      showError(ui.status, error, type === "movie" ? "movies" : "TV shows", () => loadBrowse(type, query));
    } finally {
      if (requestId === browse.requestId) ui.searchBtn.disabled = false;
    }
  }

  function handleSearch(type) {
    const ui = browseUI[type];
    const query = ui.input.value.trim();
    if (!query) {                                        // prevent empty searches
      showStatus(ui.status, "error", "Type a title to start searching.");
      ui.input.focus();
      return;
    }
    loadBrowse(type, query);
  }

  // Build the genre dropdown from the genres that appear in the current list.
  function fillGenreFilter(type) {
    const ui = browseUI[type];
    const allGenres = [...new Set(state.browse[type].items.flatMap((item) => item.genres))].sort();
    ui.genre.innerHTML = '<option value="all">All genres</option>';
    allGenres.forEach((genre) => {
      const option = document.createElement("option");
      option.value = genre;
      option.textContent = genre;
      ui.genre.appendChild(option);
    });
  }

  // Apply the current genre filter and sort order, then draw the cards.
  function renderBrowse(type) {
    const ui = browseUI[type];
    const allItems = state.browse[type].items;
    let items = allItems.filter((item) => ui.genre.value === "all" || item.genres.includes(ui.genre.value));

    if (ui.sort.value === "rating") {
      items = [...items].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }

    ui.count.textContent = `${items.length} of ${allItems.length} titles`;
    if (items.length === 0) {
      ui.grid.innerHTML = "";
      showStatus(ui.status, "empty", "Nothing matches this genre.");
      return;
    }
    clearStatus(ui.status);
    renderCards(ui.grid, items);
  }

  function clearSearch(type) {
    browseUI[type].input.value = "";
    loadBrowse(type);                                    // go back to the default list
    browseUI[type].input.focus();
  }

  /* ==========================================================
     8. HOME PAGE: hero search, featured movie, trending rows
     ========================================================== */
  // The hero search jumps to the Movies or TV Shows page and runs the search there.
  function handleHeroSearch() {
    const query = heroSearchInput.value.trim();
    if (!query) {
      showStatus(heroStatus, "error", "Type a title to start searching.");
      heroSearchInput.focus();
      return;
    }
    clearStatus(heroStatus);
    const type = heroType.value;
    browseUI[type].input.value = query;
    showView(VIEW_FOR_TYPE[type], { skipDefaultLoad: true });
    loadBrowse(type, query);
  }

  async function loadHomeRow(type) {
    const row = homeRows[type];
    showStatus(row.status, "loading", "Loading...");
    try {
      const items = await defaultListByType[type]();
      clearStatus(row.status);
      renderCards(row.grid, items.slice(0, 12));
      if (type === "movie") showFeatured(items.find((item) => item.backdrop));
    } catch (error) {
      showError(row.status, error, type === "movie" ? "trending movies" : "TV shows", () => loadHomeRow(type));
    }
  }

  // Use the top trending movie's artwork as the hero background.
  function showFeatured(movie) {
    if (!movie) return;
    hero.style.backgroundImage = `linear-gradient(rgba(14, 18, 38, 0.6), #0e1226), url("${movie.backdrop}")`;

    const label = document.createElement("span");
    label.textContent = "Featured movie:";
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("btn", "btn-ghost", "btn-small");
    button.textContent = movie.title;
    button.setAttribute("aria-label", `View details for featured movie ${movie.title}`);
    button.addEventListener("click", () => openDetails(movie));
    featured.innerHTML = "";
    featured.append(label, button);
  }

  /* ==========================================================
     9. DETAILS MODAL
     ========================================================== */
  function openDetails(item) {
    lastFocusedElement = document.activeElement;      // so focus can return here later

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");        // stops the page scrolling behind
    pageRegions.forEach((region) => { region.inert = true; });
    modalClose.focus();

    renderDetails(item);
  }

  async function renderDetails(item) {
    const requestId = ++detailsRequestId;
    showStatus(modalBody, "loading", `Loading details for ${item.title}...`);

    try {
      const details = await detailsByType[item.type](item.id);   // same call for movies and TV shows
      if (requestId !== detailsRequestId) return;                 // modal was closed or reopened meanwhile

      const full = details.item;
      const factsHtml = details.facts
        .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
        .join("");

      modalBody.innerHTML = `
        <div class="details">
          <div id="modal-poster"></div>
          <div>
            <p class="type-tag">${TYPE_LABEL[full.type]}</p>
            <h2 id="modal-title">${escapeHtml(full.title)}</h2>
            <dl class="facts">${factsHtml}<dt>Website</dt><dd id="modal-website">Not available</dd></dl>
            <p class="summary">${escapeHtml(details.summary)}</p>
            <div id="modal-watch"></div>
          </div>
        </div>
        ${full.type === "tv" ? EPISODES_HTML : ""}`;

      // Poster and link are built with DOM methods (not innerHTML) so URLs are handled safely.
      modalBody.querySelector("#modal-poster").appendChild(createPoster(details.poster, full.title));

      if (isSafeUrl(details.website)) {
        const link = document.createElement("a");
        link.href = details.website;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "Visit official site";
        const websiteCell = modalBody.querySelector("#modal-website");
        websiteCell.textContent = "";
        websiteCell.appendChild(link);
      }

      modalBody.querySelector("#modal-watch").appendChild(createWatchlistButton(full));
      syncWatchlistButtons();
      if (full.type === "tv") loadEpisodes(full.id, requestId);   // only TV shows have episodes
    } catch (error) {
      if (requestId !== detailsRequestId) return;
      showError(modalBody, error, "this title", () => renderDetails(item));
    }
  }

  async function loadEpisodes(id, requestId) {
    const status = modalBody.querySelector("#episode-status");
    const list = modalBody.querySelector("#episode-list");
    const seasonSelect = modalBody.querySelector("#season-select");
    showStatus(status, "loading", "Loading episodes...");

    try {
      const episodes = await getEpisodes(id);
      if (requestId !== detailsRequestId) return;

      if (episodes.length === 0) {
        seasonSelect.parentElement.hidden = true;
        showStatus(status, "empty", "No episode information available.");
        return;
      }
      clearStatus(status);

      const seasons = [...new Set(episodes.map((ep) => ep.season))];
      seasons.forEach((season) => {
        const option = document.createElement("option");
        option.value = season;
        option.textContent = `Season ${season}`;
        seasonSelect.appendChild(option);
      });

      // Show only the chosen season's episodes.
      const drawSeason = () => {
        list.innerHTML = "";
        episodes
          .filter((ep) => ep.season === Number(seasonSelect.value))
          .forEach((ep) => {
            const item = document.createElement("li");
            const name = document.createElement("span");
            name.textContent = `${ep.number ?? "Special"}. ${ep.name || "Untitled episode"}`;
            const air = document.createElement("span");
            air.classList.add("air");
            air.textContent = ep.airdate || "TBA";
            item.append(name, air);
            list.appendChild(item);
          });
      };
      seasonSelect.addEventListener("change", drawSeason);   // new select each time, so no duplicate listeners
      drawSeason();
    } catch (error) {
      if (requestId !== detailsRequestId) return;
      seasonSelect.parentElement.hidden = true;
      showError(status, error, "episodes", () => {
        seasonSelect.parentElement.hidden = false;
        loadEpisodes(id, requestId);
      });
    }
  }

  function closeDetails() {
    detailsRequestId++;                               // ignore any request still loading
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    pageRegions.forEach((region) => { region.inert = false; });
    modalBody.innerHTML = "";

    // Return focus to the button that opened the modal (if it still exists).
    if (lastFocusedElement && lastFocusedElement.isConnected) lastFocusedElement.focus();
    lastFocusedElement = null;
  }

  // Keep Tab / Shift+Tab inside the modal while it is open.
  function trapFocus(event) {
    const focusable = [...modal.querySelectorAll("a[href], button:not([disabled]), select")];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ==========================================================
     10. NAVIGATION (switching between pages)
     ========================================================== */
  function closeMenu() {
    navLinks.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  }

  function showView(name, { skipDefaultLoad = false } = {}) {
    document.querySelectorAll(".view").forEach((view) => {
      view.classList.toggle("hidden", view.id !== `view-${name}`);
    });
    document.querySelectorAll(".nav-links a").forEach((link) => {
      const isCurrent = link.dataset.view === name;
      link.classList.toggle("active", isCurrent);
      if (isCurrent) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    closeMenu();
    window.scrollTo(0, 0);

    // The first visit to Movies or TV Shows loads its default list.
    const type = Object.keys(VIEW_FOR_TYPE).find((key) => VIEW_FOR_TYPE[key] === name);
    if (type && !state.browse[type].loaded && !skipDefaultLoad) loadBrowse(type);
    if (name === "watchlist") renderWatchlist();
  }

  /* ==========================================================
     11. EVENT LISTENERS (each one is attached once, at start-up)
     ========================================================== */
  heroSearchBtn.addEventListener("click", handleHeroSearch);
  heroSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleHeroSearch();
  });

  // Movies and TV Shows pages have identical controls, so wire both in a loop.
  Object.keys(browseUI).forEach((type) => {
    const ui = browseUI[type];
    ui.searchBtn.addEventListener("click", () => handleSearch(type));
    ui.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") handleSearch(type);
    });
    ui.clearBtn.addEventListener("click", () => clearSearch(type));
    ui.genre.addEventListener("change", () => renderBrowse(type));
    ui.sort.addEventListener("change", () => renderBrowse(type));
  });

  watchlistFilter.addEventListener("change", renderWatchlist);

  // Every element with data-view is a navigation link (navbar + logo).
  document.querySelectorAll("[data-view]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showView(link.dataset.view);
    });
  });

  // About page: links still marked data-placeholder have no real URL yet.
  // They show a short message instead of opening a broken address.
  document.querySelectorAll("[data-placeholder]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (link.getAttribute("href") !== "#") return;      // a real URL was added, let it open
      event.preventDefault();
      showToast(`${link.dataset.placeholder} link has not been added yet.`);
    });
  });

  menuToggle.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });

  modalClose.addEventListener("click", closeDetails);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeDetails();      // click on the dark backdrop
  });

  // One keyboard listener handles Escape and the modal focus trap.
  document.addEventListener("keydown", (event) => {
    const modalIsOpen = !modal.classList.contains("hidden");
    if (event.key === "Escape") {
      if (modalIsOpen) closeDetails();
      else closeMenu();
    } else if (event.key === "Tab" && modalIsOpen) {
      trapFocus(event);
    }
  });

  // If the watchlist changes in another browser tab, update this tab too.
  window.addEventListener("storage", (event) => {
    if (event.key === WATCHLIST_KEY) {
      loadWatchlist();
      updateWatchlistUI();
    }
  });

  /* ==========================================================
     12. START THE APP
     ========================================================== */
  function init() {
    loadWatchlist();          // read the saved watchlist from Local Storage
    updateWatchlistUI();      // show badge count + watchlist page
    loadHomeRow("movie");     // trending movies (needs the TMDB key)
    loadHomeRow("tv");        // popular TV shows
  }
  init();
})();
