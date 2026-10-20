// Default copy for the 3D / 2D planting viewer. Templates use {placeholders} so islands receive plain strings.
export const planting3dMessages = {
  metaTitle: 'Planting layout in 3D',
  metaDescription: 'Walk through a planting layout in 3D or see it as a flat plan with each plant canopy.',
  title: '{model} model',
  back: 'Back to the model',
  backToPlan: 'Back to my plan',
  view3d: '3D view',
  view2d: '2D plan',
  viewLabel: 'View',
  sun: 'Sun',
  rings: 'Basin rings',
  walkIn: 'Walk in',
  walkOut: 'Back to aerial view',
  hint3d: 'Drag to rotate, pinch or scroll to zoom. Tap a plant to see what it is.',
  hintWalk: 'Use the stick or W A S D to walk. Drag anywhere else to look around. Esc returns to the aerial view.',
  hint2d: "Flat top view. Circles show each plant's canopy spread; the dashed box is the patch shown in 3D. Tap a plant to see what it is.",
  stick: 'Movement stick: drag to walk',
  loadingTitle: 'Preparing your farm view',
  loadingEngine: 'Loading 3D engine',
  loadingTrees: 'Planting {count} plants',
  loadingModel: 'Loading tree models',
  ready: 'Ready',
  failed: 'The 3D view could not load. Check your internet connection and try again.',
  retry: 'Try again',
  use2d: 'Show the 2D plan',
  caption: '{count} plants on a {w} x {d} ft patch, spaced {plant} ft along the row and {row} ft between rows.',
  captionRepeats: 'A patch like this repeats about {repeats} times across your land.',
  captionSizes: 'Plant sizes are standard illustrations per plant type.',
  captionYoung: 'Shown as young saplings for this dense planting.',
  feet: '{n} ft',
  roles: { M: 'Main crop', X: 'Host tree', O: 'Biomass and support' },
  archetypes: { large_fruit: 'Large fruit tree', small_fruit: 'Small fruit tree', timber: 'Timber tree', shrub: 'Shrub or biomass', banana: 'Banana' },
  identify: '{role} · {form}',
  planLabel: 'Flat plan of the {model} patch: {count} plants',
  stageLabel: '3D view of a planting patch',
  viewIn3d: 'View in 3D',
};

export type Planting3dMessages = typeof planting3dMessages;

/** Fills `{name}` placeholders; numbers get en-IN grouping. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => {
    const v = values[key];
    return v === undefined ? all : typeof v === 'number' ? v.toLocaleString('en-IN') : v;
  });
}
