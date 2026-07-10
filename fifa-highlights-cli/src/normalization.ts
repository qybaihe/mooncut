/** Chinese and English aliases for teams in FIFA's English calendar feed. */
export const TEAM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  Algeria: ["阿尔及利亚"],
  Argentina: ["阿根廷"],
  Australia: ["澳大利亚", "澳洲"],
  Austria: ["奥地利"],
  Belgium: ["比利时"],
  "Bosnia and Herzegovina": ["波黑", "Bosnia"],
  Brazil: ["巴西", "Brasil"],
  "Cabo Verde": ["佛得角", "Cape Verde"],
  Canada: ["加拿大"],
  Colombia: ["哥伦比亚"],
  "Congo DR": ["刚果民主共和国", "民主刚果", "刚果金", "DR Congo"],
  "Côte d'Ivoire": ["科特迪瓦", "Ivory Coast", "Cote d Ivoire"],
  Croatia: ["克罗地亚"],
  Curaçao: ["库拉索", "Curacao"],
  Czechia: ["捷克", "Czech Republic"],
  Ecuador: ["厄瓜多尔"],
  Egypt: ["埃及"],
  England: ["英格兰"],
  France: ["法国"],
  Germany: ["德国"],
  Ghana: ["加纳"],
  Haiti: ["海地"],
  "IR Iran": ["伊朗", "Iran"],
  Iraq: ["伊拉克"],
  Japan: ["日本"],
  Jordan: ["约旦"],
  "Korea Republic": ["韩国", "South Korea", "Korea"],
  Mexico: ["墨西哥"],
  Morocco: ["摩洛哥"],
  Netherlands: ["荷兰", "Holland"],
  "New Zealand": ["新西兰"],
  Norway: ["挪威"],
  Panama: ["巴拿马"],
  Paraguay: ["巴拉圭"],
  Portugal: ["葡萄牙"],
  Qatar: ["卡塔尔"],
  "Saudi Arabia": ["沙特", "沙特阿拉伯", "Saudi"],
  Scotland: ["苏格兰"],
  Senegal: ["塞内加尔"],
  "South Africa": ["南非"],
  Spain: ["西班牙"],
  Sweden: ["瑞典"],
  Switzerland: ["瑞士"],
  Tunisia: ["突尼斯"],
  Türkiye: ["土耳其", "Turkey", "Turkiye"],
  Uruguay: ["乌拉圭"],
  USA: ["美国", "United States", "US"],
  Uzbekistan: ["乌兹别克斯坦"]
};

export function normalise(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    // Keep Chinese team names intact while treating common matchup joiners as
    // boundaries, e.g. “阿根廷对埃及” and “Brazil vs Norway”.
    .replace(/[对与和]/gu, " ")
    .replace(/\bvs?\.?\b/gu, " ")
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, " ")
    .trim();
  return ` ${cleaned} `;
}

function compact(value: string): string {
  return normalise(value).trim().replaceAll(" ", "");
}

function aliasesFor(team: string, code: string | null | undefined): string[] {
  return [...new Set([team, ...(TEAM_ALIASES[team] ?? []), ...(code ? [code] : [])])];
}

const canonicalByAlias = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
  for (const alias of [canonical, ...aliases]) {
    canonicalByAlias.set(compact(alias), compact(canonical));
  }
}

/** Return a stable identity for matching calendar team names to catalogue titles. */
export function teamKey(team: string): string {
  return canonicalByAlias.get(compact(team)) ?? compact(team);
}

/**
 * Resolve teams mentioned in a natural-language query. The result order follows
 * the query; callers should still compare fixtures without assuming home/away.
 */
export function resolveTeams(
  query: string,
  teams: Iterable<readonly [team: string, code: string | null | undefined]>
): string[] {
  const normalisedQuery = normalise(query);
  const found: Array<{ team: string; index: number; length: number }> = [];

  for (const [team, code] of teams) {
    let best: { index: number; length: number } | undefined;
    for (const alias of aliasesFor(team, code)) {
      const needle = normalise(alias);
      const index = normalisedQuery.indexOf(needle);
      if (index < 0) continue;
      if (!best || index < best.index || (index === best.index && needle.length > best.length)) {
        best = { index, length: needle.length };
      }
    }
    if (best) found.push({ team, ...best });
  }

  return found
    .sort((left, right) => left.index - right.index || right.length - left.length)
    .map(({ team }) => team);
}
