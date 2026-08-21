import { reactive } from 'vue'
import type { BookInfo } from '@shared/types'

export const bookState = reactive<{ current: BookInfo | null }>({ current: null })
