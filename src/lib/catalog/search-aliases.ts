// Common names clinicians type for a medication that is not its ingredient
// name in the catalog. Searching "LDN" finds Naltrexone, "TRT" finds
// Testosterone, "GLP-1" finds Semaglutide and Tirzepatide. Each alias maps
// to catalog ingredient names (ingredients.common_name), matched the same
// way as the typed text (case-insensitive substring).
//
// Meeting check 2026-11-03: the favorites list says "LDN", but searching
// "LDN" found nothing, because the ingredient is "Naltrexone".

const ALIASES: Record<string, string[]> = {
  ldn:    ['Naltrexone'],
  trt:    ['Testosterone'],
  'glp-1': ['Semaglutide', 'Tirzepatide'],
  glp1:   ['Semaglutide', 'Tirzepatide'],
  glp:    ['Semaglutide', 'Tirzepatide'],
}

/** Ingredient names the typed text stands for, if it is a known alias. */
export function ingredientAliases(q: string): string[] {
  return ALIASES[q.trim().toLowerCase()] ?? []
}
