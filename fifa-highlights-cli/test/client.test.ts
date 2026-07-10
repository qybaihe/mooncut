import assert from 'node:assert/strict';
import test from 'node:test';

import { FifaWorldCup26Client } from '../src/client.js';
import { createFifaFetch, fifaFixtures } from './support.js';

async function makeClient() {
  const fixtures = await fifaFixtures();
  const http = createFifaFetch(fixtures);
  return {
    client: new FifaWorldCup26Client(http.fetch),
    calls: http.calls
  };
}

test('find resolves Chinese team aliases in a matchup and maps a title-only official highlight', async () => {
  const { client, calls } = await makeClient();

  const results = await client.find('巴西 vs 挪威');

  assert.equal(results.length, 1);
  assert.equal(results[0]?.match.id, '400021501');
  assert.equal(results[0]?.match.home, '巴西');
  assert.equal(results[0]?.match.away, '挪威');
  assert.equal(results[0]?.match.homeCode, 'BRA');
  assert.equal(results[0]?.match.awayCode, 'NOR');
  assert.equal(results[0]?.highlight?.videoId, 'brazil-norway-video');
  assert.equal(results[0]?.highlight?.title, 'Brazil v Norway | Group C | FIFA World Cup 2026™');
  assert.equal(results[0]?.highlight?.url, 'https://www.fifa.com/en/watch/brazil-norway-official');
  assert.ok(calls.some(({ input }) => input.includes('/api/v3/calendar/matches')));
  assert.ok(calls.some(({ input }) => input.includes('/sections/promoCarousel/group-c-carousel')));
});

test('find returns all relevant matches for a team, including an upcoming match without a highlight', async () => {
  const { client } = await makeClient();

  const results = await client.find('阿根廷');
  const byMatchId = new Map(results.map((result) => [result.match.id, result]));

  assert.deepEqual([...byMatchId.keys()].sort(), ['400021502', '400021503']);

  const completed = byMatchId.get('400021503');
  assert.equal(completed?.match.home, '阿根廷');
  assert.equal(completed?.highlight?.videoId, 'argentina-japan-news-video');
  assert.equal(completed?.highlight?.url, 'https://www.fifa.com/en/watch/argentina-japan-direct-official');

  const upcoming = byMatchId.get('400021502');
  assert.match(upcoming?.match.status ?? '', /scheduled/i);
  assert.equal(upcoming?.highlight, null);
});

test('team results are ordered by recency instead of hiding a newer match without video', async () => {
  const fixtures = await fifaFixtures() as Record<string, any>;
  fixtures.schedule.Results.find((match: any) => match.IdMatch === '400021502').Date =
    '2027-06-21T16:00:00Z';
  const http = createFifaFetch(fixtures);
  const client = new FifaWorldCup26Client(http.fetch);

  const results = await client.find('阿根廷', 5, 'team');

  assert.equal(results[0]?.match.id, '400021502');
  assert.equal(results[0]?.highlight, null);
  assert.equal(results[1]?.match.id, '400021503');
  assert.ok(results[1]?.highlight);
});

test('find treats a FIFA match ID as an exact match lookup', async () => {
  const { client } = await makeClient();

  const results = await client.find('400021503');

  assert.equal(results.length, 1);
  assert.equal(results[0]?.match.id, '400021503');
  assert.equal(results[0]?.highlight?.videoId, 'argentina-japan-news-video');
  assert.equal(results[0]?.highlight?.url, 'https://www.fifa.com/en/watch/argentina-japan-direct-official');
});

test('find exposes a scheduled matchup even when FIFA has not published an official highlight', async () => {
  const { client } = await makeClient();

  const results = await client.find('阿根廷对埃及');

  assert.equal(results.length, 1);
  assert.equal(results[0]?.match.id, '400021502');
  assert.match(results[0]?.match.status ?? '', /scheduled/i);
  assert.equal(results[0]?.highlight, null);
});

test('highlight title parsing tolerates FIFA records without a space before the pipe', async () => {
  const fixtures = await fifaFixtures() as Record<string, any>;
  fixtures.groupC.items[0].title = 'Brazil v Norway| Group C | FIFA World Cup 2026™ | Highlights';
  const http = createFifaFetch(fixtures);
  const client = new FifaWorldCup26Client(http.fetch);

  const results = await client.find('巴西对挪威');

  assert.equal(results[0]?.highlight?.videoId, 'brazil-norway-video');
});

test('standard highlight is preferred over an international sign-language duplicate', async () => {
  const fixtures = await fifaFixtures() as Record<string, any>;
  fixtures.groupC.items.push({
    ...fixtures.groupC.items[0],
    entryId: 'zz-sign-language-video',
    title: 'Brazil v Norway | Group C | FIFA World Cup 2026™ | Highlights | International Sign Language (IS)',
    description: 'International Sign Language highlights.',
    readMorePageUrl: '/en/watch/zz-sign-language-video',
    watchDataDto: { videoEntryId: 'zz-sign-language-video', videoDuration: 420 }
  });
  const http = createFifaFetch(fixtures);
  const client = new FifaWorldCup26Client(http.fetch);

  const results = await client.find('巴西对挪威');

  assert.equal(results[0]?.highlight?.videoId, 'brazil-norway-video');
});

test('standard highlight is preferred when duplicate records share the same match id', async () => {
  const fixtures = await fifaFixtures() as Record<string, any>;
  fixtures.latest.items.push({
    ...fixtures.latest.items[0],
    entryId: 'zz-direct-sign-language-video',
    title: 'Argentina v Japan | Group D | FIFA World Cup 2026™ | Highlights | International Sign Language (IS)',
    description: 'International Sign Language highlights.',
    readMorePageUrl: '/en/watch/zz-direct-sign-language-video',
    watchDataDto: { videoEntryId: 'zz-direct-sign-language-video', videoDuration: 388 }
  });
  const http = createFifaFetch(fixtures);
  const client = new FifaWorldCup26Client(http.fetch);

  const results = await client.find('M25');

  assert.equal(results[0]?.highlight?.videoId, 'argentina-japan-news-video');
});

test('match-id-backed highlight survives a nonstandard editorial title', async () => {
  const fixtures = await fifaFixtures() as Record<string, any>;
  fixtures.latest.items[0].title = 'Argentina and Japan: the best moments';
  fixtures.latest.items[0].description = 'Relive this match.';
  fixtures.latest.items[0].previewText = null;
  fixtures.latest.items[0].videoSubcategory = null;
  const http = createFifaFetch(fixtures);
  const client = new FifaWorldCup26Client(http.fetch);

  const results = await client.find('M25');

  assert.equal(results[0]?.highlight?.videoId, 'argentina-japan-news-video');
  assert.equal(results[0]?.highlight?.home, null);
  assert.equal(results[0]?.highlight?.away, null);
});

test('a healthy archive page still supplies highlights when the landing page fails', async () => {
  const fixtures = await fifaFixtures() as Record<string, any>;
  const http = createFifaFetch(fixtures);
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const pathname = new URL(String(input)).pathname;
    if (pathname.endsWith('/highlights')) {
      return new Response(JSON.stringify({ message: 'temporary landing failure' }), { status: 503 });
    }
    return http.fetch(input, init);
  };
  const client = new FifaWorldCup26Client(fetchImpl, 0);

  const results = await client.find('巴西对挪威');

  assert.equal(results[0]?.highlight?.videoId, 'brazil-norway-video');
});

test('team results put the nearest future fixture before a farther one', async () => {
  const fixtures = await fifaFixtures() as Record<string, any>;
  const nearer = fixtures.schedule.Results.find((match: any) => match.IdMatch === '400021502');
  nearer.Date = '2027-06-21T16:00:00Z';
  fixtures.schedule.Results.push({
    ...nearer,
    IdMatch: '400021504',
    MatchNumber: 26,
    Date: '2027-06-22T16:00:00Z'
  });
  const http = createFifaFetch(fixtures);
  const client = new FifaWorldCup26Client(http.fetch);

  const results = await client.find('阿根廷', 5, 'team');

  assert.equal(results[0]?.match.id, '400021502');
  assert.equal(results[1]?.match.id, '400021504');
  assert.equal(results[2]?.match.id, '400021503');
});

test('known fixture still returns when the highlights CMS is temporarily unavailable', async () => {
  const fixtures = await fifaFixtures() as Record<string, any>;
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const pathname = new URL(String(input)).pathname;
    if (pathname.endsWith('/api/v3/calendar/matches')) {
      return new Response(JSON.stringify(fixtures.schedule), { status: 200 });
    }
    return new Response(JSON.stringify({ message: 'temporary failure' }), { status: 503 });
  };
  const client = new FifaWorldCup26Client(fetchImpl, 0);

  const results = await client.find('巴西对挪威');

  assert.equal(results.length, 1);
  assert.equal(results[0]?.match.id, '400021501');
  assert.equal(results[0]?.highlight, null);
});

test('match and team modes enforce their command semantics', async () => {
  const { client } = await makeClient();

  assert.deepEqual(await client.find('阿根廷', 5, 'match'), []);
  assert.deepEqual(await client.find('M25', 5, 'team'), []);
  assert.equal((await client.find('M25', 5, 'match'))[0]?.match.id, '400021503');
});
