(() => {
  'use strict';

  // Use the same catalog endpoint as the native app. The catalogs mirror URL
  // previously used here is not an addon endpoint and returns 404.
  const CATALOG_API = 'https://v3-cinemeta.strem.io';
  const META_API = 'https://cinemeta-live.strem.io';
  const STORE_KEY = 'kinomeow.library.v1';
  const RU_CACHE_KEY = 'kinomeow.ru-meta.v1';
  const state = {
    tab: 'catalog', items: readItems(), catalog: [], offset: 0, loading: false,
    query: '', genre: '', minRating: '0', sort: 'popular', hideSaved: false,
    hideWatched: false, savedSort: 'recent', requestToken: 0, catalogError: ''
  };
  const $ = (s, root = document) => root.querySelector(s);
  const app = $('#app');
  const modalRoot = $('#modal-root');
  let toastTimer;
  const iconPaths = {
    bookmark: '<path d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21l-6-4-6 4z"/>',
    play: '<path d="m9 6 10 6-10 6z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
    chart: '<path d="M4 19V5m0 14h16M8 15v-4m4 4V7m4 8V9m4 6v-2"/>',
    sync: '<path d="M20 7h-5l2-2m-2 2 2 2M4 17h5l-2 2m2-2-2-2M5 7a7 7 0 0 1 12-1m2 11a7 7 0 0 1-12 1"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16m10-16v16M3 9h4m-4 6h4m10-6h4m-4 6h4"/>',
    star: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'
  };
  function icon(name, className = '') {
    return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${iconPaths[name] || iconPaths.film}</svg>`;
  }

  function readItems() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || '[]').map(raw => {
        const item=normalize(raw);
        // Older web builds stored bare IMDb IDs; native KINOmeow uses type:id.
        if (item.catalogID && !item.catalogID.includes(':') && !item.catalogID.startsWith('local-')) {
          item.catalogID = `${item.type || 'movie'}:${item.catalogID}`;
        }
        return item;
      });
    }
    catch { return []; }
  }
  function persist() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.items));
    render();
  }
  function toast(message) {
    const box = $('#toast'); box.textContent = message; box.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => box.classList.add('hidden'), 3200);
  }
  function esc(s = '') {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }
  function imageURL(url, width = 520) {
    if (!url) return '';
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${width}&h=${Math.round(width * 1.5)}&fit=cover&output=webp`;
  }
  function titleOf(movie) { return movie.title || movie.name || 'Без названия'; }
  function normalize(meta) {
    const type = meta.type || 'movie';
    const rawID = meta.catalogID || meta.id || `local-${crypto.randomUUID()}`;
    const catalogID = rawID.includes(':') || rawID.startsWith('local-') ? rawID : `${type}:${rawID}`;
    const personal=Number(meta.personalRating||meta.vaniRating||0), dasha=Number(meta.dashaRating||0);
    const personalDate=Date.parse(meta.personalRatingModifiedAt||meta.modifiedAt||meta.timestamp||'')||0;
    const dashaDate=Date.parse(meta.dashaRatingModifiedAt||meta.modifiedAt||meta.timestamp||'')||0;
    const rating=Object.prototype.hasOwnProperty.call(meta,'rating')?Number(meta.rating||0):(dashaDate>personalDate&&dasha?dasha:personal||dasha);
    const ratingModifiedAt=meta.ratingModifiedAt||((dashaDate>personalDate&&dasha)?meta.dashaRatingModifiedAt:meta.personalRatingModifiedAt)||meta.modifiedAt||meta.timestamp||null;
    return {
      id: meta.id || catalogID.split(':').at(-1), catalogID,
      type, title: titleOf(meta), originalTitle: meta.originalTitle || '',
      descriptionText: meta.descriptionText || meta.description || '', imageURL: meta.imageURL || meta.poster || '',
      year: meta.year || meta.releaseInfo || '', imdbRating: Number(meta.imdbRating || 0),
      genres: Array.isArray(meta.genres) ? meta.genres : [], imdbID: meta.imdbID || '',
      kinopoiskID: meta.kinopoiskID || '', videos: Array.isArray(meta.videos) ? meta.videos : [],
      rating, ratingModifiedAt,
      personalRating: rating, personalRatingModifiedAt: ratingModifiedAt,
      dashaRating: 0, dashaRatingModifiedAt: null,
      status: meta.status || (meta.isWatching ? 'watching' : meta.isWatchLater === true ? 'later' : (rating ? 'watched' : 'later')),
      currentSeason: Number(meta.currentSeason || 0), currentEpisode: Number(meta.currentEpisode || 0),
      currentHour: Number(meta.currentHour || 0), currentMinute: Number(meta.currentMinute || 0),
      currentSecond: Number(meta.currentSecond || 0), modifiedAt: meta.modifiedAt || meta.timestamp || new Date().toISOString(),
      timestamp: meta.timestamp || meta.modifiedAt || new Date().toISOString(), deletedAt: meta.deletedAt || null
    };
  }
  function ratingTime(item,key) {
    const explicit=item[`${key}ModifiedAt`];
    if(explicit) return Date.parse(explicit)||0;
    return Number(item[key]||0)>0 ? Date.parse(item.modifiedAt||item.timestamp||'')||0 : 0;
  }
  function mergeLibraryItem(local,incoming) {
    const localChange=Date.parse(local.modifiedAt||local.timestamp||'')||0;
    const incomingChange=Date.parse(incoming.modifiedAt||incoming.timestamp||'')||0;
    const merged=incomingChange>=localChange?{...local,...incoming}:{...incoming,...local};
    const localTime=ratingTime(local,'personalRating'), incomingTime=ratingTime(incoming,'personalRating');
    const source=incomingTime>=localTime?incoming:local;
    merged.rating=Number(source.personalRating||0); merged.ratingModifiedAt=source.personalRatingModifiedAt||source.modifiedAt||source.timestamp||null;
    merged.personalRating=merged.rating; merged.personalRatingModifiedAt=merged.ratingModifiedAt; merged.dashaRating=0; merged.dashaRatingModifiedAt=null;
    return merged;
  }
  function isSaved(id) { return state.items.some(x => x.catalogID === id && !x.deletedAt); }
  function itemByID(id) { return state.items.find(x => x.catalogID === id && !x.deletedAt); }
  function upsert(movie, patch = {}) {
    const normalized = normalize(movie), oldIndex = state.items.findIndex(x => x.catalogID === normalized.catalogID);
    const old = oldIndex >= 0 ? state.items[oldIndex] : {};
    const item = { ...old, ...normalized, ...patch, modifiedAt: new Date().toISOString(), timestamp: new Date().toISOString(), deletedAt: null };
    if (oldIndex >= 0) state.items.splice(oldIndex, 1, item); else state.items.unshift(item);
    persist();
    return item;
  }
  function setRating(id, value) {
    const item = itemByID(id); if (!item) return;
    item.rating = Number(value); item.ratingModifiedAt = new Date().toISOString(); item.personalRating=item.rating; item.personalRatingModifiedAt=item.ratingModifiedAt; item.dashaRating=0; item.dashaRatingModifiedAt=null; item.modifiedAt = new Date().toISOString(); item.timestamp = item.modifiedAt;
    persist();
  }
  function localize(meta) {
    const type = meta.type || 'movie';
    const id = meta.id || meta.imdb_id || '';
    return { ...meta, id, catalogID: meta.catalogID || `${type}:${id}`, type, title: meta.name || meta.title || '', descriptionText: meta.description || '',
      imageURL: meta.poster || '', year: meta.releaseInfo || '', imdbRating: Number(meta.imdbRating || 0),
      genres: meta.genres || [], imdbID: meta.imdb_id || meta.imdbID || '', videos: meta.videos || [] };
  }
  async function enrichRussian(movies) {
    const cache = JSON.parse(localStorage.getItem(RU_CACHE_KEY) || '{}');
    const ids = [...new Set(movies.map(m => m.imdbID).filter(id => /^tt\d+$/.test(id)))];
    const missing = ids.filter(id => !(id in cache));
    for (let i=0; i<missing.length; i+=30) {
      const batch=missing.slice(i,i+30);
      const values=batch.map(id=>`"${id}"`).join(' ');
      const query=`SELECT ?imdbId ?title ?description ?pageTitle ?kinopoiskID WHERE { VALUES ?imdbId { ${values} } ?entity wdt:P345 ?imdbId . OPTIONAL { ?entity rdfs:label ?title FILTER(lang(?title) = 'ru') } OPTIONAL { ?entity schema:description ?description FILTER(lang(?description) = 'ru') } OPTIONAL { ?article schema:about ?entity ; schema:isPartOf <https://ru.wikipedia.org/> ; schema:name ?pageTitle . } OPTIONAL { ?entity wdt:P2603 ?kinopoiskID . } }`;
      try {
        const url=`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
        const data=await fetchJSON(url);
        for(const row of data.results?.bindings||[]) {
          const id=row.imdbId?.value;
          if(id) cache[id]={title:row.title?.value||row.pageTitle?.value||'',description:row.description?.value||'',kinopoiskID:row.kinopoiskID?.value||''};
        }
        batch.forEach(id=>{if(!(id in cache))cache[id]={};});
      } catch (err) { console.warn('Русские метаданные пока недоступны',err); break; }
    }
    try { localStorage.setItem(RU_CACHE_KEY,JSON.stringify(cache)); } catch {}
    let changed=false;
    for(const movie of movies) {
      const ru=cache[movie.imdbID];
      if(ru) {
        if(ru.title && movie.title!==ru.title){movie.originalTitle=movie.title;movie.title=ru.title;changed=true;}
        if(ru.description && !movie.descriptionText){movie.descriptionText=ru.description;changed=true;}
        if(ru.kinopoiskID && !movie.kinopoiskID){movie.kinopoiskID=ru.kinopoiskID;changed=true;}
      }
    }
    if(changed && state.tab==='catalog') renderCatalog();
  }
  function ratingText(n) { return n ? `★ ${n}/10` : '—'; }
  function progressText(item) {
    if (item.type === 'series') return item.currentSeason || item.currentEpisode ? `Сезон ${item.currentSeason || 1}, серия ${item.currentEpisode || 1}` : '';
    const seconds = (item.currentHour || 0) * 3600 + (item.currentMinute || 0) * 60 + (item.currentSecond || 0);
    return seconds ? `Остановился на ${String(item.currentHour || 0).padStart(2,'0')}:${String(item.currentMinute || 0).padStart(2,'0')}:${String(item.currentSecond || 0).padStart(2,'0')}` : '';
  }
  function card(movie, editable = false) {
    const item = itemByID(movie.catalogID) || movie;
    const img = imageURL(movie.imageURL);
    const year = movie.year ? `<span>${esc(movie.year)}</span>` : '';
    const genres = (movie.genres || []).slice(0,2).map(esc).join(' · ');
    const progress = progressText(item);
    return `<article class="movie-card">
      <button class="poster-button" data-detail="${esc(movie.catalogID)}" aria-label="Открыть ${esc(titleOf(movie))}">${img ? `<img class="poster" src="${esc(img)}" alt="Постер: ${esc(titleOf(movie))}" loading="lazy" decoding="async">` : `<span class="poster-placeholder">${icon('film')}</span>`}</button>
      <button class="poster-button" data-detail="${esc(movie.catalogID)}"><h2 class="movie-title">${esc(titleOf(movie))}</h2></button>
      <div class="movie-meta">${year}${movie.imdbRating ? `<span class="star">★ ${esc(movie.imdbRating)}</span>` : ''}${genres ? `<span>${genres}</span>` : ''}</div>
      ${movie.descriptionText ? `<p class="description-snippet">${esc(movie.descriptionText)}</p>` : ''}
      ${editable ? `<div class="card-actions"><button class="button secondary rating-open" data-rating-dialog="${esc(movie.catalogID)}">${icon('star','star-icon')} Оценка ${ratingText(item.rating ?? item.personalRating)}</button></div>
      <div class="progress-note">${esc(progress || (movie.status === 'later' ? 'В списке «Посмотреть позже»' : ''))}</div>
      <button class="remove-button" data-remove="${esc(movie.catalogID)}" aria-label="Убрать из списка">${icon('close')}</button>` : ''}
    </article>`;
  }
  function ratingOptions(selected) {
    return `<option value="0" ${Number(selected)===0?'selected':''}>Без оценки</option>${Array.from({length:10}, (_,i) => `<option value="${i+1}" ${Number(selected) === i+1 ? 'selected' : ''}>★ ${i+1}/10</option>`).join('')}`;
  }
  function openRatingDialog(id) {
    const item=itemByID(id); if(!item)return;
    modalRoot.innerHTML=`<div class="modal-backdrop rating-backdrop"><section class="modal rating-modal" role="dialog" aria-modal="true" aria-label="Оценка"><button class="modal-close" aria-label="Закрыть">${icon('close')}</button><h2>Оценка фильма</h2><div class="field"><label>${icon('star','star-icon')} Моя оценка</label><select id="rating-value" class="rating-select">${ratingOptions(item.rating ?? item.personalRating)}</select></div><button class="button primary" id="rating-save">Сохранить</button></section></div>`;
    const close=()=>{modalRoot.innerHTML='';document.onkeydown=null;};
    $('.modal-close',modalRoot).onclick=close;
    $('.rating-backdrop',modalRoot).addEventListener('click',e=>{if(e.target.classList.contains('rating-backdrop'))close();});
    $('#rating-save',modalRoot).onclick=()=>{setRating(id,$('#rating-value',modalRoot).value);close();};
    document.onkeydown=e=>{if(e.key==='Escape')close();};
  }
  function heading(title, subtitle = '') {
    return `<div class="page-heading"><h1>${title}</h1>${subtitle ? `<div class="subtle">${subtitle}</div>` : ''}</div>`;
  }
  function render() {
    document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
    if (state.tab === 'catalog') return renderCatalog();
    if (state.tab === 'stats') return renderStats();
    const status = state.tab;
    let items = state.items.filter(x => !x.deletedAt && x.status === status);
    if (status === 'watched') items = sortWatched(items);
    const title = status === 'later' ? 'Посмотреть позже' : status === 'watching' ? 'Ещё смотрим' : 'Просмотрено';
    app.innerHTML = `${heading(title, `${items.length} ${plural(items.length, 'фильм', 'фильма', 'фильмов')}`)}
      ${status === 'watched' ? `<div class="search-row"><select id="saved-sort" class="filter-select"><option value="recent" ${state.savedSort==='recent'?'selected':''}>Сначала новые</option><option value="rating" ${state.savedSort==='rating'?'selected':''}>Сначала высокая оценка</option></select></div>` : ''}
      ${items.length ? `<section class="grid">${items.map(x => card(x,true)).join('')}</section>` : `<div class="empty">Пока здесь пусто. Найди фильм в каталоге и открой его карточку.<br><br><button class="button primary" data-open-catalog>Открыть каталог</button></div>`}`;
    $('#saved-sort')?.addEventListener('change', e => { state.savedSort = e.target.value; render(); });
  }
  function plural(n, one, few, many) { const x = Math.abs(n)%100, y=x%10; return x>10&&x<20?many:y>1&&y<5?few:y===1?one:many; }
  function sortWatched(items) {
    if (state.savedSort === 'rating') return items.sort((a,b) => Number(b.rating||b.personalRating||0)-Number(a.rating||a.personalRating||0) || titleOf(a).localeCompare(titleOf(b),'ru'));
    return items.sort((a,b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
  }
  function renderStats() {
    const active = state.items.filter(x => !x.deletedAt);
    const scores=active.map(x=>Number(x.rating||x.personalRating||0)).filter(Number);
    const average=scores.length?(scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1):'—';
    app.innerHTML = `${heading('Статистика','Ваша общая киноколлекция')}<div class="stats-grid">
      ${stat(active.filter(x=>x.status==='watched').length,'Просмотрено')}${stat(active.filter(x=>x.status==='later').length,'Посмотреть позже')}${stat(active.filter(x=>x.status==='watching').length,'Сейчас смотрим')}${stat(average,'Средняя оценка')}</div>`;
  }
  function stat(value,label) { return `<div class="stat"><strong>${esc(value)}</strong><label>${esc(label)}</label></div>`; }
  function renderCatalog() {
    const genres = [...new Set(state.catalog.flatMap(x=>x.genres||[]))].sort((a,b)=>a.localeCompare(b,'ru'));
    let movies = state.catalog.filter(x => !state.genre || (x.genres||[]).includes(state.genre));
    if (state.minRating !== '0') movies = movies.filter(x => Number(x.imdbRating||0) >= Number(state.minRating));
    if (state.hideSaved) movies = movies.filter(x => !isSaved(x.catalogID));
    if (state.hideWatched) movies = movies.filter(x => itemByID(x.catalogID)?.status !== 'watched');
    if (state.sort === 'rating') movies.sort((a,b)=>Number(b.imdbRating||0)-Number(a.imdbRating||0));
    if (state.sort === 'new') movies.sort((a,b)=>String(b.year).localeCompare(String(a.year)));
    app.innerHTML = `${heading('Каталог','Ищи фильм или сериал и добавляй его в свои списки')}
      <form id="search-form" class="search-row"><input id="search-input" class="input" type="search" placeholder="Название, например Декстер" value="${esc(state.query)}"><button class="button primary" type="submit">Найти</button></form>
      <div class="filters"><select id="genre-filter" class="filter-select"><option value="">Все жанры</option>${genres.map(g=>`<option ${g===state.genre?'selected':''}>${esc(g)}</option>`).join('')}</select>
      <select id="rating-filter" class="filter-select"><option value="0">Любой рейтинг</option><option value="6" ${state.minRating==='6'?'selected':''}>IMDb от 6</option><option value="7" ${state.minRating==='7'?'selected':''}>IMDb от 7</option><option value="8" ${state.minRating==='8'?'selected':''}>IMDb от 8</option></select>
      <select id="sort-filter" class="filter-select"><option value="popular" ${state.sort==='popular'?'selected':''}>Популярные</option><option value="rating" ${state.sort==='rating'?'selected':''}>Высокий рейтинг</option><option value="new" ${state.sort==='new'?'selected':''}>Сначала новые</option></select>
      <button class="toggle-chip ${state.hideWatched?'active':''}" id="hide-watched">Скрыть просмотренные</button><button class="toggle-chip ${state.hideSaved?'active':''}" id="hide-saved">Скрыть добавленные</button></div>
      ${state.catalogError ? `<div class="notice">${esc(state.catalogError)}</div>` : ''}
      ${state.loading && !state.catalog.length ? `<div class="loading">Загружаю каталог…</div>` : movies.length ? `<section class="grid">${movies.map(x=>card(x,false)).join('')}</section>` : `<div class="empty">${state.loading?'Ищу…':'Ничего не найдено. Попробуй другое название или сбрось фильтры.'}</div>`}
      <div class="pagination">${state.query?(state.loading?`<span class="muted">Ищу…</span>`:`<span class="muted">Совпадений: ${state.catalog.length}</span>`):(state.loading&&state.catalog.length?`<span class="muted">Загружаю…</span>`:`<button id="load-more" class="button secondary">Загрузить ещё</button>`)}</div>`;
    $('#search-form').addEventListener('submit', e => { e.preventDefault(); state.query=$('#search-input').value.trim(); state.catalog=[]; state.offset=0; state.catalogError=''; loadCatalog(true); });
    $('#genre-filter').addEventListener('change', e=>{state.genre=e.target.value;render();});
    $('#rating-filter').addEventListener('change', e=>{state.minRating=e.target.value;render();});
    $('#sort-filter').addEventListener('change', e=>{state.sort=e.target.value;render();});
    $('#hide-watched').addEventListener('click', ()=>{state.hideWatched=!state.hideWatched;render();});
    $('#hide-saved').addEventListener('click', ()=>{state.hideSaved=!state.hideSaved;render();});
    $('#load-more')?.addEventListener('click', ()=>loadCatalog(false));
  }
  async function fetchJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {headers:{Accept:'application/json'}, signal:controller.signal});
      if (!response.ok) throw new Error(`Источник ответил кодом ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Источник не ответил за 12 секунд');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async function fetchCatalog(path, isSearch) {
    const payload = await fetchJSON(`${CATALOG_API}${path}`);
    if (!Array.isArray(payload.metas)) throw new Error('Источник вернул каталог в неизвестном формате');
    if (isSearch && !String(payload.query || '').trim()) throw new Error('Источник не выполнил поиск по названию');
    if (!isSearch && !path.includes('/skip=') && payload.metas.length === 0) throw new Error('Источник вернул пустую подборку');
    return payload;
  }
  async function loadCatalog(reset) {
    if(state.loading) return;
    state.loading=true; state.catalogError=''; renderCatalog();
    const token=++state.requestToken;
    try {
      const types=['movie','series'];
      const pageResults=await Promise.allSettled(types.map(type=>{
        let path;
        if(state.query) path=`/catalog/${type}/top/search=${encodeURIComponent(state.query)}.json`;
        else path=`/catalog/${type}/top${state.offset?`/skip=${state.offset}`:''}.json`;
        return fetchCatalog(path, Boolean(state.query));
      }));
      if(token!==state.requestToken)return;
      const pages=pageResults.filter(r=>r.status==='fulfilled').map(r=>r.value);
      const failures=pageResults.filter(r=>r.status==='rejected');
      if(!pages.length) throw failures[0]?.reason || new Error('Нет ответа от каталога');
      state.catalogError=failures.length ? 'Часть каталога временно не ответила; показываю те фильмы, которые удалось загрузить.' : '';
      const results=pages.flatMap(p=>p.metas||[]).map(localize).filter(x=>x.catalogID);
      const dedupe=new Map(); results.forEach(x=>dedupe.set(x.catalogID,x));
      const batch=[...dedupe.values()];
      if(state.query) {
        await enrichRussian(batch);
        if(!batch.some(x=>rankMovie(x,state.query)>=600)) {
          try {
            const fallback=await searchWikidata(state.query);
            const known=new Set(batch.map(x=>x.catalogID));
            batch.push(...fallback.filter(x=>!known.has(x.catalogID)));
          } catch(error) {
            if(!batch.length) state.catalogError=`Не удалось выполнить поиск по русскому названию (${error.message||'ошибка сети'}). Проверь подключение и попробуй ещё раз.`;
            console.warn('Резервный поиск по русским названиям недоступен',error);
          }
        }
        const q=state.query.toLocaleLowerCase('ru');
        batch.sort((a,b)=>rankMovie(b,q)-rankMovie(a,q)||Number(b.imdbRating||0)-Number(a.imdbRating||0));
      }
      const seen=new Set(state.catalog.map(x=>x.catalogID));
      const fresh=batch.filter(x=>!seen.has(x.catalogID));
      state.catalog.push(...fresh);
      if(state.query) state.catalog.sort((a,b)=>rankMovie(b,state.query)-rankMovie(a,state.query)||Number(b.imdbRating||0)-Number(a.imdbRating||0));
      if(!state.query) enrichRussian(batch).catch(console.warn);
      if(!state.query&&batch.length) state.offset+=20;
      if(reset) state.genre='';
    } catch(err) {
      state.catalogError=`Не удалось загрузить каталог (${err.message||'ошибка сети'}). Проверь подключение и попробуй ещё раз.`;
      console.error(err);
    } finally { if(token===state.requestToken){state.loading=false;renderCatalog();} }
  }
  function rankTitle(title,q) {
    const t=String(title||'').toLocaleLowerCase('ru').trim();
    if(t===q)return 1000;if(t.startsWith(q))return 800;if(t.includes(q))return 600;
    const words=q.split(/\s+/).filter(Boolean); return words.reduce((n,w)=>n+(t.includes(w)?50:0),0);
  }
  function rankMovie(movie, query) {
    const q=String(query||'').toLocaleLowerCase('ru').trim();
    return Math.max(rankTitle(movie.title,q),rankTitle(movie.originalTitle,q));
  }
  async function searchWikidata(query) {
    const term=JSON.stringify(String(query||'').trim());
    const sparql=`SELECT DISTINCT ?imdbID ?title ?description ?kinopoiskID ?type WHERE {
      ?item wdt:P345 ?imdbID.
      { { ?item wdt:P31/wdt:P279* wd:Q11424. BIND("movie" AS ?type) }
        UNION { ?item wdt:P31/wdt:P279* wd:Q5398426. BIND("series" AS ?type) } }
      { { ?item rdfs:label ?title. FILTER(LANG(?title)="ru") }
        UNION { ?item skos:altLabel ?title. FILTER(LANG(?title)="ru") } }
      FILTER(CONTAINS(LCASE(STR(?title)), LCASE(${term})))
      OPTIONAL { ?item schema:description ?description. FILTER(LANG(?description)="ru") }
      OPTIONAL { ?item wdt:P2603 ?kinopoiskID }
    } LIMIT 18`;
    const url=`https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
    const data=await fetchJSON(url);
    const results=data.results?.bindings||[];
    const seen=new Set();
    return results.flatMap(row=>{
      const imdbID=row.imdbID?.value,type=row.type?.value||'movie',title=row.title?.value;
      if(!imdbID||!title||seen.has(`${type}:${imdbID}`)) return [];
      seen.add(`${type}:${imdbID}`);
      return [{id:imdbID,imdbID,catalogID:`${type}:${imdbID}`,type,title,
        originalTitle:'',descriptionText:row.description?.value||'',imageURL:'',year:'',
        imdbRating:0,genres:[],kinopoiskID:row.kinopoiskID?.value||'',videos:[]}];
    });
  }
  async function getDetails(movie) {
    const type=movie.type==='series'?'series':'movie';
    const id=movie.id || movie.catalogID?.split(':').at(-1) || movie.catalogID;
    try {
      const payload=await fetchJSON(`${META_API}/meta/${type}/${encodeURIComponent(id)}.json`);
      const details={...movie,...localize(payload.meta||{})};
      if(/[А-Яа-яЁё]/.test(movie.title||'')){details.originalTitle=details.title;details.title=movie.title;}
      if(/[А-Яа-яЁё]/.test(movie.descriptionText||'')) details.descriptionText=movie.descriptionText;
      return details;
    }
    catch { return movie; }
  }
  function optionsFor(max, selected, prefix='') {
    let html=`<option value="0">${prefix ? 'Выбрать' : '0'}</option>`;
    for(let i=1;i<=max;i++)html+=`<option value="${i}" ${Number(selected)===i?'selected':''}>${prefix}${i}</option>`;
    return html;
  }
  function episodeCounts(videos) {
    const counts=new Map();
    for(const video of videos||[]){const s=Number(video.season||0),e=Number(video.episode||0);if(s>0&&e>0)counts.set(s,Math.max(counts.get(s)||0,e));}
    return counts;
  }
  function seasonOptions(videos,selected) {
    const counts=episodeCounts(videos),seasons=[...counts.keys()].sort((a,b)=>a-b);
    if(!seasons.length)return optionsFor(30,selected,'Сезон ');
    return `<option value="0">Выбрать сезон</option>${seasons.map(s=>`<option value="${s}" ${Number(selected)===s?'selected':''}>Сезон ${s}</option>`).join('')}`;
  }
  function episodeOptions(videos,season,selected) {
    const counts=episodeCounts(videos),max=counts.get(Number(season))||100;
    return optionsFor(max,selected,'Серия ');
  }
  async function openDetail(id) {
    let movie=itemByID(id)||state.catalog.find(x=>x.catalogID===id);
    if(!movie)return;
    const old=itemByID(id)||{};
    modalRoot.innerHTML=`<div class="modal-backdrop"><section class="modal"><button class="modal-close" aria-label="Закрыть">×</button><div class="loading">Загружаю информацию…</div></section></div>`;
    $('#modal-root .modal-close').onclick=closeModal;
    const detail=await getDetails(movie);
    const item={...detail,...old};
    const poster=imageURL(detail.imageURL,700);
    const kinopoisk=detail.kinopoiskID ? (()=>{const kind=detail.type==='series'?'series':'film',base=`https://www.kinopoisk.ru/${kind}/${encodeURIComponent(detail.kinopoiskID)}/`;return `<div class="link-row"><a target="_blank" rel="noopener" href="${base}">Кинопоиск ↗</a><a target="_blank" rel="noopener" href="${base.replace('.ru/','.vip/')}">Kinovip ↗</a><a target="_blank" rel="noopener" href="${base.replace('kino','ss')}">SSpoisk ↗</a></div>`;})() : '';
    modalRoot.innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(titleOf(detail))}"><button class="modal-close" aria-label="Закрыть">${icon('close')}</button>
      <div class="detail-layout"><div>${poster?`<img class="detail-poster" src="${esc(poster)}" alt="Постер: ${esc(titleOf(detail))}">`:`<div class="poster-placeholder">🎬</div>`}</div><div class="detail-content">
      <h2>${esc(titleOf(detail))}</h2><div class="detail-info">${esc(detail.year||'')}${detail.type==='series'?' · сериал':' · фильм'}${detail.imdbRating?` · ★ ${esc(detail.imdbRating)}`:''}<br>${esc((detail.genres||[]).join(' · '))}</div>
      ${detail.descriptionText?`<p>${esc(detail.descriptionText)}</p>`:'<p class="muted">Описание пока недоступно.</p>'}${kinopoisk}
      <label class="later-choice"><input type="checkbox" id="modal-later" ${item.status==='later'?'checked':''}><span class="later-check">${icon('bookmark')}</span><span class="later-copy"><strong>Посмотреть позже</strong><small>Оставить в списке даже с оценкой</small></span></label>
      <h3>Оценка</h3><div class="field"><label>${icon('star','star-icon')} Моя оценка</label><select id="modal-rating" class="rating-select">${ratingOptions(item.rating ?? item.personalRating)}</select></div>
      <h3>Где остановились</h3><div class="progress-fields">${detail.type==='series'?`<div class="field"><label>Сезон</label><select id="season" class="input">${seasonOptions(detail.videos,item.currentSeason)}</select></div><div class="field"><label>Серия</label><select id="episode" class="input">${episodeOptions(detail.videos,item.currentSeason,item.currentEpisode)}</select></div>`:`<div class="field"><label>Часы</label><input id="hour" class="input" type="number" min="0" max="99" value="${Number(item.currentHour)||0}"></div><div class="field"><label>Минуты</label><input id="minute" class="input" type="number" min="0" max="59" value="${Number(item.currentMinute)||0}"></div><div class="field"><label>Секунды</label><input id="second" class="input" type="number" min="0" max="59" value="${Number(item.currentSecond)||0}"></div>`}</div>
      <div class="actions-stack"><button class="button primary" data-status="save">${item.status==='later'?'Сохранить в «Посмотреть позже»':'Сохранить в просмотренные'}</button><button class="button secondary" data-status="watching">${icon('play')} Сохранить в «Ещё смотрим»</button></div>
      </div></div></section></div>`;
    $('.modal-close',modalRoot).onclick=closeModal;
    $('.modal-backdrop',modalRoot).addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))closeModal();});
    $('#season',modalRoot)?.addEventListener('change',e=>{const episode=$('#episode',modalRoot);episode.innerHTML=episodeOptions(detail.videos,e.target.value,0);});
    const laterToggle=$('#modal-later',modalRoot),saveButton=$('[data-status="save"]',modalRoot);
    const refreshSaveAction=()=>{const canSaveLater=laterToggle.checked,hasRating=val('#modal-rating')>0;saveButton.disabled=!canSaveLater&&!hasRating;saveButton.textContent=saveButton.disabled?'Для просмотренных нужна оценка':canSaveLater?'Сохранить в «Посмотреть позже»':'Сохранить в просмотренные';};
    laterToggle.addEventListener('change',refreshSaveAction);
    $('#modal-rating',modalRoot).addEventListener('change',refreshSaveAction);
    refreshSaveAction();
    modalRoot.querySelectorAll('[data-status]').forEach(btn=>btn.onclick=()=>saveDetail(detail,btn.dataset.status));
    document.onkeydown=e=>{if(e.key==='Escape')closeModal();};
  }
  function closeModal(){modalRoot.innerHTML='';document.onkeydown=null;}
  function val(id){return Number($(id,modalRoot)?.value||0);}
  function saveDetail(movie,status) {
    const old=itemByID(movie.catalogID), now=new Date().toISOString();
    const rating=val('#modal-rating');
    if(status==='save') status=$('#modal-later',modalRoot).checked?'later':'watched';
    const patch={status,rating,ratingModifiedAt:old?.rating===rating?old.ratingModifiedAt:(old||rating?now:null),
      personalRating:rating,personalRatingModifiedAt:old?.personalRating===rating?old.personalRatingModifiedAt:(old||rating?now:null),dashaRating:0,dashaRatingModifiedAt:null};
    if(status==='watched'&&!patch.rating){toast('Поставь оценку, чтобы отметить фильм просмотренным');return;}
    if(movie.type==='series'){patch.currentSeason=val('#season');patch.currentEpisode=val('#episode');}
    else {patch.currentHour=val('#hour');patch.currentMinute=val('#minute');patch.currentSecond=val('#second');}
    upsert(movie,patch);closeModal();toast(status==='watched'?'Добавлено в просмотренные':status==='watching'?'Сохранено в «Ещё смотрим»':'Сохранено в «Посмотреть позже»');
  }
  function removeItem(id) {
    const item=itemByID(id);if(!item)return;
    item.deletedAt=new Date().toISOString();item.modifiedAt=item.deletedAt;item.timestamp=item.deletedAt;persist();toast('Убрано из списка');
  }
  function exportData() {
    const payload={version:1,exportedAt:new Date().toISOString(),items:state.items.map(x=>({
      catalogID:x.catalogID,timestamp:x.timestamp||x.modifiedAt,modifiedAt:x.modifiedAt,deletedAt:x.deletedAt,
      title:x.title,descriptionText:x.descriptionText,imageURL:x.imageURL,rating:x.rating||x.personalRating||null,
      ratingModifiedAt:x.ratingModifiedAt||x.personalRatingModifiedAt,personalRating:x.rating||x.personalRating||null,
      dashaRating:null,isWatching:x.status==='watching',isWatchLater:x.status==='later',status:x.status,
      personalRatingModifiedAt:x.ratingModifiedAt||x.personalRatingModifiedAt,dashaRatingModifiedAt:null,
      currentSeason:x.currentSeason,currentEpisode:x.currentEpisode,currentHour:x.currentHour,
      currentMinute:x.currentMinute,currentSecond:x.currentSecond,type:x.type,year:x.year,
      imdbRating:x.imdbRating,genres:x.genres,imdbID:x.imdbID,kinopoiskID:x.kinopoiskID
    }))};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const file=new File([blob],`Films-${new Date().toISOString().slice(0,10)}.json`,{type:'application/json'});
    if(navigator.canShare?.({files:[file]})) navigator.share({files:[file],title:'Films — резервная копия'}).catch(()=>downloadBlob(blob,file.name));
    else downloadBlob(blob,file.name);
    $('#sync-menu').classList.add('hidden');toast('Файл синхронизации подготовлен');
  }
  function downloadBlob(blob,name) { const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  async function importData(file) {
    try {
      const data=JSON.parse(await file.text());
      if(!Array.isArray(data.items))throw new Error('Файл не содержит списка фильмов');
      const merged=new Map(state.items.map(x=>[x.catalogID,x]));
      for(const raw of data.items){
        const hasRating=Number(raw.rating||raw.personalRating||raw.vaniRating||0)>0||Number(raw.dashaRating||0)>0;
        const inferredStatus=raw.status||(raw.isWatching?'watching':hasRating?'watched':'later');
        const imported=normalize({...raw,status:inferredStatus,personalRating:raw.personalRating||raw.vaniRating||0});
        const old=merged.get(imported.catalogID);
        merged.set(imported.catalogID,old?mergeLibraryItem(old,imported):imported);
      }
      state.items=[...merged.values()];persist();toast('Коллекции объединены');
    }catch(err){toast(`Не удалось прочитать файл: ${err.message}`);}
    $('#import-file').value='';
  }
  $('#tabs').addEventListener('click',e=>{const button=e.target.closest('[data-tab]');if(!button)return;state.tab=button.dataset.tab;render();if(state.tab==='catalog'&&!state.catalog.length&&!state.loading)loadCatalog(true);});
  app.addEventListener('click',e=>{if(e.target.closest('[data-open-catalog]')){state.tab='catalog';render();if(!state.catalog.length&&!state.loading)loadCatalog(true);return;}const ratings=e.target.closest('[data-rating-dialog]');if(ratings){openRatingDialog(ratings.dataset.ratingDialog);return;}const detail=e.target.closest('[data-detail]');if(detail){openDetail(detail.dataset.detail);return;}const remove=e.target.closest('[data-remove]');if(remove)removeItem(remove.dataset.remove);});
  app.addEventListener('change',e=>{if(e.target.matches('[data-rate]'))setRating(e.target.dataset.id,e.target.dataset.rate,e.target.value);});
  $('#sync-button').addEventListener('click',()=>$('#sync-menu').classList.toggle('hidden'));
  document.addEventListener('click',e=>{if(!e.target.closest('.header-actions'))$('#sync-menu').classList.add('hidden');});
  $('#export-button').addEventListener('click',exportData);
  $('#import-button').addEventListener('click',()=>$('#import-file').click());
  $('#import-file').addEventListener('change',e=>{if(e.target.files?.[0])importData(e.target.files[0]);});
  if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(console.warn);
  render();
  if(state.tab==='catalog') loadCatalog(true);
})();
