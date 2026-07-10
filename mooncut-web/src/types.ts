export type WorkspacePage = 'edit' | 'record'

export type VideoAsset = {
  name: string
  sizeLabel: string
  url?: string
  source: 'upload' | 'recording'
}
