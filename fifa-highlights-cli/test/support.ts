import { readFile } from 'node:fs/promises';

export type FetchCall = {
  input: string;
  init?: RequestInit;
};

type FixtureMap = Record<string, unknown>;

export async function readFixture<T>(name: string): Promise<T> {
  const path = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

/**
 * An intentionally small HTTP-only FIFA endpoint stub. It makes tests fail if
 * the client unexpectedly reaches a browser-only or third-party URL.
 */
export function createFifaFetch(fixtures: FixtureMap) {
  const calls: FetchCall[] = [];

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ input: url, init });

    const payload = routeFixture(url, fixtures);
    if (payload === undefined) {
      throw new Error(`Unexpected HTTP request in test: ${url}`);
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  return { fetch, calls };
}

function routeFixture(url: string, fixtures: FixtureMap): unknown | undefined {
  const pathname = new URL(url, 'https://unused.test').pathname;

  if (pathname.endsWith('/api/v3/calendar/matches')) {
    return fixtures.schedule;
  }

  // The provider may either request the all-matches page directly or discover
  // it from the parent highlights page. Both resolve to this catalog fixture.
  if (
    pathname.includes('/fifaplusweb/api/pages/en/') &&
    (pathname.endsWith('/highlights') || pathname.endsWith('/highlights/all-matches'))
  ) {
    return fixtures.catalog;
  }

  if (pathname.endsWith('/sections/promoCarousel/group-c-carousel')) {
    return fixtures.groupC;
  }

  if (pathname.endsWith('/sections/promoCarousel/group-d-carousel')) {
    return fixtures.groupD;
  }

  if (pathname.endsWith('/sections/news/latest-highlights')) {
    return fixtures.latest;
  }

  return undefined;
}

export async function fifaFixtures(): Promise<FixtureMap> {
  const [schedule, catalog, groupC, groupD, latest] = await Promise.all([
    readFixture('schedule-zh.json'),
    readFixture('catalog.json'),
    readFixture('carousel-group-c.json'),
    readFixture('carousel-group-d.json'),
    readFixture('news-latest-highlights.json')
  ]);

  return { schedule, catalog, groupC, groupD, latest };
}
