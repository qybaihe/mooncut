<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppNavigation from './components/AppNavigation.vue'
import AuthStudio from './components/AuthStudio.vue'
import ClipStudio from './components/ClipStudio.vue'
import CommunityStudio from './components/CommunityStudio.vue'
import LandingPage from './components/LandingPage.vue'
import PetCompanion from './components/PetCompanion.vue'
import RecordStudio from './components/RecordStudio.vue'
import QueueStudio from './components/QueueStudio.vue'
import {
  authModeForEntry,
  resolvePostAuthPage,
  type AuthMode,
  type WorkspaceDestination,
} from './lib/navigation'
import { getCurrentUser, logout } from './services/api'
import type { AuthUser, PetAnimationState, VideoAsset, WorkspacePage } from './types'

// Full reload always opens Landing. Workspace prefs are written for same-session use only.
const activePage = ref<WorkspacePage>('landing')
const handoffAsset = ref<VideoAsset | null>(null)
const recordMode = ref<'compose' | 'teleprompter' | 'review'>('compose')
const clipPetState = ref<PetAnimationState>('waiting')
const recordPetState = ref<PetAnimationState>('idle')
const petMessage = ref('')
const authUser = ref<AuthUser | null>(null)
const authLoading = ref(true)
/** Auth is a deliberate gate, not the default public entry. */
const authView = ref(false)
const authMode = ref<AuthMode>('login')
const pendingDestination = ref<WorkspaceDestination | null>(null)

const immersive = computed(() => activePage.value === 'record' && recordMode.value === 'teleprompter')
const activePetState = computed(() => {
  if (activePage.value === 'edit') return clipPetState.value
  if (activePage.value === 'record') return recordPetState.value
  if (activePage.value === 'community') return 'review'
  if (activePage.value === 'queue') return 'running'
  return 'idle'
})

watch(activePage, (page) => {
  if (page === 'edit' || page === 'record' || page === 'community' || page === 'queue') {
    localStorage.setItem('mooncut:page', page)
  } else {
    localStorage.removeItem('mooncut:page')
  }
})

function handleRecordingReady(asset: VideoAsset) {
  if (handoffAsset.value?.url && handoffAsset.value.url !== asset.url) {
    URL.revokeObjectURL(handoffAsset.value.url)
  }
  handoffAsset.value = asset
  activePage.value = 'edit'
}

function clearHandoff() {
  if (handoffAsset.value?.url) URL.revokeObjectURL(handoffAsset.value.url)
  handoffAsset.value = null
}

function openAuth(
  mode: AuthMode,
  destination: WorkspaceDestination | null = null,
  { pushHistory = true }: { pushHistory?: boolean } = {},
) {
  authMode.value = mode
  pendingDestination.value = destination
  authView.value = true
  if (pushHistory && typeof history !== 'undefined') {
    const state = history.state as { mooncutView?: string } | null
    if (state?.mooncutView !== 'auth') {
      history.pushState({ mooncutView: 'auth' }, '')
    }
  }
}

function closeAuthHistory(replace = false) {
  if (typeof history === 'undefined') return
  const state = history.state as { mooncutView?: string } | null
  if (state?.mooncutView === 'auth') {
    if (replace) history.replaceState({ mooncutView: 'app' }, '')
    else history.back()
  }
}

function cancelAuth() {
  authView.value = false
  pendingDestination.value = null
  activePage.value = 'landing'
  closeAuthHistory(false)
}

function requestNavigate(page: WorkspaceDestination, entry: 'cta-create' | 'cta-edit' | 'workspace' = 'workspace') {
  if (authUser.value) {
    activePage.value = page
    return
  }
  openAuth(authModeForEntry(entry), page)
}

function openAccount(mode: AuthMode) {
  openAuth(mode, null)
}

function handleAuthenticated(user: AuthUser) {
  authUser.value = user
  authView.value = false
  const next = resolvePostAuthPage(pendingDestination.value)
  pendingDestination.value = null
  closeAuthHistory(true)
  activePage.value = next
}

async function handleLogout() {
  try {
    await logout()
  } finally {
    clearHandoff()
    authUser.value = null
    pendingDestination.value = null
    authView.value = false
    activePage.value = 'landing'
  }
}

function onPopState() {
  if (authView.value) {
    authView.value = false
    pendingDestination.value = null
    activePage.value = 'landing'
  }
}

onMounted(async () => {
  window.addEventListener('popstate', onPopState)
  try {
    authUser.value = (await getCurrentUser()).user
  } catch {
    authUser.value = null
  } finally {
    authLoading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', onPopState)
  clearHandoff()
})
</script>

<template>
  <div v-if="authLoading" class="auth-loading" role="status" aria-label="正在恢复登录状态">
    <span class="auth-loading-mark" aria-hidden="true">◐</span>
    <p>正在打开 MoonCut…</p>
  </div>

  <AuthStudio
    v-else-if="authView"
    :initial-mode="authMode"
    :pending-destination="pendingDestination"
    @authenticated="handleAuthenticated"
    @cancel="cancelAuth"
  />

  <div
    v-else
    class="app-shell"
    :class="{ 'is-landing': activePage === 'landing' }"
  >
    <AppNavigation
      v-if="authUser && activePage !== 'landing'"
      v-model="activePage"
      :immersive="immersive"
      :user-email="authUser.email"
      @logout="handleLogout"
    />
    <main class="app-main" :class="{ 'landing-main': activePage === 'landing' }">
      <LandingPage
        v-show="activePage === 'landing'"
        :user-email="authUser?.email ?? null"
        @navigate="requestNavigate($event)"
        @navigate-create="requestNavigate('record', 'cta-create')"
        @navigate-edit="requestNavigate('edit', 'cta-edit')"
        @open-auth="openAccount"
        @logout="handleLogout"
      />
      <template v-if="authUser">
        <ClipStudio
          v-show="activePage === 'edit'"
          :initial-asset="handoffAsset"
          :user-email="authUser.email"
          @clear-handoff="clearHandoff"
          @pet-state="clipPetState = $event"
          @pet-message="petMessage = $event"
          @open-community="activePage = 'community'"
        />
        <RecordStudio
          v-show="activePage === 'record'"
          :user-email="authUser.email"
          @send-to-edit="handleRecordingReady"
          @mode-change="recordMode = $event"
          @pet-state="recordPetState = $event"
          @pet-message="petMessage = $event"
        />
        <CommunityStudio
          v-show="activePage === 'community'"
          @create="activePage = 'record'"
          @pet-message="petMessage = $event"
        />
        <QueueStudio
          v-if="activePage === 'queue'"
          @create="activePage = 'record'"
        />
      </template>
    </main>
    <PetCompanion
      :state="activePetState"
      :message="petMessage"
      :immersive="immersive"
      :landing="activePage === 'landing'"
    />
  </div>
</template>
