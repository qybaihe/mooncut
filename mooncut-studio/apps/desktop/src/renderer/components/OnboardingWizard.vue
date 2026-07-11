<script setup lang="ts">
/**
 * First-run onboarding — iOS / Cherry-style product tour + essential setup.
 * Flow: welcome → how it works → workspace → privacy/model → ready.
 */
import {computed, onMounted, ref} from "vue";
import {getMooncut} from "../composables/useMooncut";
import type {
  AgentMode,
  DependencyInfo,
  ExternalCliConfig,
  StudioSettings,
} from "@mooncut/studio-shared";
import UiIcon from "./UiIcon.vue";

const emit = defineEmits<{done: [StudioSettings]}>();

const step = ref(0);
const workspaceRoot = ref("");
const preferLocalOnly = ref(true);
const createSample = ref(true);
const deps = ref<DependencyInfo[]>([]);
const busy = ref(false);
const error = ref("");

/** 助手来源（三选一）。沿用 preferLocalOnly 做 mock 的勾选态，新增 agentMode/explicit CLI 选择。 */
const agentMode = ref<AgentMode>("mock");
const externalCli = ref<ExternalCliConfig>({kind: "claude"});

/** Tour + setup steps (last steps collect real settings). */
const panels = [
  {
    id: "welcome",
    kind: "tour" as const,
    kicker: "欢迎",
    title: "用 MoonCut Studio\n把素口播变成成片",
    body: "本地优先、无需登录。先和助手写稿录制，再一键智能剪辑。",
  },
  {
    id: "flow",
    kind: "tour" as const,
    kicker: "三步上手",
    title: "创作 · 录制 · 剪辑",
    body: "按这个顺序走，第一次用也不会迷路。",
  },
  {
    id: "workspace",
    kind: "setup" as const,
    kicker: "准备工作",
    title: "选择工作目录",
    body: "项目、素材和成片都会放在这个文件夹里，完全在本机。",
  },
  {
    id: "privacy",
    kind: "setup" as const,
    kicker: "助手来源",
    title: "选一个助手就能开聊",
    body: "三选一：仅本地验证 / 内置派 / 你自己的 Claude Code 或 OpenCode。随时可在设置里改。",
  },
  {
    id: "ready",
    kind: "setup" as const,
    kicker: "准备就绪",
    title: "可以开始了",
    body: "我们会创建示例项目骨架，并启动本地 Agent。",
  },
];

const flowCards = [
  {
    icon: "chat" as const,
    title: "创作口播",
    desc: "和助手聊主题，生成可念的口播稿，进入提词录制。",
    tip: "顶栏 → 创作口播",
  },
  {
    icon: "camera" as const,
    title: "提词录制",
    desc: "看镜头读稿，实时陪练语速与注视；录完保存在项目里。",
    tip: "助手页 → 进入提词",
  },
  {
    icon: "sparkles" as const,
    title: "智能剪辑",
    desc: "导入或选中录制素材，一键开剪，拿到可发布的成片。",
    tip: "顶栏 → 剪辑台",
  },
];

const total = panels.length;
const progress = computed(() => ((step.value + 1) / total) * 100);
const isLast = computed(() => step.value >= total - 1);
const canNext = computed(() => {
  if (panels[step.value]?.id === "workspace") return Boolean(workspaceRoot.value);
  return true;
});

async function pickWorkspace() {
  const path = await getMooncut().selectDirectory();
  if (path) workspaceRoot.value = path;
}

async function loadDeps() {
  try {
    deps.value = await getMooncut().listDeps();
  } catch {
    deps.value = [];
  }
}

function next() {
  error.value = "";
  if (!canNext.value) {
    error.value = "请先选择工作目录";
    return;
  }
  if (step.value < total - 1) step.value += 1;
}

function back() {
  error.value = "";
  if (step.value > 0) step.value -= 1;
}

/** 三选一切换：更新 agentMode 并联动 preferLocalOnly 的勾选态。 */
function chooseAgentMode(mode: AgentMode) {
  agentMode.value = mode;
  // mock = 仅本地；其它两个都需要联网（派走网关，或 CLI 自己联网）。
  preferLocalOnly.value = mode === "mock";
}

async function finish() {
  if (!workspaceRoot.value) {
    error.value = "请选择工作目录";
    step.value = panels.findIndex((p) => p.id === "workspace");
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const api = getMooncut();
    const settings = await api.completeOnboarding({
      workspaceRoot: workspaceRoot.value,
      preferLocalOnly: preferLocalOnly.value,
      createSampleProject: createSample.value,
      addRemoteProvider: !preferLocalOnly.value,
      agentMode: agentMode.value,
      ...(agentMode.value === "external-cli" ? {externalCli: externalCli.value} : {}),
    });
    // external-cli 模式下不要强行 restart 派 supervisor。
    if (agentMode.value !== "external-cli") {
      await api.agentRestart().catch(() => undefined);
    }
    emit("done", settings);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    const onboarding = await getMooncut().getOnboarding();
    workspaceRoot.value = onboarding.workspaceRoot;
    preferLocalOnly.value = onboarding.preferLocalOnly;
  } catch {
    /* keep defaults */
  }
  // 恢复已选 agentMode（若 settings 里有）
  try {
    const s = await getMooncut().getSettings();
    if (s.agentMode) agentMode.value = s.agentMode;
    if (s.externalCli) externalCli.value = s.externalCli;
  } catch {
    /* keep defaults */
  }
  await loadDeps();
});
</script>

<template>
  <div class="onboard-shell">
    <div class="onboard-card">
      <!-- Progress -->
      <div class="onboard-progress" aria-hidden="true">
        <span :style="{width: `${progress}%`}" />
      </div>

      <div class="onboard-body">
        <!-- LEFT: illustration / content -->
        <div class="onboard-visual">
          <template v-if="panels[step].id === 'welcome'">
            <img
              class="onboard-hero"
              src="/onboarding-hero.jpg"
              alt=""
              width="640"
              height="360"
            />
            <div class="onboard-pill-row">
              <span><UiIcon name="shield" :size="12" /> 无需登录</span>
              <span><UiIcon name="harddrive" :size="12" /> 本地优先</span>
              <span><UiIcon name="sparkles" :size="12" /> 助手写稿</span>
            </div>
          </template>

          <template v-else-if="panels[step].id === 'flow'">
            <img
              class="onboard-hero onboard-hero--steps"
              src="/onboarding-steps.jpg"
              alt=""
              width="512"
              height="512"
            />
          </template>

          <template v-else-if="panels[step].id === 'workspace'">
            <div class="onboard-illus-panel">
              <div class="onboard-illus-icon"><UiIcon name="folder" :size="28" /></div>
              <h3>本机工作区</h3>
              <p>像 iCloud 文件夹一样，但数据只在你电脑上。</p>
              <ul class="onboard-checklist">
                <li><UiIcon name="check" :size="14" /> 项目可整体拷贝带走</li>
                <li><UiIcon name="check" :size="14" /> 密钥不写进项目文件</li>
                <li><UiIcon name="check" :size="14" /> 随时在访达中打开</li>
              </ul>
            </div>
          </template>

          <template v-else-if="panels[step].id === 'privacy'">
            <div class="onboard-illus-panel">
              <div class="onboard-illus-icon"><UiIcon name="shield" :size="28" /></div>
              <h3>你控制网络</h3>
              <p>默认 mock / 本地 Agent；远程模型需你主动配置。</p>
              <div class="onboard-status-chips">
                <span
                  v-for="dep in deps.slice(0, 4)"
                  :key="dep.id"
                  class="onboard-chip"
                  :class="dep.status"
                >
                  {{ dep.name }}
                </span>
                <span v-if="!deps.length" class="onboard-chip">运行时将在首次使用时检测</span>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="onboard-illus-panel onboard-illus-panel--ready">
              <div class="onboard-illus-icon accent"><UiIcon name="check" :size="28" /></div>
              <h3>一切就绪</h3>
              <p>接下来去「创作口播」写第一稿，或在「项目库」打开示例工程。</p>
            </div>
          </template>
        </div>

        <!-- RIGHT: copy + actions -->
        <div class="onboard-content">
          <span class="onboard-kicker">{{ panels[step].kicker }}</span>
          <h1 class="onboard-title">{{ panels[step].title }}</h1>
          <p class="onboard-desc">{{ panels[step].body }}</p>

          <!-- Flow cards -->
          <div v-if="panels[step].id === 'flow'" class="onboard-flow-cards">
            <article v-for="(card, i) in flowCards" :key="card.title" class="onboard-flow-card">
              <span class="onboard-flow-index">{{ i + 1 }}</span>
              <span class="onboard-flow-icon"><UiIcon :name="card.icon" :size="18" /></span>
              <div>
                <strong>{{ card.title }}</strong>
                <p>{{ card.desc }}</p>
                <small>{{ card.tip }}</small>
              </div>
            </article>
          </div>

          <!-- Workspace picker -->
          <div v-if="panels[step].id === 'workspace'" class="onboard-form">
            <label class="onboard-field">
              <span>工作目录</span>
              <div class="onboard-field-row">
                <input v-model="workspaceRoot" readonly placeholder="点击右侧选择…" />
                <button type="button" class="primary compact" @click="pickWorkspace">
                  <UiIcon name="folder" :size="14" />
                  选择
                </button>
              </div>
            </label>
          </div>

          <!-- Privacy toggles -->
          <div v-if="panels[step].id === 'privacy'" class="onboard-form">
            <div class="agent-source-cards">
              <button
                type="button"
                class="agent-source-card"
                :class="{active: agentMode === 'mock'}"
                @click="chooseAgentMode('mock')"
              >
                <span class="agent-source-icon"><UiIcon name="harddrive" :size="16" /></span>
                <strong>仅本地</strong>
                <small>离线验证流程，不联模型</small>
              </button>
              <button
                type="button"
                class="agent-source-card"
                :class="{active: agentMode === 'real'}"
                @click="chooseAgentMode('real')"
              >
                <span class="agent-source-icon"><UiIcon name="agent" :size="16" /></span>
                <strong>内置派</strong>
                <small>自带 pi-agent，可配置 OpenAI 兼容网关</small>
              </button>
              <button
                type="button"
                class="agent-source-card"
                :class="{active: agentMode === 'external-cli'}"
                @click="chooseAgentMode('external-cli')"
              >
                <span class="agent-source-icon"><UiIcon name="sparkles" :size="16" /></span>
                <strong>我的 CLI</strong>
                <small>用本机 Claude Code / OpenCode，无需配 API</small>
              </button>
            </div>

            <!-- external-cli 子区域 -->
            <div v-if="agentMode === 'external-cli'" class="agent-cli-subform">
              <span class="mini-label">优先命令</span>
              <div class="agent-cli-kinds">
                <label class="onboard-toggle compact">
                  <div>
                    <strong>Claude Code</strong>
                    <small>自动探测 which claude</small>
                  </div>
                  <input
                    :checked="externalCli.kind === 'claude'"
                    type="radio"
                    name="onboard-cli-kind"
                    @change="externalCli.kind = 'claude'"
                  />
                </label>
                <label class="onboard-toggle compact">
                  <div>
                    <strong>OpenCode</strong>
                    <small>自动探测 which opencode</small>
                  </div>
                  <input
                    :checked="externalCli.kind === 'opencode'"
                    type="radio"
                    name="onboard-cli-kind"
                    @change="externalCli.kind = 'opencode'"
                  />
                </label>
              </div>
              <p class="meta" style="margin: 6px 0 0">
                没装这俩也没关系——用的时候会自动切回内置派。
              </p>
            </div>
          </div>

          <!-- Ready options -->
          <div v-if="panels[step].id === 'ready'" class="onboard-form">
            <label class="onboard-toggle">
              <div>
                <strong>创建示例项目</strong>
                <small>空项目骨架，方便立刻体验剪辑台</small>
              </div>
              <input v-model="createSample" type="checkbox" />
            </label>
          </div>

          <div v-if="error" class="notice alert" style="margin-top: 12px">{{ error }}</div>

          <div class="onboard-footer">
            <div class="onboard-dots" aria-label="步骤">
              <button
                v-for="(_, i) in panels"
                :key="i"
                type="button"
                class="onboard-dot"
                :class="{active: i === step, done: i < step}"
                :aria-label="`第 ${i + 1} 步`"
                @click="step = i"
              />
            </div>
            <div class="onboard-actions">
              <button v-if="step > 0" type="button" class="ghost compact" :disabled="busy" @click="back">
                上一步
              </button>
              <button
                v-if="!isLast"
                type="button"
                class="primary"
                :disabled="!canNext"
                @click="next"
              >
                继续
                <UiIcon name="chevron-right" :size="15" />
              </button>
              <button v-else type="button" class="primary" :disabled="busy" @click="finish">
                <UiIcon name="check" :size="15" />
                {{ busy ? "正在准备…" : "进入 Studio" }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
