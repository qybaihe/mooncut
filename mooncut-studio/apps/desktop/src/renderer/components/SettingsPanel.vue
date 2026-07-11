<script setup lang="ts">
/**
 * Settings shell patterned after Cherry Studio:
 * left category nav + Model Services master–detail (provider list | config).
 */
import {computed, onMounted, ref, watch} from "vue";
import {getMooncut} from "../composables/useMooncut";
import {useTheme} from "../composables/useTheme";
import {useProviderIcon} from "../composables/useProviderIcon";
import type {UiIconId} from "../composables/useUiIcon";
import UiIcon from "./UiIcon.vue";
import {
  PROVIDER_CATALOG,
  profileFromCatalog,
  type ConnectionTestResult,
  type DependencyInfo,
  type ProviderCatalogEntry,
  type ProviderProfile,
  type ProviderProfileInput,
  type StudioSettings,
  type StudioTheme,
} from "@mooncut/studio-shared";

const emit = defineEmits<{updated: [StudioSettings]}>();
const {currentTheme, setTheme} = useTheme();
const {iconUrl, initial} = useProviderIcon();

type SettingsCategory = "providers" | "appearance" | "general" | "diagnostics";

const category = ref<SettingsCategory>("providers");
const settings = ref<StudioSettings | null>(null);
const deps = ref<DependencyInfo[]>([]);
const providers = ref<ProviderProfile[]>([]);
const catalog = ref<ProviderCatalogEntry[]>([...PROVIDER_CATALOG]);
const selectedId = ref<string | null>(null);
const testResult = ref<ConnectionTestResult | null>(null);
const message = ref("");
const error = ref("");
const busy = ref(false);
const search = ref("");
const newModelId = ref("");
const draftKey = ref("");

const categories: Array<{id: SettingsCategory; label: string; hint: string; icon: UiIconId}> = [
  {id: "providers", label: "模型服务", hint: "接入 API 与模型", icon: "sparkles"},
  {id: "appearance", label: "外观", hint: "浅色 / 深色 / Memphis", icon: "palette"},
  {id: "general", label: "通用", hint: "工作目录与 Agent", icon: "settings"},
  {id: "diagnostics", label: "依赖与诊断", hint: "本机能力与排障", icon: "harddrive"},
];

const filteredProviders = computed(() => {
  const q = search.value.trim().toLowerCase();
  const list = [...providers.value].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.name.localeCompare(b.name, "zh");
  });
  if (!q) return list;
  return list.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.baseUrl.toLowerCase().includes(q) ||
      (p.catalogId ?? "").toLowerCase().includes(q),
  );
});

const selected = computed(() => providers.value.find((p) => p.id === selectedId.value) ?? null);

const draft = ref({
  name: "",
  kind: "remote-openai-compatible" as ProviderProfile["kind"],
  baseUrl: "",
  catalogId: "" as string | undefined,
  plannerModel: "",
  visionModel: "",
  imageModel: "",
  models: [] as string[],
  allowVideoFrameUpload: false,
  timeoutMs: 60_000,
  enabled: false,
  isDefault: false,
});

watch(selected, (p) => {
  testResult.value = null;
  draftKey.value = "";
  if (!p) return;
  draft.value = {
    name: p.name,
    kind: p.kind,
    baseUrl: p.baseUrl,
    catalogId: p.catalogId,
    plannerModel: p.plannerModel,
    visionModel: p.visionModel,
    imageModel: p.imageModel,
    models: [...(p.models ?? [])],
    allowVideoFrameUpload: p.allowVideoFrameUpload,
    timeoutMs: p.timeoutMs,
    enabled: p.enabled,
    isDefault: p.isDefault,
  };
});

async function refresh() {
  const api = getMooncut();
  settings.value = await api.getSettings();
  deps.value = await api.listDeps();
  providers.value = await api.listProviders();
  try {
    catalog.value = await api.listProviderCatalog();
  } catch {
    catalog.value = [...PROVIDER_CATALOG];
  }
  if (!selectedId.value || !providers.value.some((p) => p.id === selectedId.value)) {
    selectedId.value = providers.value.find((p) => p.isDefault)?.id ?? providers.value[0]?.id ?? null;
  }
}

async function saveSettings(partial: Partial<StudioSettings>) {
  if (!settings.value) return;
  busy.value = true;
  error.value = "";
  try {
    const updated = await getMooncut().updateSettings(partial);
    settings.value = updated;
    emit("updated", updated);
    message.value = "设置已保存";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function pickWorkspace() {
  const path = await getMooncut().selectDirectory();
  if (path) await saveSettings({workspaceRoot: path});
}

async function restartAgent() {
  busy.value = true;
  try {
    await getMooncut().agentRestart();
    message.value = "Agent Host 已重启";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

function buildInput(partial: Partial<ProviderProfileInput> = {}): ProviderProfileInput {
  const d = draft.value;
  return {
    id: selectedId.value ?? undefined,
    name: d.name,
    kind: d.kind,
    baseUrl: d.baseUrl,
    catalogId: d.catalogId,
    plannerModel: d.plannerModel,
    visionModel: d.visionModel,
    imageModel: d.imageModel,
    models: d.models,
    allowVideoFrameUpload: d.allowVideoFrameUpload,
    timeoutMs: d.timeoutMs,
    enabled: d.enabled,
    isDefault: d.isDefault,
    apiKey: draftKey.value || undefined,
    ...partial,
  };
}

async function saveProvider(partial: Partial<ProviderProfileInput> = {}) {
  if (!selectedId.value && !partial.id) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    providers.value = await getMooncut().upsertProvider(buildInput(partial));
    draftKey.value = "";
    message.value = "Provider 已保存（密钥仅存 OS 安全存储）";
    if (partial.isDefault || draft.value.isDefault) {
      await saveSettings({defaultProviderProfileId: selectedId.value ?? undefined});
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function toggleEnabled(value: boolean) {
  draft.value.enabled = value;
  await saveProvider({enabled: value});
}

async function setDefault() {
  draft.value.isDefault = true;
  await saveProvider({isDefault: true, enabled: true});
}

async function testConnection() {
  if (!selectedId.value) return;
  busy.value = true;
  testResult.value = null;
  error.value = "";
  try {
    if (draftKey.value || draft.value.baseUrl) {
      await getMooncut().upsertProvider(buildInput());
      draftKey.value = "";
      providers.value = await getMooncut().listProviders();
    }
    testResult.value = await getMooncut().testProvider(selectedId.value);
  } catch (err) {
    testResult.value = {ok: false, error: err instanceof Error ? err.message : String(err)};
  } finally {
    busy.value = false;
  }
}

async function addModel() {
  const id = newModelId.value.trim();
  if (!id) return;
  if (!draft.value.models.includes(id)) draft.value.models = [...draft.value.models, id];
  if (!draft.value.plannerModel) draft.value.plannerModel = id;
  newModelId.value = "";
  await saveProvider({models: draft.value.models, plannerModel: draft.value.plannerModel});
}

async function removeModel(id: string) {
  draft.value.models = draft.value.models.filter((m) => m !== id);
  if (draft.value.plannerModel === id) draft.value.plannerModel = draft.value.models[0] ?? "";
  if (draft.value.visionModel === id) draft.value.visionModel = draft.value.models[0] ?? "";
  await saveProvider({
    models: draft.value.models,
    plannerModel: draft.value.plannerModel,
    visionModel: draft.value.visionModel,
  });
}

async function resetOrDelete() {
  if (!selectedId.value) return;
  if (selectedId.value === "mock-local") {
    error.value = "内置模拟 Provider 不可删除";
    return;
  }
  if (!confirm(`重置或移除「${selected.value?.name}」的配置？内置预设会恢复为未启用状态。`)) return;
  busy.value = true;
  try {
    providers.value = await getMooncut().deleteProvider(selectedId.value);
    message.value = "已重置 Provider";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function addCustomProvider() {
  const seed = profileFromCatalog("custom-openai", {
    name: "自定义端点",
    baseUrl: "http://127.0.0.1:8080/v1",
    enabled: true,
    isDefault: false,
  });
  const {id: _id, ...rest} = seed;
  busy.value = true;
  try {
    providers.value = await getMooncut().upsertProvider({...rest, id: undefined});
    const newest = providers.value
      .filter((p) => p.catalogId === "custom-openai" || p.name === "自定义端点")
      .sort((a, b) => b.id.localeCompare(a.id))[0];
    selectedId.value = newest?.id ?? providers.value.at(-1)?.id ?? null;
    message.value = "已添加自定义 Provider";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function clearCache() {
  await getMooncut().clearCache();
  message.value = "缓存已清理";
}

async function exportDiag() {
  const result = await getMooncut().exportDiagnostics();
  message.value = `诊断包已生成（${result.bytes} bytes）`;
  await getMooncut().showItem(result.path);
}

function applyTheme(theme: StudioTheme) {
  setTheme(theme);
  void saveSettings({theme});
}

function providerBadge(p: ProviderProfile): string {
  if (p.kind === "mock") return "模拟";
  if (p.kind === "local-openai-compatible") return "本地";
  return "远程";
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="settings-shell">
    <aside class="settings-nav" aria-label="设置分类">
      <div class="settings-nav-title">设置</div>
      <button
        v-for="item in categories"
        :key="item.id"
        type="button"
        class="settings-nav-item"
        :class="{active: category === item.id}"
        @click="category = item.id"
      >
        <UiIcon :name="item.icon" :size="16" />
        <span class="settings-nav-item-text">
          <strong>{{ item.label }}</strong>
          <span>{{ item.hint }}</span>
        </span>
      </button>
      <p class="settings-nav-footnote">
        MoonCut Studio 免费、无登录。远程供应商按自身规则计费；密钥仅存系统安全存储。
      </p>
    </aside>

    <section class="settings-main">
      <div v-if="message" class="notice info">{{ message }}</div>
      <div v-if="error" class="notice alert">{{ error }}</div>

      <div v-if="category === 'providers'" class="provider-hub">
        <div class="provider-list-pane">
          <div class="provider-list-header">
            <h2>模型服务</h2>
            <button type="button" class="ghost compact" @click="addCustomProvider">+ 自定义</button>
          </div>
          <input v-model="search" class="provider-search" type="search" placeholder="搜索 Provider…" />
          <div class="provider-list-scroll">
            <button
              v-for="p in filteredProviders"
              :key="p.id"
              type="button"
              class="provider-list-item"
              :class="{active: p.id === selectedId, disabled: !p.enabled}"
              @click="selectedId = p.id"
            >
              <div class="provider-list-item-row">
                <span class="provider-avatar" aria-hidden="true">
                  <img
                    :src="iconUrl(p)"
                    :alt="p.name"
                    class="provider-avatar-img"
                    @load="($event.target as HTMLImageElement).classList.add('is-loaded')"
                    @error="($event.target as HTMLImageElement).style.display = 'none'"
                  />
                  <span class="provider-avatar-fallback">{{ initial(p.name) }}</span>
                </span>
                <div class="provider-list-item-body">
                  <div class="provider-list-item-top">
                    <strong>{{ p.name }}</strong>
                    <span class="badge" :class="p.enabled ? 'ready' : ''">{{ p.enabled ? "已启用" : "未启用" }}</span>
                  </div>
                  <div class="provider-list-item-meta">
                    <span class="badge">{{ providerBadge(p) }}</span>
                    <span v-if="p.isDefault" class="badge ready">默认</span>
                    <span v-if="p.hasApiKey" class="meta">Key ····</span>
                    <span v-else class="meta">无 Key</span>
                  </div>
                </div>
              </div>
            </button>
          </div>
        </div>

        <div v-if="selected" class="provider-detail-pane">
          <header class="provider-detail-header">
            <div class="provider-detail-title">
              <span class="provider-avatar provider-avatar-lg" aria-hidden="true">
                <img
                  :src="iconUrl(selected)"
                  :alt="selected.name"
                  class="provider-avatar-img"
                  @load="($event.target as HTMLImageElement).classList.add('is-loaded')"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                />
                <span class="provider-avatar-fallback">{{ initial(selected.name) }}</span>
              </span>
              <div>
                <div class="eyebrow">Provider</div>
                <h2>{{ selected.name }}</h2>
                <p class="meta mono">{{ selected.id }} · {{ selected.kind }}</p>
              </div>
            </div>
            <label class="switch-row">
              <span>启用</span>
              <input
                type="checkbox"
                :checked="draft.enabled"
                @change="toggleEnabled(($event.target as HTMLInputElement).checked)"
              />
            </label>
          </header>

          <div class="provider-detail-body">
            <div class="settings-section">
              <h3>连接</h3>
              <div class="form-grid wide">
                <label>
                  显示名称
                  <input v-model="draft.name" @change="saveProvider()" />
                </label>
                <label>
                  API 地址（Base URL）
                  <input v-model="draft.baseUrl" placeholder="https://api.example.com/v1" @change="saveProvider()" />
                </label>
                <label>
                  API Key
                  <div class="row">
                    <input
                      v-model="draftKey"
                      type="password"
                      autocomplete="off"
                      :placeholder="selected.hasApiKey ? '已配置 · 输入新密钥以覆盖' : '可选 / 本地可留空'"
                    />
                    <button type="button" class="primary compact" :disabled="busy" @click="saveProvider()">保存</button>
                    <button type="button" class="compact" :disabled="busy" @click="testConnection">检测</button>
                  </div>
                </label>
                <label>
                  超时（毫秒）
                  <input v-model.number="draft.timeoutMs" type="number" min="1000" max="600000" @change="saveProvider()" />
                </label>
                <label class="check-inline">
                  <span>允许向该端点上传视频帧（视觉分析）</span>
                  <input v-model="draft.allowVideoFrameUpload" type="checkbox" @change="saveProvider()" />
                </label>
              </div>
              <div v-if="testResult" class="notice" :class="testResult.ok ? 'info' : 'alert'" style="margin-top: 0.75rem">
                <template v-if="testResult.ok">
                  连接成功 · {{ testResult.latencyMs }} ms
                  <span v-if="testResult.modelsSample?.length"> · {{ testResult.modelsSample.join(", ") }}</span>
                </template>
                <template v-else>连接失败：{{ testResult.error }}</template>
              </div>
            </div>

            <div class="settings-section">
              <h3>模型列表</h3>
              <p class="meta" style="margin-top: 0">为该 Provider 维护可用模型 ID；再指定 Planner / Vision / Image 角色。</p>
              <div class="model-chips">
                <span v-for="m in draft.models" :key="m" class="model-chip">
                  {{ m }}
                  <button type="button" class="chip-x" :title="`移除 ${m}`" @click="removeModel(m)">×</button>
                </span>
                <span v-if="!draft.models.length" class="meta">尚未添加模型</span>
              </div>
              <div class="row" style="margin-top: 0.65rem">
                <input v-model="newModelId" placeholder="例如 gpt-4.1 或 llama3.2" @keydown.enter.prevent="addModel" />
                <button type="button" class="primary compact" @click="addModel">添加模型</button>
              </div>
              <div class="form-grid wide" style="margin-top: 1rem">
                <label>
                  Planner 模型
                  <select v-model="draft.plannerModel" @change="saveProvider()">
                    <option v-for="m in draft.models" :key="`p-${m}`" :value="m">{{ m }}</option>
                    <option v-if="!draft.models.length" value="">—</option>
                  </select>
                </label>
                <label>
                  Vision 模型
                  <select v-model="draft.visionModel" @change="saveProvider()">
                    <option v-for="m in draft.models" :key="`v-${m}`" :value="m">{{ m }}</option>
                    <option v-if="!draft.models.length" value="">—</option>
                  </select>
                </label>
                <label>
                  Image 模型（可选）
                  <input v-model="draft.imageModel" list="image-models" @change="saveProvider()" />
                  <datalist id="image-models">
                    <option v-for="m in draft.models" :key="`i-${m}`" :value="m" />
                  </datalist>
                </label>
              </div>
            </div>

            <div class="settings-section row actions-bar">
              <button type="button" class="primary" :disabled="busy || selected.isDefault" @click="setDefault">
                设为默认
              </button>
              <button type="button" class="danger" :disabled="busy || selected.id === 'mock-local'" @click="resetOrDelete">
                重置配置
              </button>
            </div>
          </div>
        </div>

        <div v-else class="provider-detail-pane empty-detail">
          <p>从左侧选择一个 Provider，或添加自定义 OpenAI-compatible 端点。</p>
        </div>
      </div>

      <div v-else-if="category === 'appearance'" class="settings-panel-card">
        <h2>
          <UiIcon name="palette" :size="18" style="margin-right: 6px; vertical-align: -3px" />
          外观
        </h2>
        <p class="meta">与网页端一致：浅色 · 深色 · Memphis 暖纸撞色。圆角与控件密度已统一对齐设计语言。</p>
        <div class="theme-cards">
          <button type="button" class="theme-card" :class="{active: currentTheme === 'light'}" @click="applyTheme('light')">
            <UiIcon name="sun" :size="18" />
            <strong>浅色</strong><span>克制信息密度</span>
          </button>
          <button type="button" class="theme-card" :class="{active: currentTheme === 'dark'}" @click="applyTheme('dark')">
            <UiIcon name="moon" :size="18" />
            <strong>深色</strong><span>专注剪辑工作台</span>
          </button>
          <button type="button" class="theme-card" :class="{active: currentTheme === 'memphis'}" @click="applyTheme('memphis')">
            <UiIcon name="diamond" :size="18" />
            <strong>Memphis</strong><span>暖纸 · 撞色 · 贴纸</span>
          </button>
        </div>
      </div>

      <div v-else-if="category === 'general'" class="settings-panel-card">
        <h2>
          <UiIcon name="settings" :size="18" style="margin-right: 6px; vertical-align: -3px" />
          通用
        </h2>
        <div v-if="settings" class="form-grid wide">
          <label>
            工作目录
            <div class="row">
              <input :value="settings.workspaceRoot" readonly />
              <button type="button" @click="pickWorkspace">
                <UiIcon name="folder" :size="14" />
                更改…
              </button>
            </div>
          </label>
          <label class="check-inline">
            <span>允许远程 Provider（明确授权后才发起网络请求）</span>
            <input
              type="checkbox"
              :checked="settings.allowNetworkForProviders"
              @change="saveSettings({allowNetworkForProviders: ($event.target as HTMLInputElement).checked})"
            />
          </label>
          <label>
            Agent 模式
            <select
              :value="settings.agentMode"
              @change="saveSettings({agentMode: ($event.target as HTMLSelectElement).value as StudioSettings['agentMode']})"
            >
              <option value="mock">mock（离线可验证任务流）</option>
              <option value="real">real（mooncut-pi-agent Studio 模式）</option>
            </select>
          </label>
          <div class="row">
            <button type="button" @click="restartAgent">
              <UiIcon name="agent" :size="14" />
              重启 Agent Host
            </button>
            <button type="button" @click="clearCache">清理缓存</button>
          </div>
        </div>
      </div>

      <div v-else class="settings-panel-card">
        <h2>
          <UiIcon name="harddrive" :size="18" style="margin-right: 6px; vertical-align: -3px" />
          依赖与诊断
        </h2>
        <div class="row" style="margin-bottom: 0.75rem">
          <button type="button" @click="refresh">
            <UiIcon name="refresh" :size="14" />
            刷新检测
          </button>
          <button type="button" @click="exportDiag">
            <UiIcon name="download" :size="14" />
            导出诊断包（无密钥）
          </button>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>组件</th>
              <th>状态</th>
              <th>许可证</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="dep in deps" :key="dep.id">
              <td>{{ dep.name }}</td>
              <td><span class="badge" :class="dep.status">{{ dep.status }}</span></td>
              <td class="meta">{{ dep.license || "—" }}</td>
              <td class="meta">{{ dep.detail }}</td>
            </tr>
          </tbody>
        </table>
        <p class="privacy-banner">诊断包不含 API Key 与用户素材。卸载后项目文件夹默认保留。</p>
      </div>
    </section>
  </div>
</template>
