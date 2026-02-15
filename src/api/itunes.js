/**
 * iTunes Search API client for podcast discovery.
 * Uses native fetch — no additional dependencies.
 */

const ITUNES_BASE = 'https://itunes.apple.com';

/**
 * Search for podcasts by name.
 * @param {string} query - Search term
 * @param {object} [opts]
 * @param {number} [opts.limit=10] - Max results
 * @returns {Promise<Array<{id: number, name: string, artist: string, feedUrl: string, episodeCount: number, genre: string}>>}
 */
export async function searchPodcasts(query, { limit = 10 } = {}) {
  const url = new URL('/search', ITUNES_BASE);
  url.searchParams.set('term', query);
  url.searchParams.set('media', 'podcast');
  url.searchParams.set('entity', 'podcast');
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes API error: ${res.status} ${res.statusText}`);
  const data = await res.json();

  return (data.results || []).map((r) => ({
    id: r.collectionId,
    name: r.collectionName,
    artist: r.artistName,
    feedUrl: r.feedUrl || null,
    episodeCount: r.trackCount || 0,
    genre: r.primaryGenreName || '',
  }));
}

/**
 * Get episodes for a podcast by its iTunes collection ID.
 * @param {number} collectionId - iTunes collection ID
 * @param {object} [opts]
 * @param {number} [opts.limit=10] - Max episodes
 * @returns {Promise<{show: {id: number, name: string, artist: string}, episodes: Array<{name: string, url: string, date: string, duration: number, description: string}>}>}
 */
export async function getEpisodes(collectionId, { limit = 10 } = {}) {
  // Request limit+1 because the first result is show metadata, not an episode
  const url = new URL('/lookup', ITUNES_BASE);
  url.searchParams.set('id', String(collectionId));
  url.searchParams.set('entity', 'podcastEpisode');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('sort', 'recent');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes API error: ${res.status} ${res.statusText}`);
  const data = await res.json();

  const results = data.results || [];
  if (results.length === 0) throw new Error(`No podcast found with ID ${collectionId}`);

  // First result is the collection (show); rest are episodes
  const showResult = results[0];
  const show = {
    id: showResult.collectionId,
    name: showResult.collectionName,
    artist: showResult.artistName,
  };

  const episodes = results
    .slice(1)
    .filter((r) => r.episodeUrl)
    .map((r) => ({
      name: r.trackName,
      url: r.episodeUrl,
      date: r.releaseDate ? r.releaseDate.split('T')[0] : '',
      duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 60000) : 0,
      description: r.shortDescription || r.description || '',
    }));

  return { show, episodes };
}
