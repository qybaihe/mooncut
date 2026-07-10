import { type FetchLike } from "./client.js";
import { type ChineseMatchPage, type ChineseMatchView, type Match } from "./models.js";
import { teamKey } from "./normalization.js";

export const BAIDU_SPORTS_BASE = "https://tiyu.baidu.com";
export const BAIDU_SCHEDULE_PATH = "/al/api/home/schedule";

const VIEW_LABELS: Readonly<Record<ChineseMatchView, string>> = {
  ratings: "球员评分",
  match: "赛况",
  chat: "聊天"
};

type JsonRecord = Record<string, unknown>;

interface BaiduSchedulePayload {
  status?: unknown;
  data?: unknown;
}

interface BaiduScheduleDay {
  time: string;
  list: BaiduScheduleItem[];
}

interface BaiduScheduleItem {
  matchType: string | null;
  game: string | null;
  matchName: string | null;
  matchStage: string | null;
  matchStatusText: string | null;
  startTime: string | null;
  startTimeStamp: string | null;
  vsLine: string | null;
  link: string | null;
  matchId: string | null;
  key: string | null;
  home: string | null;
  away: string | null;
  homeScore: string | null;
  awayScore: string | null;
  summary: string | null;
}

export class BaiduSportsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaiduSportsError";
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pairKey(home: string, away: string): string {
  return [teamKey(home), teamKey(away)].sort().join("|");
}

function shanghaiDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const valueFor = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}`;
}

function shiftDate(date: string, days: number): string {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed)) throw new BaiduSportsError(`无效比赛日期：${date}`);
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

function parseStartTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(`${value.replace(" ", "T")}+08:00`);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function chineseViewUrl(url: string, view: ChineseMatchView): string {
  const parsed = new URL(url, BAIDU_SPORTS_BASE);
  if (parsed.protocol !== "https:" || parsed.hostname !== "tiyu.baidu.com") {
    throw new BaiduSportsError(`不可信的中文比赛页面：${parsed.toString()}`);
  }
  parsed.searchParams.set("tab", VIEW_LABELS[view]);
  return parsed.toString();
}

function itemFromPayload(raw: unknown): BaiduScheduleItem | null {
  const item = asRecord(raw);
  if (!item) return null;
  const left = asRecord(item.leftLogo);
  const right = asRecord(item.rightLogo);
  const resultDesc = asRecord(item.resultDesc);
  return {
    matchType: asString(item.matchType),
    game: asString(item.game),
    matchName: asString(item.matchName),
    matchStage: asString(item.matchStage),
    matchStatusText: asString(item.matchStatusText),
    startTime: asString(item.startTime),
    startTimeStamp: asString(item.startTimeStamp),
    vsLine: asString(item.vsLine),
    link: asString(item.link),
    matchId: asString(item.matchId),
    key: asString(item.key),
    home: asString(left?.name),
    away: asString(right?.name),
    homeScore: asString(left?.score),
    awayScore: asString(right?.score),
    summary: asString(resultDesc?.text)
  };
}

function dayFromPayload(payload: BaiduSchedulePayload): BaiduScheduleDay | null {
  if (String(payload.status ?? "") !== "0") return null;
  const data = asRecord(payload.data);
  const time = asString(data?.time);
  if (!time || !Array.isArray(data?.list)) return null;
  return {
    time,
    list: data.list.map(itemFromPayload).filter((item): item is BaiduScheduleItem => Boolean(item))
  };
}

/** Pure-HTTP reader for Baidu Sports' Chinese match schedule pages. */
export class BaiduSportsClient {
  private readonly cache = new Map<string, Promise<BaiduScheduleItem[]>>();

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly retries = 1
  ) {}

  async findMatch(match: Match): Promise<ChineseMatchPage | null> {
    if (!match.kickoff) return null;
    const kickoff = new Date(match.kickoff);
    if (Number.isNaN(kickoff.getTime())) return null;
    const date = shanghaiDate(kickoff);
    const items = await this.itemsForDate(date);
    const expectedPair = pairKey(match.home, match.away);
    const candidates = items.filter(
      (item) =>
        item.home &&
        item.away &&
        pairKey(item.home, item.away) === expectedPair &&
        (item.game?.includes("世界杯") || item.matchName?.includes("世界杯"))
    );
    if (!candidates.length) return null;

    const distance = (item: BaiduScheduleItem): number => {
      const timestamp = Number(item.startTimeStamp);
      if (Number.isFinite(timestamp) && timestamp > 0) {
        return Math.abs(timestamp * 1000 - kickoff.getTime());
      }
      const start = parseStartTime(item.startTime);
      return start ? Math.abs(Date.parse(start) - kickoff.getTime()) : Number.MAX_SAFE_INTEGER;
    };
    candidates.sort((left, right) => distance(left) - distance(right));
    if (candidates.length > 1 && distance(candidates[0]) === distance(candidates[1])) {
      throw new BaiduSportsError(
        `百度体育返回多个同时间候选：${match.home} vs ${match.away}`
      );
    }
    const selected = candidates[0];
    const matchId = selected.matchId ?? selected.key;
    if (!matchId || !selected.home || !selected.away) return null;
    const rawUrl = new URL("/al/live/detail", BAIDU_SPORTS_BASE);
    rawUrl.searchParams.set("matchId", matchId);
    const views = {
      ratings: chineseViewUrl(rawUrl.toString(), "ratings"),
      match: chineseViewUrl(rawUrl.toString(), "match"),
      chat: chineseViewUrl(rawUrl.toString(), "chat")
    } satisfies Record<ChineseMatchView, string>;
    const score =
      selected.vsLine ??
      (selected.homeScore && selected.awayScore
        ? `${selected.homeScore}-${selected.awayScore}`
        : null);

    return {
      provider: "Baidu Sports",
      matchId,
      home: selected.home,
      away: selected.away,
      score,
      status: selected.matchStatusText,
      stage: selected.matchStage ?? selected.matchName,
      startTime: parseStartTime(selected.startTime),
      summary: selected.summary,
      url: views.ratings,
      views
    };
  }

  private itemsForDate(date: string): Promise<BaiduScheduleItem[]> {
    const cached = this.cache.get(date);
    if (cached) return cached;
    const request = this.loadDate(date);
    this.cache.set(date, request);
    return request;
  }

  private async loadDate(date: string): Promise<BaiduScheduleItem[]> {
    let primaryError: unknown;
    try {
      const primary = await this.scheduleVariants("after", shiftDate(date, -1), date);
      if (primary) return primary;
    } catch (error) {
      primaryError = error;
    }

    try {
      return (await this.scheduleVariants("forward", shiftDate(date, 1), date)) ?? [];
    } catch (error) {
      throw new BaiduSportsError(
        `无法读取百度体育 ${date} 赛程：${String(error ?? primaryError)}`
      );
    }
  }

  private async scheduleVariants(
    direction: "after" | "forward",
    date: string,
    targetDate: string
  ): Promise<BaiduScheduleItem[] | null> {
    const results = await Promise.allSettled([
      this.schedule(direction, date, "all"),
      this.schedule(direction, date, "hot")
    ]);
    const fulfilled = results
      .filter((result): result is PromiseFulfilledResult<BaiduScheduleDay> =>
        result.status === "fulfilled"
      )
      .map((result) => result.value)
      .filter((day) => day.time === targetDate);
    if (!fulfilled.length) {
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => String(result.reason));
      if (failures.length === results.length) throw new BaiduSportsError(failures.join("; "));
      return null;
    }

    const unique = new Map<string, BaiduScheduleItem>();
    for (const item of fulfilled.flatMap((day) => day.list)) {
      const key = item.matchId ?? item.key ??
        `${item.startTime ?? ""}|${item.home ?? ""}|${item.away ?? ""}`;
      unique.set(key, item);
    }
    return [...unique.values()];
  }

  private async schedule(
    direction: "after" | "forward",
    date: string,
    type: "all" | "hot"
  ): Promise<BaiduScheduleDay> {
    const endpoint = new URL(BAIDU_SCHEDULE_PATH, BAIDU_SPORTS_BASE);
    endpoint.searchParams.set("direction", direction);
    endpoint.searchParams.set("type", type);
    endpoint.searchParams.set("date", date);

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await this.fetchImpl(endpoint.toString(), {
          headers: {
            accept: "application/json",
            referer: `${BAIDU_SPORTS_BASE}/al/live`,
            "user-agent": "wc26-highlights/0.1"
          }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as BaiduSchedulePayload;
        const day = dayFromPayload(payload);
        if (!day) throw new Error("unexpected JSON structure");
        return day;
      } catch (error) {
        lastError = error;
        if (attempt < this.retries) {
          await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
        }
      }
    }
    throw new BaiduSportsError(`百度体育请求失败：${String(lastError)}`);
  }
}
