// A full-page navigation (leaving the app's routes, e.g. into checkout).
// Its own module so a test can replace it: jsdom's window.location cannot
// be redefined.
export function navigateTo(url: string): void {
  window.location.assign(url)
}
