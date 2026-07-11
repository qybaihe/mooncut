<script setup lang="ts">
import {onMounted, ref} from "vue";
import {getMooncut} from "../composables/useMooncut";
import type {DependencyInfo, StudioSettings} from "@mooncut/studio-shared";
import UiIcon from "./UiIcon.vue";

const emit = defineEmits<{done: [StudioSettings]}>();

const step = ref(0);
const workspaceRoot = ref("");
const preferLocalOnly = ref(true);
const createSample = ref(true);
const deps = ref<DependencyInfo[]>([]);
const busy = ref(false);
const error = ref("");

const steps = ["工作目录", "本机能力", "Agent", "模型端点", "开始"];

async function pickWorkspace() {
  const path = await getMooncut().selectDirectory();
  if (path) workspaceRoot.value = path;
}

async function loadDeps() {
  deps.value = await getMooncut().listDeps();
}

async function finish() {
  if (!workspaceRoot.value) {
    error.value = "请选择工作目录";
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
    });
    await api.agentRestart().catch(() => undefined);
    emit("done", settings);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  const onboarding = await getMooncut().getOnboarding();
  workspaceRoot.value = onboarding.workspaceRoot;
  preferLocalOnly.value = onboarding.preferLocalOnly;
  await loadDeps();
});
</script>

<template>
  <div class="wizard card">
    <div class="eyebrow">
      <UiIcon name="sparkles" :size="12" />
      Studio 初始化
      <img class="memphis-sticker" src="/memphis-icons/check-circle.png" alt="" width="18" height="18" />
    </div>
    <h1 style="margin: 0 0 0.5rem; font-size: 1.35rem; font-weight: 650; letter-spacing: -0.02em">
      欢迎使用 MoonCut Studio
    </h1>
    <p style="color: var(--text-secondary); margin: 0 0 1.15rem; line-height: 1.55; font-size: 13px">
      单机本地产品：无账号、无登录、无云端用户系统。项目与素材默认只保存在你选择的磁盘位置。
    </p>

    <div class="wizard-steps">
      <span
        v-for="(label, index) in steps"
        :key="label"
        :class="{done: index < step, active: index === step}"
        :title="label"
      />
    </div>

    <section v-if="step === 0">
      <h3 style="margin-top: 0; display: flex; align-items: center; gap: 8px">
        <UiIcon name="harddrive" :size="16" />
        1. 选择工作目录
      </h3>
      <p class="meta">新项目将默认创建在此目录。可随时在 Finder / 资源管理器中打开项目文件夹。</p>
      <div class="row" style="margin-top: 0.85rem">
        <input v-model="workspaceRoot" readonly placeholder="尚未选择" />
        <button type="button" class="primary" @click="pickWorkspace">
          <UiIcon name="folder" :size="14" />
          选择文件夹
        </button>
      </div>
    </section>

    <section v-else-if="step === 1">
      <h3 style="margin-top: 0; display: flex; align-items: center; gap: 8px">
        <UiIcon name="layers" :size="16" />
        2. 本机与内置运行时
      </h3>
      <div class="notice info">
        完整安装包已内置 Pi Agent、Remotion、FFmpeg、Face Tracker、字幕组件。无需再单独装服务或写 .env。
        开发态若未执行 <code>npm run prepare:runtime</code>，下列状态可能显示 monorepo 路径探测结果。
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>组件</th>
            <th>状态</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="dep in deps" :key="dep.id">
            <td>{{ dep.name }}</td>
            <td><span class="badge" :class="dep.status">{{ dep.status }}</span></td>
            <td class="meta">{{ dep.detail }}</td>
          </tr>
        </tbody>
      </table>
      <button type="button" class="ghost" style="margin-top: 0.75rem" @click="loadDeps">
        <UiIcon name="refresh" :size="13" />
        重新检测
      </button>
    </section>

    <section v-else-if="step === 2">
      <h3 style="margin-top: 0; display: flex; align-items: center; gap: 8px">
        <UiIcon name="agent" :size="16" />
        3. Pi Agent 运行环境
      </h3>
      <div class="notice info">
        App 管理本地 Pi Agent：随机端口、仅监听 127.0.0.1、随机会话令牌。你不需要写 .env 或手动起服务。
      </div>
      <p class="meta">
        默认使用 <strong>mock Agent</strong> 验证任务流。真实剪辑可在「设置 → Agent 模式」切换为 real。
      </p>
    </section>

    <section v-else-if="step === 3">
      <h3 style="margin-top: 0; display: flex; align-items: center; gap: 8px">
        <UiIcon name="sparkles" :size="16" />
        4. 模型端点
      </h3>
      <label class="check-inline" style="margin: 0.75rem 0">
        <span>仅本地运行（不自动发起网络请求）</span>
        <input v-model="preferLocalOnly" type="checkbox" />
      </label>
      <div class="notice warn">
        Studio 本身免费、不要求登录。远程 OpenAI-compatible 端点的费用由你自行承担；密钥只保存在操作系统安全存储。
      </div>
    </section>

    <section v-else>
      <h3 style="margin-top: 0; display: flex; align-items: center; gap: 8px">
        <UiIcon name="check" :size="16" />
        5. 创建示例或直接开始
      </h3>
      <label class="check-inline">
        <span>创建示例项目（空项目骨架）</span>
        <input v-model="createSample" type="checkbox" />
      </label>
      <div class="notice info">完成后进入本地项目库。可随时导入视频、创建剪辑任务与导出诊断包。</div>
    </section>

    <div v-if="error" class="notice alert">{{ error }}</div>

    <div class="row" style="margin-top: 1.25rem; justify-content: space-between">
      <button type="button" class="ghost" :disabled="step === 0 || busy" @click="step -= 1">上一步</button>
      <button
        v-if="step < steps.length - 1"
        type="button"
        class="primary"
        :disabled="step === 0 && !workspaceRoot"
        @click="step += 1"
      >
        下一步
      </button>
      <button v-else type="button" class="primary" :disabled="busy" @click="finish">
        <UiIcon name="check" :size="14" />
        {{ busy ? "正在完成…" : "进入 Studio" }}
      </button>
    </div>
  </div>
</template>
