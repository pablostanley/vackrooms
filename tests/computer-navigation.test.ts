import assert from "node:assert/strict";
import test from "node:test";
import {
  attachComputerNavigation,
  isComputerNavigationState,
} from "../src/lib/game/computer-navigation";

const message = (session: string) => ({
  channel: "vackrooms-browser",
  version: 1,
  type: "state",
  session,
  url: "https://vgpu.sh/docs",
  canGoBack: true,
  canGoForward: false,
});

test("computer navigation rejects stale, malformed and foreign locations", () => {
  const validate = (data: unknown) =>
    isComputerNavigationState(data, "current", "https://vgpu.sh");
  assert.ok(validate(message("current")));
  for (const data of [
    null,
    "state",
    message("previous"),
    { ...message("current"), version: 2 },
    { ...message("current"), canGoBack: "true" },
    { ...message("current"), url: "https://example.com/" },
    { ...message("current"), url: "javascript:alert(1)" },
    { ...message("current"), url: "https://user:password@vgpu.sh/" },
  ])
    assert.equal(validate(data), false);
});

test("only the current frame handshake enables traversal and disposal removes listeners", () => {
  const root = Object.assign(new EventTarget(), {
    location: { origin: "https://vackrooms.vercel.app" },
  });
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: root,
  });
  const frame = new EventTarget();
  const calls: {
    payload: ReturnType<typeof message> & { direction?: string; type: string };
    origin: string;
  }[] = [];
  const target = {
    postMessage(payload: (typeof calls)[number]["payload"], origin: string) {
      calls.push({ payload, origin });
    },
  };
  Object.defineProperty(frame, "contentWindow", { value: target });
  const back = Object.assign(new EventTarget(), { disabled: false, title: "" });
  const forward = Object.assign(new EventTarget(), {
    disabled: false,
    title: "",
  });
  const locations: string[] = [];
  const navigation = attachComputerNavigation(
    frame as HTMLIFrameElement,
    back as HTMLButtonElement,
    forward as HTMLButtonElement,
    (url) => locations.push(url),
  );
  const receive = (
    data: unknown,
    source: unknown = target,
    origin = "https://vgpu.sh",
  ) => {
    const event = new Event("message");
    Object.defineProperties(event, {
      data: { value: data },
      source: { value: source },
      origin: { value: origin },
    });
    root.dispatchEvent(event);
  };
  try {
    navigation.setAddress("https://vgpu.sh/");
    assert.equal(back.disabled, true);
    assert.equal(forward.disabled, true);
    frame.dispatchEvent(new Event("load"));
    const session = calls.at(-1)!.payload.session;
    assert.equal(calls.at(-1)!.payload.type, "connect");
    receive(message(session), {}, "https://vgpu.sh");
    receive(message(session), target, "https://attacker.test");
    assert.deepEqual(locations, []);
    receive(message(session));
    assert.equal(back.disabled, false);
    assert.equal(forward.disabled, true);
    assert.deepEqual(locations, ["https://vgpu.sh/docs"]);
    back.dispatchEvent(new Event("click"));
    assert.equal(calls.at(-1)!.payload.type, "traverse");
    assert.equal(calls.at(-1)!.payload.direction, "back");
    assert.equal(calls.at(-1)!.origin, "https://vgpu.sh");
    assert.equal(back.disabled, true);
    const pendingCallCount = calls.length;
    back.dispatchEvent(new Event("click"));
    assert.equal(calls.length, pendingCallCount);
    frame.dispatchEvent(new Event("load"));
    receive(message(session));
    assert.equal(
      back.disabled,
      true,
      "old frame/session cannot re-enable arrows",
    );
    const nextSession = calls.at(-1)!.payload.session;
    receive({ channel: "vackrooms-browser", version: 1, type: "ready" });
    assert.equal(
      calls.at(-1)!.payload.session,
      nextSession,
      "late hydration reuses current handshake",
    );
    receive({ ...message(nextSession), canGoBack: false, canGoForward: true });
    assert.equal(forward.disabled, false);
    const destination = (url: string, nonce = nextSession) => ({
      channel: "vackrooms-browser",
      version: 1,
      type: "navigate",
      session: nonce,
      url,
    });
    const previousLocations = [...locations];
    receive(destination("https://github.com/vercel-labs/vgpu", "stale"));
    receive(destination("javascript:alert(1)"));
    receive(destination("https://vackrooms.vercel.app/"));
    assert.deepEqual(locations, previousLocations);
    receive(destination("https://github.com/vercel-labs/vgpu"));
    assert.equal(locations.at(-1), "https://github.com/vercel-labs/vgpu");
    assert.equal(forward.disabled, true);
    frame.dispatchEvent(new Event("load"));
    assert.equal(calls.at(-1)!.origin, "https://github.com");
    navigation.setAddress("https://example.com/");
    assert.equal(forward.disabled, true);
    receive(message(nextSession));
    assert.equal(back.disabled, true);
    navigation.dispose();
    const callCount = calls.length;
    frame.dispatchEvent(new Event("load"));
    receive(
      { channel: "vackrooms-browser", version: 1, type: "ready" },
      target,
      "https://example.com",
    );
    back.dispatchEvent(new Event("click"));
    assert.equal(calls.length, callCount);
  } finally {
    navigation.dispose();
    if (previousWindow)
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    else Reflect.deleteProperty(globalThis, "window");
  }
});
