export type WorkspacePage = 'landing' | 'edit' | 'record'

export type Theme = 'light' | 'dark' | 'memphis'

export type PetAnimationState =
  | 'idle'
  | 'running'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'review'

export type VideoAsset = {
  name: string
  sizeLabel: string
  url?: string
  source: 'upload' | 'recording'
}
