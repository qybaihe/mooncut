import assert from "node:assert/strict";
import test from "node:test";

import { BaiduSportsClient, chineseViewUrl } from "../src/baidu.js";
import { type Match } from "../src/models.js";

const fifaMatch: Match = {
  id: "400021528",
  number: 95,
  home: "Argentina",
  away: "Egypt",
  homeCode: "ARG",
  awayCode: "EGY",
  kickoff: "2026-07-07T16:00:00.000Z",
  stage: "Round of 16",
  group: null,
  homeScore: 3,
  awayScore: 2,
  status: "finished"
};

const baiduItem = {
  matchType: "football",
  game: "世界杯",
  matchName: "世界杯1/8决赛",
  matchStage: "世界杯1/8决赛",
  matchStatusText: "已结束",
  startTime: "2026-07-08 00:00:00",
  startTimeStamp: "1783440000",
  matchId: "opaque+/=id",
  vsLine: "3-2",
  leftLogo: { name: "阿根廷", score: "3" },
  rightLogo: { name: "埃及", score: "2" },
  resultDesc: { text: "戏剧性拉满！阿根廷让二追三淘汰埃及" }
};

function scheduleResponse(time = "2026-07-08", list: unknown[] = [baiduItem]): Response {
  return new Response(JSON.stringify({ status: "0", data: { time, list } }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("BaiduSportsClient maps a FIFA UTC kickoff to the Chinese schedule and ratings page", async () => {
  const calls: URL[] = [];
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    calls.push(url);
    return scheduleResponse();
  };
  const client = new BaiduSportsClient(fetchImpl, 0);

  const page = await client.findMatch(fifaMatch);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((url) => url.searchParams.get("type")).sort(), ["all", "hot"]);
  for (const call of calls) {
    assert.equal(call.pathname, "/al/api/home/schedule");
    assert.equal(call.searchParams.get("direction"), "after");
    assert.equal(call.searchParams.get("date"), "2026-07-07");
  }
  assert.equal(page?.home, "阿根廷");
  assert.equal(page?.away, "埃及");
  assert.equal(page?.score, "3-2");
  assert.equal(page?.startTime, "2026-07-07T16:00:00.000Z");
  assert.equal(page?.summary, "戏剧性拉满！阿根廷让二追三淘汰埃及");
  assert.equal(new URL(page?.url ?? "").hostname, "tiyu.baidu.com");
  assert.equal(new URL(page?.url ?? "").searchParams.get("matchId"), "opaque+/=id");
  assert.equal(new URL(page?.url ?? "").searchParams.get("tab"), "球员评分");
  assert.equal(new URL(page?.views.match ?? "").searchParams.get("tab"), "赛况");
  assert.equal(new URL(page?.views.chat ?? "").searchParams.get("tab"), "聊天");
});

test("BaiduSportsClient tolerates home-away reversal and one failed schedule variant", async () => {
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.searchParams.get("type") === "all") return new Response("{}", { status: 503 });
    return scheduleResponse("2026-07-08", [
      {
        ...baiduItem,
        leftLogo: { name: "埃及", score: "2" },
        rightLogo: { name: "阿根廷", score: "3" }
      }
    ]);
  };
  const client = new BaiduSportsClient(fetchImpl, 0);

  const page = await client.findMatch(fifaMatch);

  assert.equal(page?.home, "埃及");
  assert.equal(page?.away, "阿根廷");
});

test("BaiduSportsClient rejects a skipped date and falls back from the following day", async () => {
  const calls: URL[] = [];
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.searchParams.get("direction") === "after") {
      return scheduleResponse("2026-07-09", []);
    }
    return scheduleResponse();
  };
  const client = new BaiduSportsClient(fetchImpl, 0);

  const page = await client.findMatch(fifaMatch);

  assert.ok(page);
  assert.equal(calls.length, 4);
  assert.ok(
    calls.some(
      (url) =>
        url.searchParams.get("direction") === "forward" &&
        url.searchParams.get("date") === "2026-07-09"
    )
  );
});

test("BaiduSportsClient returns null when the Chinese schedule has no matching teams", async () => {
  const client = new BaiduSportsClient(async () => scheduleResponse("2026-07-08", []), 0);
  assert.equal(await client.findMatch(fifaMatch), null);
});

test("chineseViewUrl rejects non-Baidu destinations", () => {
  assert.throws(
    () => chineseViewUrl("https://example.com/match", "ratings"),
    /不可信的中文比赛页面/
  );
});
