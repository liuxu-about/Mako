import type { AppState, AppStore, EditorFontFamilyName } from '../store/app-store'
import type { DocThemeName, UIThemeName } from '../../shared/desktop'
import type { AppLanguage } from '../../shared/language'
import {
  translateApp,
  type TranslationKey
} from '../../shared/localization'

interface SettingsPanel {
  destroy: () => void
}

interface ChoiceOption<T extends string> {
  labelKey: TranslationKey
  value: T
}

const languageOptions: ChoiceOption<AppLanguage>[] = [
  { labelKey: 'language.option.zh-CN', value: 'zh-CN' },
  { labelKey: 'language.option.en', value: 'en' }
]

const uiThemeOptions: ChoiceOption<UIThemeName>[] = [
  { labelKey: 'option.system', value: 'system' },
  { labelKey: 'option.light', value: 'light' },
  { labelKey: 'option.dark', value: 'dark' }
]

const docThemeOptions: ChoiceOption<DocThemeName>[] = [
  { labelKey: 'option.default', value: 'default' },
  { labelKey: 'option.elegant', value: 'elegant' },
  { labelKey: 'option.newsprint', value: 'newsprint' },
  { labelKey: 'option.custom', value: 'custom' }
]

const editorFontFamilyOptions: ChoiceOption<EditorFontFamilyName>[] = [
  { labelKey: 'option.systemSans', value: 'system' },
  { labelKey: 'option.serif', value: 'serif' },
  { labelKey: 'option.monospace', value: 'mono' }
]

function createChoiceGroup<T extends string>(
  options: ChoiceOption<T>[],
  onSelect: (value: T) => void
): {
  root: HTMLElement
  buttons: Array<{ value: T; labelKey: TranslationKey; button: HTMLButtonElement }>
} {
  const root = document.createElement('div')
  root.className = 'settings-panel__choice-group'

  const buttons = options.map((option) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'settings-panel__choice'
    button.addEventListener('click', () => onSelect(option.value))
    root.append(button)
    return { value: option.value, labelKey: option.labelKey, button }
  })

  return { root, buttons }
}

function updateChoiceSelection<T extends string>(
  buttons: Array<{ value: T; button: HTMLButtonElement }>,
  activeValue: T
): void {
  buttons.forEach(({ value, button }) => {
    const active = value === activeValue
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-pressed', String(active))
  })
}

function updateChoiceLabels<T extends string>(
  language: AppLanguage,
  buttons: Array<{ labelKey: TranslationKey; button: HTMLButtonElement }>
): void {
  buttons.forEach(({ labelKey, button }) => {
    button.textContent = translateApp(language, labelKey)
  })
}

function closeSettings(store: AppStore): void {
  store.setState({ settingsOpen: false })
}

export function mountSettingsPanel(store: AppStore): SettingsPanel {
  const app = document.getElementById('app')
  if (!app) {
    throw new Error('Settings panel root is missing')
  }

  const overlay = document.createElement('div')
  overlay.className = 'settings-overlay'
  overlay.setAttribute('aria-hidden', 'true')

  const panel = document.createElement('section')
  panel.className = 'settings-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.tabIndex = -1

  const header = document.createElement('div')
  header.className = 'settings-panel__header'

  const title = document.createElement('div')
  title.className = 'settings-panel__title'

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'settings-panel__close'
  closeButton.textContent = '✕'
  closeButton.addEventListener('click', () => closeSettings(store))

  header.append(title, closeButton)

  const body = document.createElement('div')
  body.className = 'settings-panel__body'

  const makeSection = (labelKey: TranslationKey, helperKey?: TranslationKey) => {
    const section = document.createElement('section')
    section.className = 'settings-panel__section'

    const label = document.createElement('div')
    label.className = 'settings-panel__label'
    section.append(label)

    let helper: HTMLDivElement | null = null

    if (helperKey) {
      helper = document.createElement('div')
      helper.className = 'settings-panel__helper'
      section.append(helper)
    }

    body.append(section)
    return { section, label, helper, labelKey, helperKey }
  }

  const languageSection = makeSection('settings.language')
  const languageGroup = createChoiceGroup(languageOptions, (value) => {
    store.setState({ language: value })
  })
  languageSection.section.append(languageGroup.root)

  const uiThemeSection = makeSection('settings.applicationTheme')
  const uiThemeGroup = createChoiceGroup(uiThemeOptions, (value) => {
    store.setState({ uiTheme: value })
  })
  uiThemeSection.section.append(uiThemeGroup.root)

  const docThemeSection = makeSection('settings.documentTheme', 'settings.documentThemeHelper')
  const docThemeGroup = createChoiceGroup(docThemeOptions, (value) => {
    store.setState({ docTheme: value })
  })
  docThemeSection.section.append(docThemeGroup.root)

  const fontFamilySection = makeSection('settings.editorFont')
  const fontFamilyGroup = createChoiceGroup(editorFontFamilyOptions, (value) => {
    store.setState({ editorFontFamily: value })
  })
  fontFamilySection.section.append(fontFamilyGroup.root)

  const fontSizeSection = makeSection('settings.editorFontSize')
  const fontSizeControl = document.createElement('div')
  fontSizeControl.className = 'settings-panel__font-size'

  const fontSizeRange = document.createElement('input')
  fontSizeRange.type = 'range'
  fontSizeRange.min = '13'
  fontSizeRange.max = '24'
  fontSizeRange.step = '1'
  fontSizeRange.className = 'settings-panel__slider'
  fontSizeRange.addEventListener('input', () => {
    store.setState({ editorFontSize: Number(fontSizeRange.value) })
  })

  const fontSizeValue = document.createElement('div')
  fontSizeValue.className = 'settings-panel__value'

  fontSizeControl.append(fontSizeRange, fontSizeValue)
  fontSizeSection.section.append(fontSizeControl)

  panel.append(header, body)
  overlay.append(panel)
  app.append(overlay)

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeSettings(store)
    }
  })

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !store.getState().settingsOpen) {
      return
    }

    event.preventDefault()
    closeSettings(store)
  }

  document.addEventListener('keydown', onKeyDown)

  let previousFocusedElement: HTMLElement | null = null
  let wasOpen = false

  const render = (state: AppState): void => {
    const language = state.language

    overlay.classList.toggle('is-open', state.settingsOpen)
    overlay.setAttribute('aria-hidden', String(!state.settingsOpen))
    panel.setAttribute('aria-label', translateApp(language, 'settings.title'))
    title.textContent = translateApp(language, 'settings.title')
    closeButton.setAttribute('aria-label', translateApp(language, 'settings.close'))

    ;[languageSection, uiThemeSection, docThemeSection, fontFamilySection, fontSizeSection].forEach(
      ({ label, helper, labelKey, helperKey }) => {
        label.textContent = translateApp(language, labelKey)
        if (helper && helperKey) {
          helper.textContent = translateApp(language, helperKey)
        }
      }
    )

    updateChoiceLabels(language, languageGroup.buttons)
    updateChoiceSelection(languageGroup.buttons, state.language)
    updateChoiceLabels(language, uiThemeGroup.buttons)
    updateChoiceSelection(uiThemeGroup.buttons, state.uiTheme)
    updateChoiceLabels(language, docThemeGroup.buttons)
    updateChoiceSelection(docThemeGroup.buttons, state.docTheme)
    updateChoiceLabels(language, fontFamilyGroup.buttons)
    updateChoiceSelection(fontFamilyGroup.buttons, state.editorFontFamily)

    fontSizeRange.value = String(state.editorFontSize)
    fontSizeValue.textContent = `${state.editorFontSize}px`

    if (state.settingsOpen && !wasOpen) {
      previousFocusedElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      requestAnimationFrame(() => closeButton.focus())
    }

    if (!state.settingsOpen && wasOpen) {
      previousFocusedElement?.focus()
      previousFocusedElement = null
    }

    wasOpen = state.settingsOpen
  }

  const unsubscribe = store.subscribe((state) => render(state))
  render(store.getState())

  return {
    destroy: () => {
      unsubscribe()
      document.removeEventListener('keydown', onKeyDown)
      overlay.remove()
    }
  }
}
