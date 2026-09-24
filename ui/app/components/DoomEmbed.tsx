// DoomEmbed — boots Doom shareware (episode 1) via js-dos v6 (DOSBox compiled to WASM).
// Static files live in ui/assets/js-dos/ (served at /ui/assets/js-dos/ by dt-app's Fastify
// dev server AND included in the production build under dist/ui/assets/js-dos/).
// Prerequisites: ui/assets/doom/doom-shareware.zip (user must download separately).
import React, { useRef, useEffect, useState } from 'react';

interface DoomEmbedProps {
  width?: number;
  height?: number;
  /** Absolute URL for the shareware ZIP — defaults to /ui/assets/doom/doom-shareware.zip */
  wadZipUrl?: string;
  /** Absolute URL for wdosbox.js — defaults to /ui/assets/js-dos/wdosbox.js */
  wdosboxUrl?: string;
}

// js-dos v6 is a browser-only IIFE bundle that attaches Dos to window.
// Load it via a script tag so the global is set before we call it.
type DosFactory = (canvas: HTMLCanvasElement, opts: Record<string, unknown>) => DosReadyPromise;
function loadJsDos(scriptUrl: string): Promise<DosFactory> {
  return new Promise((resolve, reject) => {
    const win = window as Window & { Dos?: DosFactory };
    if (win.Dos) { resolve(win.Dos); return; }
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.onload = () => {
      if (win.Dos) resolve(win.Dos);
      else reject(new Error('js-dos loaded but window.Dos is not set'));
    };
    script.onerror = () => reject(new Error(`Failed to load ${scriptUrl}`));
    document.head.appendChild(script);
  });
}

// Minimal shape of the DosReadyPromise returned by Dos()
interface DosReadyPromise {
  ready: (cb: (fs: { extract: (url: string) => Promise<void> }, main: (args: string[]) => Promise<{ exit: () => void }>) => void) => void;
}

// dt-app serves ui/assets/* at /ui/assets/* in both dev (Fastify) and production (platform).
// window.location.origin gives the correct scheme+host in both environments.
function getJsDosBase(): string {
  return `${window.location.origin}/ui/assets/js-dos`;
}

export function DoomEmbed({
  width = 1280,
  height = 800,
  wadZipUrl,
  wdosboxUrl,
}: DoomEmbedProps) {
  // Default asset paths point into ui/assets/ which dt-app serves and deploys automatically.
  const jsDosBase = getJsDosBase();
  const resolvedWadZipUrl = wadZipUrl ?? `${window.location.origin}/ui/assets/doom/doom-shareware.zip`;
  const resolvedWdosboxUrl = wdosboxUrl ?? `${jsDosBase}/wdosbox.js`;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Browsers block AudioContext until a user gesture fires first.
  // We gate the emulator boot behind a click so audio works from the start.
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'running' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!started || !canvasRef.current) return;

    console.log('[DoomEmbed] component mounted — beginning boot sequence');

    // Holds the DosCommandInterface for cleanup on unmount.
    let commandInterface: { exit: () => void } | undefined;
    // Guard flag prevents state updates after the component unmounts.
    let cancelled = false;

    const boot = async () => {
      setStatus('loading');
      try {
        // js-dos v6 is a browserify IIFE that sets window.Dos — load it as a script tag.
        const Dos = await loadJsDos(`${jsDosBase}/js-dos.js`);

        if (cancelled) return;

        console.log('[DoomEmbed] starting emulator...');
        // Dos() returns a DosReadyPromise — a Promise<DosRuntime> with an extra .ready() helper.
        const dosReady = Dos(canvasRef.current!, { wdosboxUrl: resolvedWdosboxUrl });

        dosReady.ready((fs, main) => {
          // fs.extract fetches the WAD zip from ui/assets/doom/ and unpacks it into the virtual FS.
          void fs.extract(resolvedWadZipUrl).then(() => {
            if (cancelled) return;
            setStatus('running');
            console.log('[DoomEmbed] emulator ready, booting DOOM.EXE');
            // Give canvas keyboard focus so controls work immediately without an extra click.
            canvasRef.current?.focus();
            void main(['-c', 'DOOM.EXE']).then((ci) => {
              commandInterface = ci;
            });
          });
        });
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[DoomEmbed] emulator error:', err);
          setStatus('error');
          setErrorMsg(msg);
        }
      }
    };

    void boot();

    return () => {
      console.log('[DoomEmbed] component unmounting, stopping emulator');
      cancelled = true;
      commandInterface?.exit();
    };
  }, [started, resolvedWadZipUrl, resolvedWdosboxUrl, jsDosBase]);

  // js-dos sets canvas.style.width/height to DOSBox's native resolution at runtime,
  // overriding our CSS. Watch for those mutations and force CSS scaling back to 100%.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let suppressed = false;
    const observer = new MutationObserver(() => {
      if (suppressed) return;
      if (canvas.style.width !== '100%' || canvas.style.height !== '100%') {
        suppressed = true;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        suppressed = false;
      }
    });
    observer.observe(canvas, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  });

  // Click-to-play overlay — shown before the emulator starts
  if (!started) {
    return (
      <div
        onClick={() => setStarted(true)}
        style={{
          width,
          height,
          background: '#000',
          color: '#c00',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          fontFamily: 'monospace',
          userSelect: 'none',
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 12 }}>💀</div>
        <div style={{ fontSize: 18, letterSpacing: 2 }}>CLICK TO PLAY DOOM</div>
        <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>
          Doom shareware — episode 1, freely redistributable by id Software
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        style={{
          width,
          height,
          background: '#000',
          color: '#f55',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'monospace',
          padding: 16,
          boxSizing: 'border-box',
        }}
      >
        Error: {errorMsg}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width, height }}>
      {/* Loading overlay sits above the canvas until the emulator signals 'running' */}
      {status === 'loading' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#000',
            color: '#c00',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'monospace',
            zIndex: 1,
          }}
        >
          Loading…
        </div>
      )}
      {/* tabIndex makes the canvas focusable so keyboard input registers immediately.
          js-dos overwrites the canvas pixel dimensions with DOSBox's native resolution,
          so we CSS-scale it to fill the container instead of relying on width/height attrs. */}
      <canvas
        ref={canvasRef}
        tabIndex={0}
        style={{
          display: 'block',
          outline: 'none',
          width: '100%',
          height: '100%',
          imageRendering: 'pixelated',
        }}
      />
    </div>
  );
}
