export type MatchStatus = "finished" | "scheduled" | "in_progress_or_pending";

/** A fixture read from FIFA's official World Cup calendar feed. */
export interface Match {
  id: string;
  number: number | null;
  home: string;
  away: string;
  homeCode: string | null;
  awayCode: string | null;
  kickoff: string | null;
  stage: string | null;
  group: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: MatchStatus;
}

/** An official FIFA watch-page record. This never contains a media-stream URL. */
export interface Highlight {
  videoId: string;
  title: string;
  provider: "FIFA";
  kind: "official_match_highlights";
  url: string;
  description: string | null;
  durationSeconds: number | null;
  matchId: string | null;
  home: string | null;
  away: string | null;
  stage: string | null;
  publishedAt: string | null;
}

export interface SearchResult {
  match: Match;
  highlight: Highlight | null;
  fallbackUrl: string;
}

export type ChineseMatchView = "ratings" | "match" | "chat";

/** A Chinese match-detail page discovered from Baidu Sports over HTTP. */
export interface ChineseMatchPage {
  provider: "Baidu Sports";
  matchId: string;
  home: string;
  away: string;
  score: string | null;
  status: string | null;
  stage: string | null;
  startTime: string | null;
  summary: string | null;
  url: string;
  views: Record<ChineseMatchView, string>;
}

export interface CliPayload {
  query: string;
  provider: "FIFA";
  catalogUrl: string;
  results: Array<{
    match: Match & { score: string | null };
    video: Highlight | null;
    availability: "available" | "not_published";
    fallbackUrl: string;
    chinesePage?: ChineseMatchPage | null;
  }>;
}
