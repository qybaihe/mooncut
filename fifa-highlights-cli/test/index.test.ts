import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { main } from '../src/index.js';

const resultWithHighlight = {
  match: {
    id: '400021501',
    number: 13,
    home: '巴西',
    away: '挪威',
    homeCode: 'BRA',
    awayCode: 'NOR',
    kickoff: '2026-06-20T18:00:00Z',
    stage: '小组赛',
    group: 'C组',
    homeScore: 2,
    awayScore: 1,
    status: 'played'
  },
  highlight: {
    videoId: 'brazil-norway-video',
    title: 'Brazil v Norway | Group C | FIFA World Cup 2026™',
    provider: 'FIFA',
    kind: 'official_match_highlights',
    url: 'https://www.fifa.com/en/watch/brazil-norway-official',
    description: 'Watch the highlights from Brazil v Norway.',
    durationSeconds: 420,
    matchId: '400021501',
    home: 'Brazil',
    away: 'Norway',
    stage: 'Group C',
    publishedAt: null
  },
  fallbackUrl: 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/match-center/400021501'
};

const chinesePage = {
  provider: 'Baidu Sports' as const,
  matchId: 'baidu-match-id',
  home: '巴西',
  away: '挪威',
  score: '2-1',
  status: '已结束',
  stage: '世界杯小组赛',
  startTime: '2026-06-20T18:00:00.000Z',
  summary: '巴西战胜挪威',
  url: 'https://tiyu.baidu.com/al/live/detail?matchId=baidu-match-id&tab=球员评分',
  views: {
    ratings: 'https://tiyu.baidu.com/al/live/detail?matchId=baidu-match-id&tab=球员评分',
    match: 'https://tiyu.baidu.com/al/live/detail?matchId=baidu-match-id&tab=赛况',
    chat: 'https://tiyu.baidu.com/al/live/detail?matchId=baidu-match-id&tab=聊天'
  }
};

test('main emits machine-readable results for --json', async () => {
  const queries: string[] = [];
  const clientFactory = () => ({
    find: async (query: string) => {
      queries.push(query);
      return [resultWithHighlight];
    }
  });
  const output: string[] = [];
  const exitCode = await main(['highlight', '巴西 vs 挪威', '--json'], {
    clientFactory,
    opener: async () => undefined,
    write: (message) => output.push(message)
  });

  assert.equal(exitCode, 0);

  assert.deepEqual(queries, ['巴西 vs 挪威']);
  assert.deepEqual(JSON.parse(output.join('\n')), {
    query: '巴西 vs 挪威',
    provider: 'FIFA',
    catalogUrl: 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/highlights',
    results: [
      {
        match: { ...resultWithHighlight.match, score: '2-1' },
        video: resultWithHighlight.highlight,
        availability: 'available',
        fallbackUrl: resultWithHighlight.fallbackUrl
      }
    ]
  });
});

test('main opens the resolved official FIFA page for --open', async () => {
  const queries: string[] = [];
  const opened: string[] = [];
  const clientFactory = () => ({
    find: async (query: string) => {
      queries.push(query);
      return [resultWithHighlight];
    }
  });

  const exitCode = await main(['match', '400021501', '--open'], {
    clientFactory,
    opener: async (url: string) => {
      opened.push(url);
    },
    write: () => undefined
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(queries, ['400021501']);
  assert.deepEqual(opened, ['https://www.fifa.com/en/watch/brazil-norway-official']);
});

test('main keeps --json output valid when download progress is emitted', async () => {
  const output: string[] = [];
  const diagnostics: string[] = [];
  const modes: string[] = [];
  const outPath = '/tmp/wc26-json-download-test.mp4';

  const exitCode = await main(
    ['download', '巴西对挪威', '--json', '--out', outPath, '--force'],
    {
      clientFactory: () => ({
        find: async (_query: string, _limit: number, mode: string) => {
          modes.push(mode);
          return [resultWithHighlight];
        }
      }),
      downloader: async (_videoId, options) => {
        options.log?.('mock progress');
        return options.outPath;
      },
      write: (message) => output.push(message),
      error: (message) => diagnostics.push(message)
    }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(modes, ['highlight']);
  assert.equal(output.length, 1);
  const parsed = JSON.parse(output[0]);
  assert.deepEqual(parsed.download, { status: 'completed', path: outPath });
  assert.deepEqual(diagnostics, ['mock progress']);
});

test('main passes strict team and match modes to the client', async () => {
  const modes: string[] = [];
  const clientFactory = () => ({
    find: async (_query: string, _limit: number, mode: string) => {
      modes.push(mode);
      return [resultWithHighlight];
    }
  });

  assert.equal(await main(['team', '巴西'], { clientFactory, write: () => undefined }), 0);
  assert.equal(await main(['match', 'M13'], { clientFactory, write: () => undefined }), 0);
  assert.deepEqual(modes, ['team', 'match']);
});

test('main emits one JSON error document when no result matches', async () => {
  const output: string[] = [];
  const diagnostics: string[] = [];
  const exitCode = await main(['team', '不存在的球队', '--json'], {
    clientFactory: () => ({ find: async () => [] }),
    write: (message) => output.push(message),
    error: (message) => diagnostics.push(message)
  });

  assert.equal(exitCode, 2);
  assert.equal(output.length, 1);
  const parsed = JSON.parse(output[0]);
  assert.deepEqual(parsed.results, []);
  assert.equal(parsed.error.code, 'no_results');
  assert.equal(parsed.error.exitCode, 2);
  assert.equal(diagnostics.length, 1);
});

test('main keeps argument and FIFA request failures machine-readable with --json', async () => {
  const invalidOutput: string[] = [];
  const invalidCode = await main(['team', '巴西', '--unknown', '--json'], {
    write: (message) => invalidOutput.push(message),
    error: () => undefined
  });
  assert.equal(invalidCode, 2);
  assert.equal(invalidOutput.length, 1);
  assert.equal(JSON.parse(invalidOutput[0]).error.code, 'invalid_arguments');

  const requestOutput: string[] = [];
  const requestCode = await main(['team', '巴西', '--json'], {
    clientFactory: () => ({ find: async () => { throw new Error('network down'); } }),
    write: (message) => requestOutput.push(message),
    error: () => undefined
  });
  assert.equal(requestCode, 1);
  assert.equal(requestOutput.length, 1);
  assert.equal(JSON.parse(requestOutput[0]).error.code, 'fifa_request_failed');
});

test('a nonexistent extensionless --out path is treated as a directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wc26-out-test-'));
  const requestedDirectory = join(root, 'highlights');
  let receivedPath = '';
  try {
    const exitCode = await main(
      ['download', '巴西对挪威', '--out', requestedDirectory, '--json'],
      {
        clientFactory: () => ({ find: async () => [resultWithHighlight] }),
        downloader: async (_videoId, options) => {
          receivedPath = options.outPath;
          return options.outPath;
        },
        write: () => undefined,
        error: () => undefined
      }
    );

    assert.equal(exitCode, 0);
    assert.equal(dirname(receivedPath), requestedDirectory);
    assert.match(receivedPath, /\.mp4$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an output-directory creation failure is returned as one JSON document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wc26-out-error-test-'));
  const blockingFile = join(root, 'not-a-directory');
  const output: string[] = [];
  await writeFile(blockingFile, 'block mkdir');
  try {
    const exitCode = await main(
      ['download', '巴西对挪威', '--out', join(blockingFile, 'video.mp4'), '--json'],
      {
        clientFactory: () => ({ find: async () => [resultWithHighlight] }),
        write: (message) => output.push(message),
        error: () => undefined
      }
    );

    assert.equal(exitCode, 1);
    assert.equal(output.length, 1);
    const parsed = JSON.parse(output[0]);
    assert.equal(parsed.error.code, 'output_path_failed');
    assert.equal(parsed.download.status, 'failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('main enriches JSON with the Chinese match page only when --cn is requested', async () => {
  const output: string[] = [];
  const exitCode = await main(['match', 'M13', '--cn', '--json'], {
    clientFactory: () => ({ find: async () => [resultWithHighlight] }),
    cnClientFactory: () => ({ findMatch: async () => chinesePage }),
    write: (message) => output.push(message),
    error: () => undefined
  });

  assert.equal(exitCode, 0);
  assert.equal(output.length, 1);
  const parsed = JSON.parse(output[0]);
  assert.deepEqual(parsed.results[0].chinesePage, chinesePage);
  assert.equal(parsed.screenshot, undefined);
});

test('main opens the requested Chinese match view', async () => {
  const opened: string[] = [];
  const exitCode = await main(['match', 'M13', '--open-cn', '--view', 'match'], {
    clientFactory: () => ({ find: async () => [resultWithHighlight] }),
    cnClientFactory: () => ({ findMatch: async () => chinesePage }),
    opener: async (url) => { opened.push(url); },
    write: () => undefined,
    error: () => undefined
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(opened, [new URL(chinesePage.views.match).toString()]);
});

test('main screenshots the ratings view by default without polluting JSON stdout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wc26-cn-index-'));
  const output: string[] = [];
  const diagnostics: string[] = [];
  let receivedPath = '';
  let receivedView = '';
  try {
    const exitCode = await main(
      ['match', 'M13', '--screenshot', join(root, 'ratings'), '--json'],
      {
        clientFactory: () => ({ find: async () => [resultWithHighlight] }),
        cnClientFactory: () => ({ findMatch: async () => chinesePage }),
        screenshotter: async (_page, options) => {
          receivedPath = options.outPath;
          receivedView = options.view ?? '';
          options.log?.('mock screenshot progress');
          return {
            path: options.outPath,
            url: chinesePage.views.ratings,
            view: 'ratings',
            width: 890,
            height: 720
          };
        },
        write: (message) => output.push(message),
        error: (message) => diagnostics.push(message)
      }
    );

    assert.equal(exitCode, 0);
    assert.equal(receivedPath, join(root, 'ratings.png'));
    assert.equal(receivedView, 'ratings');
    assert.equal(output.length, 1);
    const parsed = JSON.parse(output[0]);
    assert.deepEqual(parsed.screenshot, {
      status: 'completed',
      path: join(root, 'ratings.png'),
      url: chinesePage.views.ratings,
      view: 'ratings',
      width: 890,
      height: 720
    });
    assert.deepEqual(diagnostics, ['mock screenshot progress']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('main keeps Chinese option validation and not-found failures as one JSON document', async () => {
  const invalidOutput: string[] = [];
  assert.equal(
    await main(['match', 'M13', '--view', 'invalid', '--json'], {
      write: (message) => invalidOutput.push(message),
      error: () => undefined
    }),
    2
  );
  assert.equal(invalidOutput.length, 1);
  assert.equal(JSON.parse(invalidOutput[0]).error.code, 'invalid_arguments');

  const missingPathOutput: string[] = [];
  assert.equal(
    await main(['match', 'M13', '--screenshot', '--json'], {
      write: (message) => missingPathOutput.push(message),
      error: () => undefined
    }),
    2
  );
  assert.equal(missingPathOutput.length, 1);
  assert.equal(JSON.parse(missingPathOutput[0]).error.code, 'invalid_arguments');

  const notFoundOutput: string[] = [];
  assert.equal(
    await main(['match', 'M13', '--cn', '--json'], {
      clientFactory: () => ({ find: async () => [resultWithHighlight] }),
      cnClientFactory: () => ({ findMatch: async () => null }),
      write: (message) => notFoundOutput.push(message),
      error: () => undefined
    }),
    2
  );
  assert.equal(notFoundOutput.length, 1);
  assert.equal(JSON.parse(notFoundOutput[0]).error.code, 'cn_not_found');
});

test('main reports screenshot failures as one JSON document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wc26-cn-shot-error-'));
  const output: string[] = [];
  try {
    const exitCode = await main(
      ['match', 'M13', '--screenshot', join(root, 'ratings.png'), '--json'],
      {
        clientFactory: () => ({ find: async () => [resultWithHighlight] }),
        cnClientFactory: () => ({ findMatch: async () => chinesePage }),
        screenshotter: async () => { throw new Error('browser unavailable'); },
        write: (message) => output.push(message),
        error: () => undefined
      }
    );

    assert.equal(exitCode, 1);
    assert.equal(output.length, 1);
    const parsed = JSON.parse(output[0]);
    assert.equal(parsed.error.code, 'screenshot_failed');
    assert.equal(parsed.screenshot.status, 'failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
