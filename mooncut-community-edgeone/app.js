const COMMUNITY_API = 'https://api.classby.cn/mooncut-community';

const works = document.querySelector('#works');
const status = document.querySelector('#status');
const refresh = document.querySelector('#refresh');
const loadMore = document.querySelector('#load-more');
const dialog = document.querySelector('#player');
const video = document.querySelector('#video');
const closePlayer = document.querySelector('#close-player');
const playerAuthor = document.querySelector('#player-author');
const playerTitle = document.querySelector('#player-title');
const playerCaption = document.querySelector('#player-caption');

let cursor;
let loading = false;

const date = new Intl.DateTimeFormat('zh-CN', {month: 'short', day: 'numeric'});
const duration = (milliseconds) => {
  const seconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

const safeMediaUrl = (value) => {
  try {
    const url = new URL(value);
    return url.origin === new URL(COMMUNITY_API).origin ? url.href : '';
  } catch {
    return '';
  }
};

const openPlayer = (post) => {
  const source = safeMediaUrl(post.videoUrl);
  if (!source) return;
  video.src = source;
  video.poster = safeMediaUrl(post.posterUrl);
  playerAuthor.textContent = post.authorName;
  playerTitle.textContent = post.title;
  playerCaption.textContent = post.caption || '创作者分享了一条 MoonCut 口播成片。';
  dialog.showModal();
};

const renderPost = (post) => {
  const article = document.createElement('article');
  article.className = 'work';
  const poster = document.createElement('button');
  poster.className = 'poster';
  poster.type = 'button';
  poster.setAttribute('aria-label', `播放 ${post.title}`);
  poster.addEventListener('click', () => openPlayer(post));
  const posterUrl = safeMediaUrl(post.posterUrl);
  if (posterUrl) {
    const image = document.createElement('img');
    image.src = posterUrl;
    image.alt = `${post.title} 视频预览`;
    image.loading = 'lazy';
    poster.append(image);
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'poster-fallback';
    fallback.textContent = '✦';
    poster.append(fallback);
  }
  const play = document.createElement('span');
  play.className = 'play';
  play.textContent = '▶';
  poster.append(play);
  const length = document.createElement('small');
  length.textContent = duration(post.durationMs);
  poster.append(length);
  const body = document.createElement('div');
  body.className = 'work-copy';
  const author = document.createElement('p');
  author.className = 'author';
  author.textContent = `${post.authorName} · ${date.format(new Date(post.createdAt))}`;
  const title = document.createElement('h3');
  title.textContent = post.title;
  const caption = document.createElement('p');
  caption.textContent = post.caption || '创作者分享了一条 MoonCut 口播成片。';
  body.append(author, title, caption);
  article.append(poster, body);
  return article;
};

async function loadPosts(reset = false) {
  if (loading) return;
  loading = true;
  refresh.disabled = true;
  loadMore.disabled = true;
  status.hidden = false;
  status.textContent = reset ? '正在刷新作品…' : '正在打开社区…';
  try {
    const params = new URLSearchParams({limit: '12'});
    if (!reset && cursor) params.set('cursor', cursor);
    const response = await fetch(`${COMMUNITY_API}/v1/community/posts?${params}`, {headers: {Accept: 'application/json'}});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || '社区暂时没有连上');
    if (reset) works.replaceChildren();
    for (const post of body.items || []) works.append(renderPost(post));
    cursor = body.nextCursor;
    if (!works.childElementCount) status.textContent = '社区还没有作品，第一条正在等创作者分享。';
    else status.hidden = true;
    loadMore.hidden = !cursor;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '社区暂时没有连上';
    loadMore.hidden = true;
  } finally {
    loading = false;
    refresh.disabled = false;
    loadMore.disabled = false;
  }
}

refresh.addEventListener('click', () => loadPosts(true));
loadMore.addEventListener('click', () => loadPosts(false));
closePlayer.addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  video.pause();
  video.removeAttribute('src');
  video.load();
});
loadPosts(true);
