/** Resend email delivery for MoonCut edge auth OTPs. */

export type ResendEnv = {
  RESEND_API_KEY?: string
  /** e.g. `MoonCut <noreply@mooncut.me>` — must use a verified Resend domain */
  RESEND_FROM?: string
}

const DEFAULT_FROM = 'MoonCut <noreply@mooncut.me>'

function extractResendMessage(body: Record<string, unknown>, status: number): string {
  const raw = body.message
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (Array.isArray(raw) && raw.length) {
    return raw.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('；')
  }
  if (body.error && typeof body.error === 'object') {
    const nested = body.error as Record<string, unknown>
    if (typeof nested.message === 'string' && nested.message.trim()) return nested.message.trim()
  }
  if (typeof body.error === 'string' && body.error.trim()) return body.error.trim()
  return `Resend 发送失败（${status}）`
}

/** Map Resend / infra errors to short Chinese copy for the auth UI. */
export function friendlyEmailError(message: string): string {
  const lower = message.toLowerCase()
  if (
    /only send testing emails|onboarding@resend\.dev|verify a domain|domain is not verified|from address/i.test(
      message,
    )
  ) {
    return '邮件发件域名未就绪：请使用已验证的 mooncut.me 发件地址。若刚改配置，请稍后再试。'
  }
  if (/invalid api key|unauthorized|401|403.*api/i.test(lower) || /invalid.?api.?key/i.test(message)) {
    return '邮件服务密钥无效，请联系管理员检查 RESEND_API_KEY。'
  }
  if (/rate limit|too many/i.test(lower)) {
    return '邮件发送过于频繁，请稍后再试。'
  }
  if (/missing resend_api_key|邮件服务未配置/i.test(message)) {
    return '邮件服务未配置，请联系管理员。'
  }
  // Keep concise; avoid dumping long English infra dumps in the form.
  if (message.length > 180) return `验证码邮件发送失败：${message.slice(0, 160)}…`
  return `验证码邮件发送失败：${message}`
}

export async function sendResendEmail(
  env: ResendEnv,
  payload: {
    to: string
    subject: string
    html: string
    text: string
  },
): Promise<{ id: string }> {
  const apiKey = env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('邮件服务未配置（缺少 RESEND_API_KEY）')
  }

  const from = (env.RESEND_FROM || DEFAULT_FROM).trim() || DEFAULT_FROM
  let response: Response
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'network error'
    throw new Error(`无法连接邮件服务：${detail}`)
  }

  const text = await response.text()
  let body: Record<string, unknown> = {}
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      /* non-JSON error body */
    }
  }

  if (!response.ok) {
    throw new Error(extractResendMessage(body, response.status))
  }

  const id = typeof body.id === 'string' ? body.id : ''
  return { id }
}

export function buildOtpEmail(params: {
  code: string
  purpose: 'login' | 'register'
  minutes: number
}) {
  const isRegister = params.purpose === 'register'
  const action = isRegister ? '完成注册' : '登录账户'
  const subject = isRegister ? '欢迎来到 MoonCut · 你的注册验证码' : 'MoonCut 登录验证码'
  const headline = isRegister ? '确认邮箱，开启口播创作' : '确认是你，继续创作'
  const lead = isRegister
    ? `欢迎加入 MoonCut。输入下方验证码即可${action}，开始把一句话变成能发的竖屏口播。`
    : `有人正在用此邮箱登录 MoonCut。若是你本人操作，请输入下方验证码完成${action}。`
  const siteUrl = 'https://mooncut.me'
  const year = new Date().getUTCFullYear()

  const text = [
    `MoonCut · AI 口播创作工作台`,
    ``,
    headline,
    lead,
    ``,
    `验证码：${params.code}`,
    `有效期：${params.minutes} 分钟（仅可使用一次）`,
    ``,
    `MoonCut 是什么？`,
    `面向竖屏口播创作者的工作台：从想法写稿、提词录制、到剪辑成片，一条链路做完。`,
    ``,
    `你可以在这里：`,
    `· 口播助手：把主题整理成可念、可改的稿件`,
    `· 提词录制：边看稿边录，语速与注视有实时反馈`,
    `· 智能剪辑：去掉停顿与重复，字幕与节奏一次打包`,
    `· 成片交付：任务完成后发到你的邮箱`,
    ``,
    `打开工作台：${siteUrl}`,
    ``,
    `如非本人操作，请忽略本邮件，不要把验证码告诉他人。`,
    `© ${year} MoonCut · mooncut.me`,
  ].join('\n')

  // Email-safe layout: nested tables + inline styles. Dark studio palette matching the product.
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#0b0d12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#e8eaed;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
    验证码 ${escapeHtml(params.code)} · ${escapeHtml(action)} · ${params.minutes} 分钟内有效。MoonCut 帮你把想法做成竖屏口播。
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0b0d12;padding:28px 14px 40px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;border-collapse:separate;">

          <!-- Brand bar -->
          <tr>
            <td style="padding:0 4px 14px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="left" style="vertical-align:middle;">
                    <span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:#5ce1ff;box-shadow:0 0 0 4px rgba(92,225,255,0.16);vertical-align:middle;"></span>
                    <span style="display:inline-block;margin-left:10px;vertical-align:middle;font-size:15px;font-weight:750;letter-spacing:0.02em;color:#f4f6fa;">MoonCut</span>
                    <span style="display:inline-block;margin-left:8px;vertical-align:middle;font-size:12px;color:#7d8699;">口播创作台</span>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <a href="${siteUrl}" style="font-size:12px;font-weight:650;color:#8ecfff;text-decoration:none;">mooncut.me →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Hero card -->
          <tr>
            <td style="background:linear-gradient(165deg,#151a24 0%,#10141c 55%,#0e1219 100%);border:1px solid #2a3344;border-radius:20px 20px 0 0;padding:28px 26px 8px;">
              <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#5ce1ff;">
                ${isRegister ? 'CREATE ACCOUNT' : 'SIGN IN'} · 邮箱验证
              </p>
              <h1 style="margin:0 0 10px;font-size:26px;line-height:1.25;letter-spacing:-0.03em;color:#f7f8fb;font-weight:750;">
                ${escapeHtml(headline)}
              </h1>
              <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#a8b0c0;">
                ${escapeHtml(lead)}
              </p>

              <!-- OTP block -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 8px;background:#0a0d13;border:1px solid #2d3a4f;border-radius:14px;">
                <tr>
                  <td style="padding:18px 16px 8px;text-align:center;">
                    <p style="margin:0 0 8px;font-size:12px;font-weight:650;letter-spacing:0.06em;color:#7d8699;">你的验证码</p>
                    <p style="margin:0;font-size:36px;font-weight:780;letter-spacing:0.32em;color:#5ce1ff;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.2;">
                      ${escapeHtml(params.code)}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 16px 16px;text-align:center;">
                    <p style="margin:0;font-size:12px;line-height:1.5;color:#8b93a7;">
                      ${params.minutes} 分钟内有效 · 仅可使用一次 · 用于${escapeHtml(action)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Product intro -->
          <tr>
            <td style="background:#12161f;border-left:1px solid #2a3344;border-right:1px solid #2a3344;padding:22px 26px 6px;">
              <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8b93a7;">
                WHAT IS MOONCUT
              </p>
              <h2 style="margin:0 0 10px;font-size:18px;line-height:1.35;letter-spacing:-0.02em;color:#f0f3f8;font-weight:720;">
                从一句话，到一条能发的口播
              </h2>
              <p style="margin:0 0 18px;font-size:13.5px;line-height:1.7;color:#9aa3b5;">
                MoonCut 是竖屏口播创作工作台。不必在写稿、提词、剪辑之间来回切换——把想法说清楚，录下来，再把停顿、重复和字幕交给工具处理。
              </p>
            </td>
          </tr>

          <!-- Capability cards -->
          <tr>
            <td style="background:#12161f;border-left:1px solid #2a3344;border-right:1px solid #2a3344;padding:0 20px 8px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="50%" valign="top" style="padding:6px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0d1118;border:1px solid #273041;border-radius:12px;">
                      <tr><td style="padding:14px 14px 12px;">
                        <p style="margin:0 0 6px;font-size:12px;font-weight:750;color:#5ce1ff;">01 · 口播助手</p>
                        <p style="margin:0;font-size:12.5px;line-height:1.55;color:#aeb6c7;">把主题整理成可念、可改的稿件，三条角度随时换。</p>
                      </td></tr>
                    </table>
                  </td>
                  <td width="50%" valign="top" style="padding:6px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0d1118;border:1px solid #273041;border-radius:12px;">
                      <tr><td style="padding:14px 14px 12px;">
                        <p style="margin:0 0 6px;font-size:12px;font-weight:750;color:#5ce1ff;">02 · 提词录制</p>
                        <p style="margin:0;font-size:12.5px;line-height:1.55;color:#aeb6c7;">边看稿边录，语速、音量与注视有实时反馈。</p>
                      </td></tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td width="50%" valign="top" style="padding:6px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0d1118;border:1px solid #273041;border-radius:12px;">
                      <tr><td style="padding:14px 14px 12px;">
                        <p style="margin:0 0 6px;font-size:12px;font-weight:750;color:#5ce1ff;">03 · 智能剪辑</p>
                        <p style="margin:0;font-size:12.5px;line-height:1.55;color:#aeb6c7;">去掉停顿与重复，字幕与节奏一次打包成片。</p>
                      </td></tr>
                    </table>
                  </td>
                  <td width="50%" valign="top" style="padding:6px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0d1118;border:1px solid #273041;border-radius:12px;">
                      <tr><td style="padding:14px 14px 12px;">
                        <p style="margin:0 0 6px;font-size:12px;font-weight:750;color:#5ce1ff;">04 · 成片交付</p>
                        <p style="margin:0;font-size:12.5px;line-height:1.55;color:#aeb6c7;">任务跑完可把 MP4 发到邮箱，安心去做下一件事。</p>
                      </td></tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="background:#12161f;border:1px solid #2a3344;border-top:0;border-radius:0 0 20px 20px;padding:18px 26px 26px;" align="center">
              <a href="${siteUrl}" style="display:inline-block;min-width:200px;padding:13px 22px;border-radius:12px;background:linear-gradient(180deg,#7ec0ff 0%,#5babff 100%);color:#0c0c0b;font-size:14px;font-weight:750;text-decoration:none;text-align:center;">
                ${isRegister ? '打开 MoonCut，输入验证码' : '返回 MoonCut 登录'}
              </a>
              <p style="margin:14px 0 0;font-size:12px;line-height:1.55;color:#7d8699;">
                适合知识分享、产品讲解、赛事点评、日常竖屏口播——先说清楚，再安心录下来。
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 8px 0;text-align:center;">
              <p style="margin:0 0 8px;font-size:11.5px;line-height:1.6;color:#6b7386;">
                如非本人操作，请忽略本邮件，不要将验证码告知他人。<br>
                这封邮件由系统自动发送，请勿直接回复。
              </p>
              <p style="margin:0;font-size:11px;color:#525a6b;">
                © ${year} MoonCut · <a href="${siteUrl}" style="color:#6b9fd4;text-decoration:none;">mooncut.me</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
