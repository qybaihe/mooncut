import { Highlight, Match, SearchResult } from "./models.js";
import { resolveTeams, teamKey } from "./normalization.js";

export const FIFA_API = "https://api.fifa.com/api/v3/";
export const FIFA_CONTENT_API = "https://cxm-api.fifa.com/fifaplusweb/api/";
export const FIFA_WATCH_BASE = "https://www.fifa.com";
export const SEASON_ID = "285023";
export const HIGHLIGHTS_PATH = "en/tournaments/mens/worldcup/canadamexicousa2026/highlights";
export const HIGHLIGHTS_PAGE = `pages/${HIGHLIGHTS_PATH}`;
export const ALL_MATCHES_PAGE = `${HIGHLIGHTS_PAGE}/all-matches`;
export const CATALOG_URL = `${FIFA_WATCH_BASE}/${HIGHLIGHTS_PATH}`;
export type FindMode = "auto" | "highlight" | "team" | "match";

type JsonRecord = Record<string, unknown>;
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface CalendarPayload {
  Results?: unknown[];
}

interface ContentPage {
  sections?: unknown[];
}

interface ContentSection {
  entryType?: unknown;
  entryEndpoint?: unknown;
}

interface SectionPayload {
  items?: unknown[];
}

export class FifaWorldCup26Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FifaWorldCup26Error";
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function localized(value: unknown): string | null {
  if (typeof value === "string") return asString(value);
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const record = asRecord(item);
    const description = record && asString(record.Description);
    if (description) return description;
  }
  return null;
}

function isoDate(value: unknown): string | null {
  const text = asString(value);
  if (!text || Number.isNaN(Date.parse(text))) return null;
  return new Date(text).toISOString();
}

function parseHighlightTitle(title: string): { home: string; away: string; stage: string } | null {
  // A few live FIFA records omit the space before the first pipe (for
  // example, "Netherlands v Japan| Group F | ..."). Keep the delimiter
  // flexible so those records do not silently lose their official video.
  const match = /^\s*(.+?)\s+v(?:s\.?)?\s+(.+?)\s*\|\s*([^|]+?)\s*\|/i.exec(title);
  if (!match) return null;
  return { home: match[1].trim(), away: match[2].trim(), stage: match[3].trim() };
}

function officialWatchUrl(path: string | null, videoId: string): string | null {
  if (path?.startsWith("/en/watch/")) return new URL(path, FIFA_WATCH_BASE).toString();
  return videoId ? `${FIFA_WATCH_BASE}/en/watch/${encodeURIComponent(videoId)}` : null;
}

function pairKey(home: string, away: string): string {
  return [teamKey(home), teamKey(away)].sort().join("|");
}

async function mapLimit<T, R>(
  items: readonly T[],
  maximum: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, maximum), items.length) }, worker));
  return results;
}

/**
 * Pure HTTP reader for the public JSON endpoints that power FIFA.com.
 *
 * The endpoints are public web feeds rather than a documented developer API,
 * so callers should expect normal web-service changes or temporary failures.
 * Returned URLs are official FIFA watch pages only; this class never resolves
 * short-lived stream URLs or downloads video.
 */
export class FifaWorldCup26Client {
  private matchesCache: Match[] | null = null;
  private highlightsCache: Highlight[] | null = null;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly retries = 2
  ) {}

  private async json<T>(url: string, optional = false): Promise<T | undefined> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          headers: { "user-agent": "wc26-highlights/0.1 (+https://www.fifa.com/)" }
        });
        if (response.status === 404 && optional) return undefined;
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        if (attempt < this.retries) {
          await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
        }
      }
    }
    throw new FifaWorldCup26Error(`FIFA request failed for ${url}: ${String(lastError)}`);
  }

  private contentJson<T>(endpoint: string, optional = false): Promise<T | undefined> {
    const url = new URL(endpoint.replace(/^\//, ""), FIFA_CONTENT_API).toString();
    return this.json<T>(url, optional);
  }

  async matches(): Promise<Match[]> {
    if (this.matchesCache) return this.matchesCache;
    const endpoint = new URL("calendar/matches", FIFA_API);
    endpoint.search = new URLSearchParams({
      language: "en",
      count: "500",
      idCompetition: "17",
      idSeason: SEASON_ID
    }).toString();
    const payload = await this.json<CalendarPayload>(endpoint.toString());
    const matches = (payload?.Results ?? [])
      .map((raw) => this.matchFromPayload(raw))
      .filter((match): match is Match => match !== null)
      .sort((left, right) => {
        const leftTime = left.kickoff ? Date.parse(left.kickoff) : 0;
        const rightTime = right.kickoff ? Date.parse(right.kickoff) : 0;
        return leftTime - rightTime || (left.number ?? 0) - (right.number ?? 0);
      });
    if (!matches.length) throw new FifaWorldCup26Error("FIFA returned no World Cup 2026 fixtures");
    this.matchesCache = matches;
    return matches;
  }

  private matchFromPayload(raw: unknown): Match | null {
    const value = asRecord(raw);
    const home = asRecord(value?.Home) ?? {};
    const away = asRecord(value?.Away) ?? {};
    const homeName = localized(home.TeamName) ?? asString(value?.PlaceHolderA) ?? "TBD";
    const awayName = localized(away.TeamName) ?? asString(value?.PlaceHolderB) ?? "TBD";
    const id = asString(value?.IdMatch);
    if (!value || !id) return null;

    const homeScore = asNumber(home.Score);
    const awayScore = asNumber(away.Score);
    const kickoff = isoDate(value.Date);
    const resultType = asNumber(value.ResultType);
    const matchStatusText = asString(value.MatchStatus)?.toLocaleLowerCase();
    const matchStatusNumber = asNumber(value.MatchStatus);
    const finished =
      (resultType !== null && resultType !== 0) ||
      homeScore !== null && awayScore !== null ||
      Boolean(matchStatusText && /played|finished|complete/.test(matchStatusText));
    const scheduledHint =
      matchStatusNumber === 1 ||
      Boolean(matchStatusText && /scheduled|not.?started|upcoming/.test(matchStatusText));
    const status: Match["status"] = finished
      ? "finished"
      : scheduledHint || (kickoff && Date.parse(kickoff) > Date.now())
        ? "scheduled"
        : "in_progress_or_pending";

    return {
      id,
      number: asNumber(value.MatchNumber),
      home: homeName,
      away: awayName,
      homeCode: asString(home.Abbreviation),
      awayCode: asString(away.Abbreviation),
      kickoff,
      stage: localized(value.StageName),
      group: localized(value.GroupName),
      homeScore,
      awayScore,
      status
    };
  }

  async highlights(): Promise<Highlight[]> {
    if (this.highlightsCache) return this.highlightsCache;

    const pageResults = await Promise.allSettled([
      this.contentJson<ContentPage>(HIGHLIGHTS_PAGE),
      this.contentJson<ContentPage>(ALL_MATCHES_PAGE)
    ]);
    const pages = pageResults.map((result) =>
      result.status === "fulfilled" ? result.value : undefined
    );
    // The live landing page contains many unrelated promotional carousels;
    // its first promo carousel is the rolling "latest highlights" rail. The
    // all-matches page contains the stage/group archive and is scanned fully.
    const endpoints = [
      ...new Set([
        ...this.sectionEndpoints(pages[0], true),
        ...this.sectionEndpoints(pages[1], false)
      ])
    ];
    const payloads = await mapLimit(endpoints, 6, async (endpoint) => {
      try {
        return await this.contentJson<SectionPayload>(endpoint, true);
      } catch {
        // A missing or temporarily failing CMS section must not hide the rest
        // of the official catalogue.
        return undefined;
      }
    });

    const unique = new Map<string, Highlight>();
    for (const payload of payloads) {
      const items = payload?.items;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const highlight = this.highlightFromItem(item);
        if (highlight) unique.set(highlight.videoId, highlight);
      }
    }

    const highlights = [...unique.values()].sort((left, right) => {
      const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
      const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
      return rightTime - leftTime || right.videoId.localeCompare(left.videoId);
    });
    if (!highlights.length) throw new FifaWorldCup26Error("FIFA returned no official 2026 highlights");
    this.highlightsCache = highlights;
    return highlights;
  }

  private sectionEndpoints(page: ContentPage | undefined, latestOnly: boolean): string[] {
    if (!Array.isArray(page?.sections)) return [];
    const endpoints = page.sections.flatMap((raw) => {
      const section = asRecord(raw) as ContentSection | null;
      const type = section && asString(section.entryType);
      const endpoint = section && asString(section.entryEndpoint);
      return endpoint && (type === "sectionPromoCarousel" || type === "news") ? [endpoint] : [];
    });
    if (!latestOnly) return endpoints;
    const firstPromo = page.sections.find((raw) => {
      const section = asRecord(raw);
      return asString(section?.entryType) === "sectionPromoCarousel";
    });
    const endpoint = asString(asRecord(firstPromo)?.entryEndpoint);
    return endpoint ? [endpoint] : endpoints.slice(0, 1);
  }

  private highlightFromItem(raw: unknown): Highlight | null {
    const item = asRecord(raw);
    const title = item && asString(item.title);
    const description = item && (asString(item.previewText) ?? asString(item.description));
    const category = item && asString(item.videoSubcategory);
    const matchId = item && asString(item.matchId);
    const appearsToBeHighlights = [title, description, category].some((value) =>
      value?.toLocaleLowerCase().includes("highlight")
    );
    if (!item || !title || (!appearsToBeHighlights && !matchId)) return null;
    const parsed = parseHighlightTitle(title);
    // A reliable FIFA match id is sufficient to associate an item even when
    // the editorial title does not follow the usual "A v B | Stage |" shape.
    if (!parsed && !matchId) return null;

    const watchData = asRecord(item.watchDataDto);
    const videoId = asString(watchData?.videoEntryId) ?? asString(item.entryId);
    if (!videoId) return null;
    const url = officialWatchUrl(asString(item.articlePageUrl) ?? asString(item.readMorePageUrl), videoId);
    if (!url) return null;

    return {
      videoId,
      title,
      provider: "FIFA",
      kind: "official_match_highlights",
      url,
      description,
      durationSeconds: asNumber(watchData?.videoDuration),
      matchId,
      home: parsed?.home ?? null,
      away: parsed?.away ?? null,
      stage: parsed?.stage ?? null,
      publishedAt: isoDate(item.publishedDate)
    };
  }

  async find(query: string, limit = 5, mode: FindMode = "auto"): Promise<SearchResult[]> {
    const text = query.trim();
    if (!text) return [];
    const matches = await this.matches();
    const direct = this.byIdentifier(text, matches);
    let selected: Match[];
    if (mode === "match") {
      selected = direct ? [direct] : [];
    } else if (direct && mode !== "team") {
      selected = [direct];
    } else {
      const codes = new Map<string, string | null>();
      for (const match of matches) {
        codes.set(match.home, match.homeCode);
        codes.set(match.away, match.awayCode);
      }
      const teams = resolveTeams(text, codes.entries());
      if (mode === "team" && teams.length !== 1) {
        selected = [];
      } else if (teams.length >= 2) {
        const target = pairKey(teams[0], teams[1]);
        selected = matches.filter((match) => pairKey(match.home, match.away) === target);
      } else if (teams.length === 1) {
        const target = teamKey(teams[0]);
        selected = matches.filter(
          (match) => teamKey(match.home) === target || teamKey(match.away) === target
        );
      } else {
        return [];
      }
    }

    if (!selected.length) return [];
    let highlights: Highlight[] = [];
    if (selected.some((match) => match.status === "finished")) {
      try {
        highlights = await this.highlights();
      } catch {
        // A temporary CMS/catalogue failure should not hide official fixture
        // data. Callers still receive the match and the canonical fallback URL.
        highlights = [];
      }
    }
    const results = selected.map((match) => ({
      match,
      highlight: this.highlightForMatch(match, highlights),
      fallbackUrl: CATALOG_URL
    }));
    const now = Date.now();
    results.sort((left, right) => {
      const leftTime = left.match.kickoff ? Date.parse(left.match.kickoff) : 0;
      const rightTime = right.match.kickoff ? Date.parse(right.match.kickoff) : 0;
      const leftUpcoming = left.match.status !== "finished" && leftTime >= now;
      const rightUpcoming = right.match.status !== "finished" && rightTime >= now;
      // "近期" means the next scheduled fixture first, followed by the most
      // recently completed fixtures. Among future games, nearer beats farther.
      if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
      return leftUpcoming ? leftTime - rightTime : rightTime - leftTime;
    });
    return results.slice(0, Math.max(1, limit));
  }

  private byIdentifier(identifier: string, matches: readonly Match[]): Match | null {
    const value = identifier.trim().toLocaleLowerCase().replace(/^m/, "");
    return (
      matches.find((match) => match.id === value || String(match.number ?? "") === value) ?? null
    );
  }

  private highlightForMatch(match: Match, highlights: readonly Highlight[]): Highlight | null {
    const expected = pairKey(match.home, match.away);
    const direct = highlights.filter((highlight) => highlight.matchId === match.id);
    const candidates = direct.length ? direct : highlights.filter(
      (highlight) =>
        highlight.home !== null &&
        highlight.away !== null &&
        pairKey(highlight.home, highlight.away) === expected
    );
    if (!candidates.length) return null;
    candidates.sort((left, right) => {
      const isStandard = (highlight: Highlight): number =>
        /international sign language|sign language|\(is\)/i.test(
          `${highlight.title} ${highlight.description ?? ""}`
        )
          ? 0
          : 1;
      const standardDifference = isStandard(right) - isStandard(left);
      if (standardDifference) return standardDifference;
      const expectedStages = [match.stage, match.group]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLocaleLowerCase());
      const leftStage = Number(
        Boolean(left.stage && expectedStages.includes(left.stage.toLocaleLowerCase()))
      );
      const rightStage = Number(
        Boolean(right.stage && expectedStages.includes(right.stage.toLocaleLowerCase()))
      );
      if (leftStage !== rightStage) return rightStage - leftStage;
      const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
      const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
      return rightTime - leftTime;
    });
    return candidates[0];
  }
}
