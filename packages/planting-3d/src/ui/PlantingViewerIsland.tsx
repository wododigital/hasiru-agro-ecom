'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import type { Role } from '@ecomkit/core/contracts';
import { Button, Checkbox, Segmented } from '@ecomkit/ui';
import { prefers2d, stickVector, type PatchPoint, type ViewerData } from '../domain';
import { fill, type Planting3dMessages } from '../messages';
import { Plan2d } from './Plan2d';
import type { SceneHandle } from './scene';

type View = '2d' | '3d';
/** idle = loading the 3D engine chunk. */
type Status = 'idle' | 'model' | 'trees' | 'ready' | 'error';

const ROLE_BG: Record<Role, string> = { M: 'bg-role-main', X: 'bg-role-host', O: 'bg-role-biomass' };
const STICK_RADIUS = 42;
const DEFAULT_SUN = 62;

const REDUCED = '(prefers-reduced-motion: reduce)';
function subscribeMotion(onChange: () => void) {
  const q = matchMedia(REDUCED);
  q.addEventListener('change', onChange);
  return () => q.removeEventListener('change', onChange);
}
function clientView(): View {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return prefers2d({ reducedMotion: matchMedia(REDUCED).matches, deviceMemory: nav.deviceMemory }) ? '2d' : '3d';
}

/** Loads the three chunk (also called by the "View in 3D" link on intent, so the click finds it cached). */
export const loadScene = () => import('./scene');

function readColors(el: HTMLElement) {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    roles: { M: v('--color-role-main'), X: v('--color-role-host'), O: v('--color-role-biomass') },
    labelBg: v('--color-primary'),
    labelFg: v('--color-accent'),
    font: getComputedStyle(document.body).fontFamily || 'sans-serif',
  };
}

/** Walk-mode thumbstick (pointer capture; keyboard users have W A S D and the arrows). */
function Stick({ label, onMove }: { label: string; onMove: (x: number, y: number) => void }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const id = useRef<number | null>(null);
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const v = stickVector(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2), STICK_RADIUS);
    setKnob({ x: v.x * STICK_RADIUS, y: v.y * STICK_RADIUS });
    onMove(v.x, v.y);
  };
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== id.current) return;
    id.current = null;
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  };
  return (
    <div
      role="application"
      aria-label={label}
      className="relative size-32 touch-none rounded-full border-2 border-primary-fg/60 bg-primary/40 backdrop-blur-sm select-none"
      onPointerDown={(e) => {
        e.preventDefault();
        id.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => e.pointerId === id.current && move(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="absolute top-1/2 left-1/2 -mt-7 -ml-7 size-14 rounded-full bg-accent shadow-card" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

export interface PlantingViewerIslandProps {
  data: ViewerData;
  messages: Planting3dMessages;
}

/**
 * 3D / 2D planting viewer (C4a). The 2D plan renders first (server and client agree); after mount the 3D view
 * takes over unless the visitor prefers reduced motion or the device is low on memory. three loads on demand.
 */
export function PlantingViewerIsland({ data, messages: m }: PlantingViewerIslandProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SceneHandle | null>(null);
  // Server and hydration render the 2D plan; the client then picks 3D unless reduced motion or low memory says 2D.
  const auto = useSyncExternalStore(subscribeMotion, clientView, () => '2d' as View);
  const [chosen, setChosen] = useState<View | null>(null);
  const view = chosen ?? auto;
  const setView = (v: View) => {
    setStatus('idle');
    setPicked(null);
    setChosen(v);
  };
  const [status, setStatus] = useState<Status>('idle');
  const [attempt, setAttempt] = useState(0);
  const [sun, setSun] = useState(DEFAULT_SUN);
  const [rings, setRings] = useState(true);
  const [walk, setWalk] = useState(false);
  const [picked, setPicked] = useState<PatchPoint | null>(null);

  useEffect(() => {
    if (view !== '3d' || !host.current) return;
    let cancelled = false;
    let handle: SceneHandle | null = null;
    const el = host.current;
    loadScene()
      .then(({ mountScene }) =>
        mountScene(el, data, {
          colors: readColors(el),
          feet: m.feet,
          sun: DEFAULT_SUN,
          rings: true,
          onPick: setPicked,
          onWalkEnd: () => setWalk(false),
          onStep: (s) => !cancelled && setStatus(s),
        }),
      )
      .then((h) => {
        if (cancelled) return h.dispose();
        handle = scene.current = h;
        setStatus('ready');
      })
      .catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
      handle?.dispose();
      scene.current = null;
      setWalk(false);
    };
  }, [view, data, m.feet, attempt]);

  // Re-applied when a (re)mounted scene becomes ready, so a retry keeps the visitor's choices.
  useEffect(() => scene.current?.setSun(sun), [sun, status]);
  useEffect(() => scene.current?.setRings(rings), [rings, status]);
  useEffect(() => scene.current?.setWalk(walk), [walk, status]);

  const count = data.points.length;
  const caption = [
    fill(m.caption, { count, w: data.extent.w, d: data.extent.d, plant: data.spacing.plant, row: data.spacing.row }),
    data.repeats ? fill(m.captionRepeats, { repeats: data.repeats }) : '',
    m.captionSizes,
    data.scale < 1 ? m.captionYoung : '',
  ]
    .filter(Boolean)
    .join(' ');
  const loading = view === '3d' && status !== 'ready';
  const step = status === 'idle' ? m.loadingEngine : status === 'model' ? m.loadingModel : status === 'trees' ? fill(m.loadingTrees, { count }) : m.ready;
  const progress = { idle: 20, model: 55, trees: 80, ready: 100, error: 0 }[status];
  const hint = view === '2d' ? m.hint2d : walk ? m.hintWalk : m.hint3d;

  return (
    <section className="relative isolate h-[calc(100dvh-9rem)] min-h-[30rem] overflow-hidden rounded-lg bg-surface-2 text-sm">
      {view === '3d' ? (
        <div ref={host} className="absolute inset-0" role="img" aria-label={m.stageLabel} />
      ) : (
        <div className="absolute inset-0 pt-28 pb-24 md:pt-6 md:pb-20">
          <Plan2d data={data} label={fill(m.planLabel, { model: data.modelName, count })} feet={m.feet} selected={picked} onPick={setPicked} />
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
        <div className="pointer-events-auto max-w-sm rounded-lg bg-primary/85 p-3 text-primary-fg backdrop-blur-sm">
          <ul className="hidden flex-col gap-1 text-xs md:flex">
            {data.legend.map((l) => (
              <li key={l.role} className="flex items-start gap-2">
                <span aria-hidden="true" className={`mt-0.5 size-3 shrink-0 rounded-full ${ROLE_BG[l.role]}`} />
                <span>
                  <b>{l.role}</b> {m.roles[l.role]}
                  {': '}
                  {l.names.join(', ')}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs opacity-85">{caption}</p>
        </div>
      </div>

      {picked ? (
        <div className="absolute top-36 left-1/2 z-10 flex max-w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-2 rounded-lg bg-primary/90 p-3 text-primary-fg md:top-6" role="status">
          <span className={`rounded-sm px-1.5 py-0.5 text-xs font-bold ${ROLE_BG[picked.role]}`}>{picked.role}</span>
          <span>
            <b className="block">{picked.name}</b>
            <span className="text-xs opacity-85">{fill(m.identify, { role: m.roles[picked.role], form: m.archetypes[picked.archetype] })}</span>
          </span>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
        <div className="pointer-events-auto">
          {walk ? <Stick label={m.stick} onMove={(x, y) => scene.current?.setStick(x, y)} /> : <p className="hidden max-w-64 rounded-lg bg-primary/85 p-2.5 text-xs text-primary-fg md:block">{hint}</p>}
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <Segmented
            name="planting-view"
            label={m.viewLabel}
            value={view}
            onChange={(v) => setView(v as View)}
            options={[
              { value: '3d', label: m.view3d },
              { value: '2d', label: m.view2d },
            ]}
            className="bg-surface/90"
          />
          {view === '3d' && status === 'ready' ? (
            <>
              <label className="flex items-center gap-2 rounded-full bg-primary/85 px-3 py-1.5 text-xs text-primary-fg">
                {m.sun}
                <input type="range" min={0} max={100} value={sun} onChange={(e) => setSun(Number(e.target.value))} className="w-24 accent-[var(--color-accent)]" />
              </label>
              <label className="flex items-center gap-2 rounded-full bg-primary/85 px-3 py-1.5 text-xs text-primary-fg">
                <Checkbox checked={rings} onChange={(e) => setRings(e.target.checked)} />
                {m.rings}
              </label>
              <Button variant="accent" size="sm" onClick={() => setWalk((w) => !w)} data-cta="viewer-walk-toggle">
                {walk ? m.walkOut : m.walkIn}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-surface-2/95 p-4 text-center" role="status" aria-live="polite">
          <div className="flex max-w-xs flex-col items-center gap-3">
            <b className="font-display text-xl text-primary">{status === 'error' ? m.failed : m.loadingTitle}</b>
            {status === 'error' ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setStatus('idle');
                    setAttempt((a) => a + 1);
                  }}
                  data-cta="viewer-retry"
                >
                  {m.retry}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setView('2d')} data-cta="viewer-use-2d">
                  {m.use2d}
                </Button>
              </div>
            ) : (
              <>
                <span className="text-muted">{step}</span>
                <span className="h-1.5 w-56 overflow-hidden rounded-full bg-border">
                  <span className="block h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
                </span>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
