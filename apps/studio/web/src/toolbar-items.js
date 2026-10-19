// Shared menu descriptions for the live toolbar and the style guide. Shortcut hints are supplied by keys.js.
export function appMenuItems(actions, hint = () => '') {
  return [
    { id: 'settings', label: 'Settings', hint: hint('settings'), run: actions.settings },
    { id: 'library', label: 'Library', disabled: !actions.library, run: actions.library },
    { id: 'panels', label: 'Panels', run: actions.panels },
    { id: 'help', label: 'Keyboard shortcuts', hint: hint('help'), run: actions.help },
    { sep: true },
    { id: 'welcome', label: 'Switch project…', hint: hint('welcome'), run: actions.welcome },
  ];
}
export function sceneMenuItems({ scenes, current, hasBrief, hasProject, loading }, actions) {
  return [
    ...scenes.map((s) => ({ id: `scene:${s.name}`, label: s.name, checked: s.name === current, disabled: loading, run: () => actions.select(s.name) })),
    { sep: true },
    { id: 'scene-new', label: 'New scene…', disabled: !hasProject || loading, run: actions.newScene },
    ...(hasBrief ? [{ id: 'brief', label: 'Edit brief…', disabled: loading, run: actions.brief }] : []),
    { id: 'reload', label: 'Reload from disk', disabled: !hasProject || loading, run: actions.reload },
    // docs/TEMPLATES.md §4: this scene or the whole project into the user template library
    ...(actions.saveTemplate ? [{ sep: true }, { id: 'save-template', label: 'Save as template…', disabled: !hasProject || loading || !scenes.length, run: actions.saveTemplate }] : []),
  ];
}
