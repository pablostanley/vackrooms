const CHANNEL = "vackrooms-browser";
const VERSION = 1;

interface NavigationState {
  channel: typeof CHANNEL;
  version: typeof VERSION;
  type: "state";
  session: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** A cooperating frame may report only its own location. */
export function isComputerNavigationState(
  value: unknown,
  session: string,
  origin: string,
): value is NavigationState {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<NavigationState>;
  if (
    data.channel !== CHANNEL ||
    data.version !== VERSION ||
    data.type !== "state" ||
    data.session !== session ||
    typeof data.url !== "string" ||
    typeof data.canGoBack !== "boolean" ||
    typeof data.canGoForward !== "boolean"
  )
    return false;
  try {
    const url = new URL(data.url);
    const secure =
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname));
    return secure && url.origin === origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Never traverse the game's joint session history or read a foreign Window. */
export function attachComputerNavigation(
  iframe: HTMLIFrameElement,
  back: HTMLButtonElement,
  forward: HTMLButtonElement,
  onLocation: (url: string) => void,
) {
  const hostOrigin = window.location.origin;
  let origin = "";
  let session = "";
  let state: NavigationState | null = null;
  let pending = false;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  const unavailable = "This website does not provide in-monitor navigation.";
  const render = () => {
    back.disabled = pending || !state?.canGoBack;
    forward.disabled = pending || !state?.canGoForward;
    back.title = state ? "Back" : unavailable;
    forward.title = state ? "Forward" : unavailable;
  };
  const send = (message: Record<string, unknown>) => {
    if (origin && session)
      iframe.contentWindow?.postMessage(
        { channel: CHANNEL, version: VERSION, session, ...message },
        origin,
      );
  };
  const reset = () => {
    state = null;
    pending = false;
    clearTimeout(pendingTimer);
    session = crypto.randomUUID();
    render();
  };
  const connect = () => {
    reset();
    send({ type: "connect" });
  };
  const receive = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== origin)
      return;
    // The site's client effect may mount after the iframe's load event.
    if (
      event.data?.channel === CHANNEL &&
      event.data?.version === VERSION &&
      event.data?.type === "ready"
    ) {
      send({ type: "connect" });
      return;
    }
    // A cooperating site reports a clicked external link before it leaves.
    // Keep the destination available even when its frame policy blocks loading.
    if (
      event.data?.channel === CHANNEL &&
      event.data?.version === VERSION &&
      event.data?.type === "navigate" &&
      event.data?.session === session &&
      typeof event.data?.url === "string"
    ) {
      const url = browserAddress(event.data.url);
      if (!url || new URL(url).origin === hostOrigin) return;
      origin = new URL(url).origin;
      reset();
      onLocation(url);
      return;
    }
    if (!isComputerNavigationState(event.data, session, origin)) return;
    state = event.data;
    pending = false;
    clearTimeout(pendingTimer);
    onLocation(state.url);
    render();
  };
  const traverse = (direction: "back" | "forward") => {
    if (
      pending ||
      !state ||
      !(direction === "back" ? state.canGoBack : state.canGoForward)
    )
      return;
    pending = true;
    render();
    pendingTimer = setTimeout(() => {
      state = null;
      pending = false;
      render();
    }, 10000);
    send({ type: "traverse", direction });
  };
  const goBack = () => traverse("back");
  const goForward = () => traverse("forward");
  back.addEventListener("click", goBack);
  forward.addEventListener("click", goForward);
  iframe.addEventListener("load", connect);
  window.addEventListener("message", receive);
  render();
  return {
    setAddress(url: string) {
      origin = new URL(url).origin;
      reset();
    },
    dispose() {
      clearTimeout(pendingTimer);
      back.removeEventListener("click", goBack);
      forward.removeEventListener("click", goForward);
      iframe.removeEventListener("load", connect);
      window.removeEventListener("message", receive);
    },
  };
}
import { browserAddress } from "./computers";
