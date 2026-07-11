<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import logoUrl from "./assets/mooncut-logo.png";
import CreateSpeakPage from "./components/CreateSpeakPage.vue";
import OnboardingWizard from "./components/OnboardingWizard.vue";
import ProjectLibrary from "./components/ProjectLibrary.vue";
import ProjectWorkbench from "./components/ProjectWorkbench.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import ThemeToggle from "./components/ThemeToggle.vue";
import UiIcon from "./components/UiIcon.vue";
import {getMooncut, hasMooncut} from "./composables/useMooncut";
import {useTheme} from "./composables/useTheme";
import type {AgentHostStatus, ProjectSummary, StudioSettings} from "@mooncut/studio-shared";

type Page = "library" | "create" | "workbench" | "settings" | "onboarding";

const {currentTheme} = useTheme();
const page = ref<Page>("library");
const settings = ref<StudioSettings | null>(null);
const agent = ref<AgentHostStatus | null>(null);
const activeProject = ref<ProjectSummary | null>(null);
const bootError = ref("");
const bridgeMissing = ref(false);
const ready = ref(false);

const agentPill = computed(() => {
  const state = agent.value?.state;
  if (state === "healthy") return "ok";
  if (state === "starting") return "warn";
  if (state === "unhealthy" || state === "crashed") return "bad";
  return "";
});

/** Full-bleed pages (Cherry-like content shell without max-width padding). */
const fullBleed = computed(() => page.value === "create" || page.value === "workbench");

async function refreshAgent() {
  try {
    agent.value = await getMooncut().agentStatus();
  } catch {
    agent.value = null;
  }
}

async function bootstrap() {
  if (!hasMooncut()) {
    bridgeMissing.value = true;
    ready.value = true;
    return;
  }
  try {
    const api = getMooncut();
    settings.value = await api.getSettings();
    const onboarding = await api.getOnboarding();
    if (!onboarding.completed) page.value = "onboarding";
    await refreshAgent();
  } catch (error) {
    bootError.value = error instanceof Error ? error.message : String(error);
  } finally {
    ready.value = true;
  }
}

function openProject(project: ProjectSummary) {
  activeProject.value = project;
  page.value = "workbench";
}

function goCreate(project?: ProjectSummary | null) {
  if (project) activeProject.value = project;
  page.value = "create";
}

function goEdit(project: ProjectSummary) {
  activeProject.value = project;
  page.value = "workbench";
}

async function onOnboardingDone(next: StudioSettings) {
  settings.value = next;
  page.value = "library";
  await refreshAgent();
}

onMounted(() => {
  void bootstrap();
  const timer = window.setInterval(() => {
    if (hasMooncut()) void refreshAgent();
  }, 4000);
  window.addEventListener("beforeunload", () => window.clearInterval(timer));
});
</script>

<template>
  <div class="studio-shell" :data-theme-active="currentTheme" :class="{'is-full-bleed': fullBleed}">
    <header class="studio-topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="brand-logo--mark">
            <img :src="logoUrl" alt="MoonCut" />
          </div>
          <div class="brand-title">
            <strong>MoonCut Studio</strong>
            <span>本地专业口播工作台 · 无需登录</span>
          </div>
        </div>

        <nav v-if="page !== 'onboarding' && !bridgeMissing" class="nav-tabs" aria-label="主导航">
          <button :class="{active: page === 'library'}" type="button" @click="page = 'library'">
            <UiIcon name="library" :size="15" />
            项目库
          </button>
          <button :class="{active: page === 'create'}" type="button" @click="goCreate(activeProject)">
            <UiIcon name="chat" :size="15" />
            创作口播
          </button>
          <button
            :class="{active: page === 'workbench'}"
            type="button"
            :disabled="!activeProject"
            @click="page = 'workbench'"
          >
            <UiIcon name="workbench" :size="15" />
            剪辑台
          </button>
          <button :class="{active: page === 'settings'}" type="button" @click="page = 'settings'">
            <UiIcon name="settings" :size="15" />
            设置
          </button>
        </nav>

        <div class="header-meta">
          <span v-if="!bridgeMissing" class="status-pill" :class="agentPill">
            <span class="dot" />
            <UiIcon name="agent" :size="13" />
            Agent {{ agent?.state ?? "…" }}
            <template v-if="agent?.port"> · :{{ agent.port }}</template>
          </span>
          <ThemeToggle />
        </div>
      </div>
    </header>

    <main class="studio-main" :class="{'studio-main--bleed': fullBleed}">
      <div class="studio-main-inner" :class="{'studio-main-inner--bleed': fullBleed}">
        <div v-if="!ready" class="empty-state">正在启动本地 Studio…</div>

        <div v-else-if="bridgeMissing" class="card bridge-error">
          <div class="eyebrow">桌面桥接</div>
          <h1 style="margin: 0 0 0.5rem">无法连接主进程</h1>
          <p class="meta" style="margin-bottom: 1rem">
            <code>window.mooncut</code> 未注入。请使用最新打包产物，或在仓库中运行开发模式。
          </p>
          <div class="notice alert" style="text-align: left">
            开发：<code>cd mooncut-studio && npm run dev</code><br />
            打包：<code>npm run pack:mac</code> 后打开 release 下的 App
          </div>
        </div>

        <div v-else-if="bootError" class="notice alert">{{ bootError }}</div>
        <OnboardingWizard v-else-if="page === 'onboarding'" @done="onOnboardingDone" />
        <ProjectLibrary
          v-else-if="page === 'library'"
          :settings="settings"
          @open="openProject"
          @settings="page = 'settings'"
        />
        <CreateSpeakPage
          v-else-if="page === 'create'"
          :project="activeProject"
          @open-project="(p) => (activeProject = p)"
          @go-edit="goEdit"
          @go-library="page = 'library'"
        />
        <ProjectWorkbench
          v-else-if="page === 'workbench' && activeProject"
          :project="activeProject"
          @back="page = 'library'"
          @create-speak="goCreate(activeProject)"
        />
        <SettingsPanel v-else-if="page === 'settings'" @updated="(s) => (settings = s)" />
      </div>
    </main>
  </div>
</template>
