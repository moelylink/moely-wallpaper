(() => {
  const api = window.wallpaperAPI;
  const thumbWrap = document.getElementById('thumb-wrap');
  const thumbImg = document.getElementById('thumb-img');
  const caption = document.getElementById('caption');
  const info = document.getElementById('info');
  const wallpaperId = document.getElementById('wallpaper-id');
  const wallpaperArtist = document.getElementById('wallpaper-artist');
  const empty = document.getElementById('empty');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const showBtn = document.getElementById('show-btn');
  const quitBtn = document.getElementById('quit-btn');

  let currentState = { currentWallpaper: null, hasMultiple: false, isSwitching: false };

  function render(state) {
    if (!state) return;
    currentState = state;
    const current = state.currentWallpaper;

    if (current && current.thumbnailUrl) {
      if (thumbImg.getAttribute('src') !== current.thumbnailUrl) {
        thumbImg.src = current.thumbnailUrl;
      }
      thumbWrap.hidden = false;
    } else {
      thumbWrap.hidden = true;
      thumbImg.removeAttribute('src');
    }

    caption.textContent = state.overwrittenByOther ? '桌面壁纸已被其他应用覆盖' : '当前桌面壁纸';

    if (state.overwrittenByOther) {
      const name = state.externalWallpaperName || '外部壁纸';
      info.title = name;
      info.hidden = false;
      wallpaperId.hidden = true;
      wallpaperArtist.textContent = name;
      wallpaperArtist.hidden = false;
      empty.hidden = true;
    } else if (current) {
      info.title = current.id + (current.artist ? ' · ' + current.artist : '');
      info.hidden = false;
      wallpaperId.textContent = '#' + current.id;
      wallpaperId.hidden = false;
      if (current.artist) {
        wallpaperArtist.textContent = current.artist;
        wallpaperArtist.hidden = false;
      } else {
        wallpaperArtist.hidden = true;
      }
      empty.hidden = true;
    } else {
      info.hidden = true;
      empty.hidden = false;
    }

    const switchDisabled = !state.hasMultiple || state.isSwitching;
    prevBtn.disabled = switchDisabled;
    nextBtn.disabled = switchDisabled;
  }

  prevBtn.addEventListener('click', () => {
    if (!prevBtn.disabled) api.traySwitchWallpaper(-1).catch(console.error);
  });
  nextBtn.addEventListener('click', () => {
    if (!nextBtn.disabled) api.traySwitchWallpaper(1).catch(console.error);
  });
  showBtn.addEventListener('click', () => api.trayShowMainWindow());
  quitBtn.addEventListener('click', () => api.trayQuitApp());

  api.onTrayStateUpdated(render);
  api.getTrayState().then(render).catch(console.error);
})();
