/** Message shapes for the sandbox game. */
export interface SandboxGame {
  toHost: { type: "pulse" };
  toController: { type: "buzz" };
  input: { x: number; y: number };
  shared: null;
  own: { color: string };
}
